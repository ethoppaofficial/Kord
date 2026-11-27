-- 20261127000014_content_import_export_recovery.sql
-- Adds atomic transactional JSON bulk lesson import, full curriculum snapshot capture,
-- course snapshot recovery, and import audit history tracking without touching learner records.

-- ---------------------------------------------------------------------------
-- 1. Extend course_versions & create content_imports audit/history table
-- ---------------------------------------------------------------------------
alter table public.course_versions
  add column if not exists snapshot_type text not null default 'manual'
    check (snapshot_type in ('manual', 'pre_import', 'pre_restore')),
  add column if not exists snapshot_data jsonb not null default '{}'::jsonb,
  add column if not exists source_import_id uuid;

create table if not exists public.content_imports (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  operation_type text not null default 'import' check (operation_type in ('import', 'restore')),
  package_version text not null default '1.0',
  status text not null check (status in ('committed', 'rejected', 'failed', 'restored')),
  processed_count integer not null default 0 check (processed_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  snapshot_version_id uuid references public.course_versions(id) on delete set null,
  idempotency_key text,
  change_notes text not null default '',
  error_summary text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'course_versions_source_import_fk'
  ) then
    alter table public.course_versions
      add constraint course_versions_source_import_fk
      foreign key (source_import_id) references public.content_imports(id) on delete set null;
  end if;
end $$;

create unique index if not exists idx_content_imports_course_idem
  on public.content_imports(course_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_content_imports_course_created
  on public.content_imports(course_id, created_at desc);
create index if not exists idx_content_imports_actor
  on public.content_imports(actor_id, created_at desc);
create index if not exists idx_content_imports_snapshot_version
  on public.content_imports(snapshot_version_id);
create index if not exists idx_course_versions_source_import
  on public.course_versions(source_import_id);

-- ---------------------------------------------------------------------------
-- 2. Strict RLS & least-privilege grants for content_imports
-- ---------------------------------------------------------------------------
alter table public.content_imports enable row level security;

revoke all on public.content_imports from public, anon, authenticated;
grant select on public.content_imports to authenticated;
revoke truncate on public.content_imports from authenticated;
revoke trigger, references on public.content_imports from anon;

drop policy if exists "content_imports_select_admin_only" on public.content_imports;
create policy "content_imports_select_admin_only" on public.content_imports
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Internal curriculum snapshot & validation helpers
-- ---------------------------------------------------------------------------
create or replace function public.capture_course_curriculum_snapshot(
  p_course_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_phases jsonb := '[]'::jsonb;
begin
  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Course not found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'position', p.position,
        'title', p.title,
        'summary', p.summary,
        'objectives', p.objectives,
        'difficulty', p.difficulty,
        'estHours', p.est_hours,
        'publicationStatus', p.publication_status,
        'lessons', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'phaseId', l.phase_id,
                'position', l.position,
                'title', l.title,
                'introduction', l.introduction,
                'objectives', l.objectives,
                'estMinutes', l.est_minutes,
                'blocks', l.blocks,
                'videos', l.videos,
                'summary', l.summary,
                'takeaways', l.takeaways,
                'furtherReading', l.further_reading,
                'lessonResources', coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'title', lr.title,
                        'url', lr.url,
                        'resourceType', lr.resource_type,
                        'position', lr.position
                      )
                      order by lr.position asc
                    )
                    from public.lesson_resources lr
                    where lr.lesson_id = l.id
                  ),
                  '[]'::jsonb
                ),
                'completionCriteria', l.completion_criteria,
                'publicationStatus', l.publication_status,
                'isRequired', l.is_required
              )
              order by l.position asc
            )
            from public.lessons l
            where l.phase_id = p.id
          ),
          '[]'::jsonb
        )
      )
      order by p.position asc
    ),
    '[]'::jsonb
  )
  into v_phases
  from public.phases p
  where p.course_id = p_course_id;

  return jsonb_build_object(
    'schemaVersion', '1.0',
    'capturedAt', now(),
    'course', jsonb_build_object(
      'id', v_course.id,
      'slug', v_course.slug,
      'title', v_course.title,
      'description', v_course.description,
      'targetAudience', v_course.target_audience,
      'outcomes', v_course.outcomes,
      'difficulty', v_course.difficulty,
      'estimatedDurationWeeks', v_course.estimated_duration_weeks,
      'recommendedWeeklyHours', v_course.recommended_weekly_hours,
      'recommendedSchedule', v_course.recommended_schedule,
      'prerequisites', v_course.prerequisites,
      'thumbnailUrl', v_course.thumbnail_url,
      'authorName', v_course.author_name,
      'completionRules', v_course.completion_rules,
      'publicationStatus', v_course.publication_status,
      'version', v_course.version
    ),
    'phases', v_phases
  );
end;
$$;

revoke all on function public.capture_course_curriculum_snapshot(uuid) from public, anon, authenticated;

create or replace function public.validate_imported_lesson_payload(
  p_lesson jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_est_minutes integer;
  v_blocks jsonb;
  v_blk jsonb;
  v_blk_type text;
  v_idx integer := 0;
  v_non_code_text text := '';
  v_opts jsonb;
  v_cidx integer;
  v_fr jsonb;
  v_vid jsonb;
  v_url text;
  v_has_substantive boolean := false;
begin
  if p_lesson is null or jsonb_typeof(p_lesson) <> 'object' then
    raise exception 'Each imported lesson must be a JSON object';
  end if;

  v_title := trim(coalesce(p_lesson ->> 'title', ''));
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'Lesson title must be between 3 and 200 characters';
  end if;

  if (p_lesson ? 'estMinutes') and (p_lesson -> 'estMinutes') is not null then
    begin
      v_est_minutes := (p_lesson ->> 'estMinutes')::integer;
    exception when others then
      raise exception 'Lesson "%" estMinutes must be an integer', v_title;
    end;
    if v_est_minutes < 1 or v_est_minutes > 600 then
      raise exception 'Lesson "%" estMinutes must be between 1 and 600', v_title;
    end if;
  end if;

  v_blocks := p_lesson -> 'blocks';
  if v_blocks is null or jsonb_typeof(v_blocks) <> 'array' or jsonb_array_length(v_blocks) = 0 then
    raise exception 'Lesson "%" must contain at least one structured content block', v_title;
  end if;

  v_non_code_text := coalesce(p_lesson ->> 'title', '') || ' '
    || coalesce(p_lesson ->> 'introduction', '') || ' '
    || coalesce(p_lesson ->> 'summary', '') || ' '
    || coalesce(p_lesson ->> 'completionCriteria', '');

  for v_blk in select value from jsonb_array_elements(v_blocks) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_blk) <> 'object' then
      raise exception 'Lesson "%" block % must be a JSON object', v_title, v_idx;
    end if;

    v_blk_type := trim(coalesce(v_blk ->> 'type', ''));
    if v_blk_type not in (
      'heading', 'paragraph', 'steps', 'bullets', 'definition',
      'example', 'case_study', 'table', 'callout', 'demonstration',
      'code', 'image', 'video', 'resource_download', 'knowledge_check'
    ) then
      raise exception 'Lesson "%" uses unsupported block type "%"', v_title, v_blk_type;
    end if;

    if v_blk_type <> 'code' then
      v_non_code_text := v_non_code_text || ' ' || v_blk::text;
    else
      v_non_code_text := v_non_code_text || ' ' || coalesce(v_blk ->> 'title', '');
    end if;

    if v_blk_type = 'heading' then
      if length(trim(coalesce(v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" heading block requires text', v_title;
      end if;
    elsif v_blk_type in ('paragraph', 'callout') then
      if length(trim(coalesce(v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" % block requires text', v_title, v_blk_type;
      end if;
      v_has_substantive := true;
    elsif v_blk_type in ('steps', 'bullets') then
      if jsonb_typeof(v_blk -> 'items') <> 'array' or jsonb_array_length(v_blk -> 'items') = 0 then
        raise exception 'Lesson "%" % block requires items', v_title, v_blk_type;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'definition' then
      if length(trim(coalesce(v_blk ->> 'term', ''))) = 0
         or length(trim(coalesce(v_blk ->> 'meaning', v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" definition block requires term and meaning', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'example' then
      if length(trim(coalesce(v_blk ->> 'body', ''))) = 0 then
        raise exception 'Lesson "%" example block requires body', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'case_study' then
      if length(trim(coalesce(v_blk ->> 'scenario', v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" case_study block requires scenario', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'table' then
      if jsonb_typeof(v_blk -> 'headers') <> 'array' or jsonb_array_length(v_blk -> 'headers') = 0
         or jsonb_typeof(v_blk -> 'rows') <> 'array' or jsonb_array_length(v_blk -> 'rows') = 0 then
        raise exception 'Lesson "%" table block requires headers and rows', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'demonstration' then
      if length(trim(coalesce(v_blk ->> 'instructions', ''))) = 0 then
        raise exception 'Lesson "%" demonstration block requires instructions', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'code' then
      if length(trim(coalesce(v_blk ->> 'code', ''))) = 0 then
        raise exception 'Lesson "%" code block requires code', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'image' then
      v_url := trim(coalesce(v_blk ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^(https?://|/[^/])' then
        raise exception 'Lesson "%" image block URL must be https://, http://, or root-relative', v_title;
      end if;
      if length(v_url) > 0 then
        v_has_substantive := true;
      end if;
    elsif v_blk_type = 'video' then
      v_url := trim(coalesce(v_blk ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^https?://' then
        raise exception 'Lesson "%" video block URL must be https:// or http://', v_title;
      end if;
      if length(trim(coalesce(v_blk ->> 'videoId', ''))) = 0 and length(v_url) = 0 then
        raise exception 'Lesson "%" video block requires valid videoId or url', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'resource_download' then
      if length(trim(coalesce(v_blk ->> 'title', ''))) = 0 then
        raise exception 'Lesson "%" resource_download block requires title', v_title;
      end if;
      v_url := trim(coalesce(v_blk ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^https?://' then
        raise exception 'Lesson "%" resource_download URL must be https:// or http://', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'knowledge_check' then
      v_opts := v_blk -> 'options';
      if length(trim(coalesce(v_blk ->> 'prompt', ''))) = 0
         or jsonb_typeof(v_opts) <> 'array'
         or jsonb_array_length(v_opts) < 2 then
        raise exception 'Lesson "%" knowledge_check requires prompt and at least 2 options', v_title;
      end if;
      begin
        v_cidx := coalesce((v_blk ->> 'correctIndex')::integer, -1);
      exception when others then
        v_cidx := -1;
      end;
      if v_cidx < 0 or v_cidx >= jsonb_array_length(v_opts) then
        raise exception 'Lesson "%" knowledge_check correctIndex out of range', v_title;
      end if;
      v_has_substantive := true;
    end if;
  end loop;

  v_non_code_text := regexp_replace(v_non_code_text, '`[^`]*`', ' ', 'g');
  if v_non_code_text ~* '(<\s*script\y[^>]*>.*?<\s*/\s*script\s*>|<\s*script\y\s+(src|type|async|defer|nonce|crossorigin|on[a-z]+)\y|<\s*(iframe|object|embed|svg|style)\y|<\s*img\y[^>]*\y(src|on[a-z]+)\s*=|<\s*a\y[^>]*\yhref\s*=\s*["'']?\s*(javascript|vbscript|data):|\yon[a-z]{2,}\s*=\s*(?!\\?["'']\.\.\.\\?["''])|\ysrcdoc\s*=|\y(javascript|vbscript):(?![\s"''`<>]|$)|\ydata\s*:\s*text/html)' then
    raise exception 'Lesson "%" contains disallowed HTML, script, or executable URI constructs', v_title;
  end if;

  if jsonb_typeof(coalesce(p_lesson -> 'videos', '[]'::jsonb)) = 'array' then
    for v_vid in select value from jsonb_array_elements(coalesce(p_lesson -> 'videos', '[]'::jsonb)) loop
      v_url := trim(coalesce(v_vid ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^https?://' then
        raise exception 'Lesson "%" contains invalid video URL', v_title;
      end if;
      v_has_substantive := true;
    end loop;
  end if;

  if jsonb_typeof(coalesce(p_lesson -> 'furtherReading', '[]'::jsonb)) = 'array' then
    for v_fr in select value from jsonb_array_elements(coalesce(p_lesson -> 'furtherReading', '[]'::jsonb)) loop
      v_url := trim(coalesce(v_fr ->> 'url', ''));
      if length(trim(coalesce(v_fr ->> 'title', ''))) = 0 or v_url !~* '^https?://' then
        raise exception 'Lesson "%" furtherReading entries require a title and https:// or http:// URL', v_title;
      end if;
    end loop;
  end if;

  if not v_has_substantive then
    raise exception 'Lesson "%" lacks substantive instructional blocks', v_title;
  end if;
end;
$$;

revoke all on function public.validate_imported_lesson_payload(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Upgrade admin_create_course_version to also store full snapshot_data
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_course_version(
  p_course_id uuid,
  p_change_notes text default ''
)
returns public.course_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_next_ver integer;
  v_phase_cnt integer := 0;
  v_lesson_cnt integer := 0;
  v_quiz_cnt integer := 0;
  v_challenge_cnt integer := 0;
  v_notes text := trim(coalesce(p_change_notes, ''));
  v_snapshot_data jsonb;
  v_ver_row public.course_versions;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if length(v_notes) > 2000 then
    raise exception 'Change notes cannot exceed 2,000 characters';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Course not found';
  end if;

  v_snapshot_data := public.capture_course_curriculum_snapshot(p_course_id);
  v_next_ver := coalesce(v_course.version, 1) + 1;
  select count(*) into v_phase_cnt from public.phases where course_id = p_course_id;
  select count(*) into v_lesson_cnt
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  where p.course_id = p_course_id;
  select count(*) into v_quiz_cnt from public.quizzes where course_id = p_course_id;
  select count(*) into v_challenge_cnt from public.challenges where course_id = p_course_id;

  update public.courses
  set version = v_next_ver, updated_at = now()
  where id = p_course_id;

  insert into public.course_versions (
    course_id, version_number, change_notes, snapshot_type, snapshot, snapshot_data, created_by
  )
  values (
    p_course_id,
    v_next_ver,
    v_notes,
    'manual',
    jsonb_build_object(
      'title', v_course.title,
      'publicationStatus', v_course.publication_status,
      'difficulty', v_course.difficulty,
      'phaseCount', v_phase_cnt,
      'lessonCount', v_lesson_cnt,
      'quizCount', v_quiz_cnt,
      'challengeCount', v_challenge_cnt
    ),
    v_snapshot_data,
    auth.uid()
  )
  on conflict (course_id, version_number) do update set
    change_notes = excluded.change_notes,
    snapshot_data = excluded.snapshot_data
  returning * into v_ver_row;

  perform public.record_admin_audit_log(
    'course_snapshot_created',
    'course_versions',
    v_ver_row.id::text,
    null,
    jsonb_build_object(
      'courseId', p_course_id,
      'versionNumber', v_next_ver,
      'snapshotType', 'manual',
      'changeNotes', left(v_notes, 300)
    )
  );

  return v_ver_row;
end;
$$;

revoke all on function public.admin_create_course_version(uuid, text) from public, anon;
grant execute on function public.admin_create_course_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Transactional bulk content import RPC
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_import_course_content(
  p_course_id uuid,
  p_package_version text,
  p_lessons jsonb,
  p_change_notes text default '',
  p_idempotency_key text default null,
  p_unchanged_count integer default 0,
  p_rejected_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_actor_email text;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_existing_import public.content_imports;
  v_notes text := trim(coalesce(p_change_notes, ''));
  v_pre_snapshot jsonb;
  v_pre_version_id uuid;
  v_pre_version_num integer;
  v_import_id uuid;
  v_item jsonb;
  v_idx integer := 0;
  v_phase_id uuid;
  v_lesson_id uuid;
  v_existing_lesson public.lessons;
  v_is_new boolean;
  v_seen_ids uuid[] := array[]::uuid[];
  v_created_cnt integer := 0;
  v_updated_cnt integer := 0;
  v_unchanged_cnt integer := greatest(0, coalesce(p_unchanged_count, 0));
  v_rejected_cnt integer := greatest(0, coalesce(p_rejected_count, 0));
  v_processed_cnt integer := 0;
  v_target_pos integer;
  v_effective_status text;
  v_resources jsonb;
  v_res jsonb;
  v_res_idx integer;
  v_touched_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  perform pg_advisory_xact_lock(hashtext('bulk_import:' || coalesce(p_course_id::text, '')));

  if v_idem is not null then
    select * into v_existing_import
    from public.content_imports
    where course_id = p_course_id
      and idempotency_key = v_idem
      and status = 'committed'
    limit 1;

    if found then
      return jsonb_build_object(
        'importId', v_existing_import.id,
        'snapshotVersionId', v_existing_import.snapshot_version_id,
        'snapshotVersionNumber', (
          select version_number from public.course_versions where id = v_existing_import.snapshot_version_id
        ),
        'processedCount', v_existing_import.processed_count,
        'createdCount', v_existing_import.created_count,
        'updatedCount', v_existing_import.updated_count,
        'unchangedCount', v_existing_import.unchanged_count,
        'rejectedCount', v_existing_import.rejected_count,
        'idempotentReplay', true
      );
    end if;
  end if;

  if trim(coalesce(p_package_version, '')) <> '1.0' then
    raise exception 'Unsupported content package schema version "%"', p_package_version;
  end if;

  if length(v_notes) > 2000 then
    raise exception 'Change notes cannot exceed 2,000 characters';
  end if;

  if p_lessons is null or jsonb_typeof(p_lessons) <> 'array' or jsonb_array_length(p_lessons) = 0 then
    raise exception 'At least one validated lesson is required to commit a bulk import';
  end if;

  if jsonb_array_length(p_lessons) > 200 then
    raise exception 'Bulk import cannot exceed 200 lessons per batch';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Target course not found';
  end if;

  select email into v_actor_email from public.profiles where id = auth.uid();

  -- Pass 1: Validate every entry completely before any mutation
  for v_item in select value from jsonb_array_elements(p_lessons) loop
    v_idx := v_idx + 1;
    perform public.validate_imported_lesson_payload(v_item);

    begin
      v_phase_id := nullif(trim(coalesce(v_item ->> 'phaseId', '')), '')::uuid;
    exception when others then
      raise exception 'Lesson item % has invalid phaseId "%"', v_idx, v_item ->> 'phaseId';
    end;

    if v_phase_id is null or not exists (
      select 1 from public.phases ph where ph.id = v_phase_id and ph.course_id = p_course_id
    ) then
      raise exception 'Phase "%" does not belong to target course "%"', v_item ->> 'phaseId', v_course.title;
    end if;

    v_is_new := (jsonb_typeof(v_item -> 'isNew') = 'boolean' and (v_item ->> 'isNew')::boolean)
      or lower(trim(coalesce(v_item ->> 'action', ''))) = 'create';

    if nullif(trim(coalesce(v_item ->> 'id', '')), '') is not null then
      if v_is_new then
        raise exception 'New lessons (isNew: true) cannot specify an existing id';
      end if;
      begin
        v_lesson_id := trim(v_item ->> 'id')::uuid;
      exception when others then
        raise exception 'Invalid lesson UUID "%"', v_item ->> 'id';
      end;

      if v_lesson_id = any(v_seen_ids) then
        raise exception 'Duplicate lesson id "%" in bulk import batch', v_lesson_id;
      end if;
      v_seen_ids := array_append(v_seen_ids, v_lesson_id);

      select l.* into v_existing_lesson
      from public.lessons l
      join public.phases ph on ph.id = l.phase_id
      where l.id = v_lesson_id and ph.course_id = p_course_id;

      if not found then
        raise exception 'Lesson id "%" was not found in course "%"', v_lesson_id, v_course.title;
      end if;
      if v_existing_lesson.phase_id <> v_phase_id then
        raise exception 'Lesson "%" belongs to another module and cannot be moved silently', v_lesson_id;
      end if;
    elsif not v_is_new then
      raise exception 'Lesson "%" is missing an existing id and is not marked isNew: true', v_item ->> 'title';
    end if;
  end loop;

  -- Pass 2: Capture complete pre-import snapshot BEFORE mutating lessons
  v_pre_snapshot := public.capture_course_curriculum_snapshot(p_course_id);
  v_pre_version_num := coalesce(v_course.version, 1) + 1;

  update public.courses
  set version = v_pre_version_num, updated_at = now()
  where id = p_course_id;

  insert into public.course_versions (
    course_id, version_number, change_notes, snapshot_type, snapshot, snapshot_data, created_by
  )
  values (
    p_course_id,
    v_pre_version_num,
    case when length(v_notes) > 0 then 'Pre-import snapshot: ' || v_notes else 'Pre-import automatic backup' end,
    'pre_import',
    jsonb_build_object(
      'title', v_course.title,
      'publicationStatus', v_course.publication_status,
      'difficulty', v_course.difficulty,
      'phaseCount', jsonb_array_length(coalesce(v_pre_snapshot -> 'phases', '[]'::jsonb)),
      'lessonCount', (
        select count(*)
        from public.lessons l
        join public.phases ph on ph.id = l.phase_id
        where ph.course_id = p_course_id
      )
    ),
    v_pre_snapshot,
    auth.uid()
  )
  returning id into v_pre_version_id;

  perform public.record_admin_audit_log(
    'course_snapshot_created',
    'course_versions',
    v_pre_version_id::text,
    null,
    jsonb_build_object(
      'courseId', p_course_id,
      'versionNumber', v_pre_version_num,
      'snapshotType', 'pre_import'
    )
  );

  -- Pass 3: Temporarily shift positions of existing lessons in this batch to avoid swap collisions
  if coalesce(array_length(v_seen_ids, 1), 0) > 0 then
    v_idx := 0;
    foreach v_touched_id in array v_seen_ids loop
      v_idx := v_idx + 1;
      update public.lessons
      set position = -1000000 - v_idx
      where id = v_touched_id;
    end loop;
  end if;

  -- Pass 4: Apply atomic updates (in-place preserving exact IDs) & inserts (always 'draft')
  for v_item in select value from jsonb_array_elements(p_lessons) loop
    v_phase_id := trim(v_item ->> 'phaseId')::uuid;
    v_resources := coalesce(v_item -> 'furtherReading', '[]'::jsonb);

    if nullif(trim(coalesce(v_item ->> 'id', '')), '') is not null then
      v_lesson_id := trim(v_item ->> 'id')::uuid;
      select * into v_existing_lesson from public.lessons where id = v_lesson_id;

      v_target_pos := coalesce((v_item ->> 'position')::integer, abs(v_existing_lesson.position));
      if v_target_pos < 1 then
        v_target_pos := 1;
      end if;

      -- Preserve existing published lessons so enrolled learners stay unaffected; keep drafts as draft
      v_effective_status := case
        when v_existing_lesson.publication_status = 'published' then 'published'
        else 'draft'
      end;

      update public.lessons
      set position = v_target_pos,
          title = trim(v_item ->> 'title'),
          introduction = coalesce(v_item ->> 'introduction', ''),
          objectives = coalesce(v_item -> 'objectives', '[]'::jsonb),
          est_minutes = coalesce((v_item ->> 'estMinutes')::integer, 25),
          blocks = coalesce(v_item -> 'blocks', '[]'::jsonb),
          videos = coalesce(v_item -> 'videos', '[]'::jsonb),
          summary = coalesce(v_item ->> 'summary', ''),
          takeaways = coalesce(v_item -> 'takeaways', '[]'::jsonb),
          further_reading = v_resources,
          completion_criteria = coalesce(v_item ->> 'completionCriteria', ''),
          publication_status = v_effective_status,
          is_required = case
            when jsonb_typeof(v_item -> 'isRequired') = 'boolean' then (v_item ->> 'isRequired')::boolean
            else true
          end
      where id = v_lesson_id;

      v_touched_id := v_lesson_id;
      v_updated_cnt := v_updated_cnt + 1;
    else
      if (v_item ? 'position') and (v_item -> 'position') is not null then
        v_target_pos := greatest(1, (v_item ->> 'position')::integer);
      else
        select coalesce(max(position), 0) + 1 into v_target_pos
        from public.lessons
        where phase_id = v_phase_id;
      end if;

      -- Never auto-publish newly imported lessons
      v_effective_status := 'draft';

      insert into public.lessons (
        phase_id, position, title, introduction, objectives, est_minutes,
        blocks, videos, summary, takeaways, further_reading, completion_criteria,
        publication_status, is_required
      )
      values (
        v_phase_id,
        v_target_pos,
        trim(v_item ->> 'title'),
        coalesce(v_item ->> 'introduction', ''),
        coalesce(v_item -> 'objectives', '[]'::jsonb),
        coalesce((v_item ->> 'estMinutes')::integer, 25),
        coalesce(v_item -> 'blocks', '[]'::jsonb),
        coalesce(v_item -> 'videos', '[]'::jsonb),
        coalesce(v_item ->> 'summary', ''),
        coalesce(v_item -> 'takeaways', '[]'::jsonb),
        v_resources,
        coalesce(v_item ->> 'completionCriteria', ''),
        v_effective_status,
        case
          when jsonb_typeof(v_item -> 'isRequired') = 'boolean' then (v_item ->> 'isRequired')::boolean
          else true
        end
      )
      returning id into v_touched_id;

      v_created_cnt := v_created_cnt + 1;
    end if;

    -- Sync normalized lesson_resources
    delete from public.lesson_resources where lesson_id = v_touched_id;
    if jsonb_typeof(v_resources) = 'array' and jsonb_array_length(v_resources) > 0 then
      v_res_idx := 0;
      for v_res in select value from jsonb_array_elements(v_resources) loop
        v_res_idx := v_res_idx + 1;
        insert into public.lesson_resources (lesson_id, title, url, resource_type, position)
        values (
          v_touched_id,
          trim(coalesce(nullif(v_res ->> 'title', ''), v_res ->> 'url')),
          trim(v_res ->> 'url'),
          coalesce(nullif(trim(v_res ->> 'resourceType'), ''), 'Guide'),
          v_res_idx
        )
        on conflict (lesson_id, url) do update set
          title = excluded.title,
          resource_type = excluded.resource_type,
          position = excluded.position;
      end loop;
    end if;
  end loop;

  v_processed_cnt := v_created_cnt + v_updated_cnt + v_unchanged_cnt + v_rejected_cnt;

  insert into public.content_imports (
    course_id, actor_id, actor_email, operation_type, package_version, status,
    processed_count, created_count, updated_count, unchanged_count, rejected_count,
    snapshot_version_id, idempotency_key, change_notes, details
  )
  values (
    p_course_id,
    auth.uid(),
    v_actor_email,
    'import',
    p_package_version,
    'committed',
    v_processed_cnt,
    v_created_cnt,
    v_updated_cnt,
    v_unchanged_cnt,
    v_rejected_cnt,
    v_pre_version_id,
    v_idem,
    v_notes,
    jsonb_build_object('touchedLessons', jsonb_array_length(p_lessons))
  )
  returning id into v_import_id;

  update public.course_versions
  set source_import_id = v_import_id
  where id = v_pre_version_id;

  perform public.record_admin_audit_log(
    'bulk_content_import_committed',
    'courses',
    p_course_id::text,
    null,
    jsonb_build_object(
      'importId', v_import_id,
      'snapshotVersionId', v_pre_version_id,
      'createdCount', v_created_cnt,
      'updatedCount', v_updated_cnt,
      'unchangedCount', v_unchanged_cnt,
      'changeNotes', left(v_notes, 300)
    )
  );

  return jsonb_build_object(
    'importId', v_import_id,
    'snapshotVersionId', v_pre_version_id,
    'snapshotVersionNumber', v_pre_version_num,
    'processedCount', v_processed_cnt,
    'createdCount', v_created_cnt,
    'updatedCount', v_updated_cnt,
    'unchangedCount', v_unchanged_cnt,
    'rejectedCount', v_rejected_cnt,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.admin_bulk_import_course_content(uuid, text, jsonb, text, text, integer, integer) from public, anon;
grant execute on function public.admin_bulk_import_course_content(uuid, text, jsonb, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admin-only logging RPC for rejected/failed import attempts
-- ---------------------------------------------------------------------------
create or replace function public.admin_log_content_import_event(
  p_course_id uuid,
  p_status text,
  p_package_version text default '1.0',
  p_processed_count integer default 0,
  p_rejected_count integer default 0,
  p_error_summary text default '',
  p_details jsonb default '{}'::jsonb
)
returns public.content_imports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text;
  v_row public.content_imports;
  v_audit_action text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_status not in ('rejected', 'failed') then
    raise exception 'Invalid import event status: must be rejected or failed';
  end if;

  if not exists (select 1 from public.courses where id = p_course_id) then
    raise exception 'Course not found';
  end if;

  select email into v_actor_email from public.profiles where id = auth.uid();

  insert into public.content_imports (
    course_id, actor_id, actor_email, operation_type, package_version, status,
    processed_count, created_count, updated_count, unchanged_count, rejected_count,
    error_summary, details
  )
  values (
    p_course_id,
    auth.uid(),
    v_actor_email,
    'import',
    coalesce(nullif(trim(p_package_version), ''), '1.0'),
    p_status,
    greatest(0, coalesce(p_processed_count, 0)),
    0,
    0,
    0,
    greatest(0, coalesce(p_rejected_count, 0)),
    left(trim(coalesce(p_error_summary, '')), 1000),
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_row;

  v_audit_action := case
    when p_status = 'rejected' then 'bulk_content_import_rejected'
    else 'bulk_content_import_failed'
  end;

  perform public.record_admin_audit_log(
    v_audit_action,
    'courses',
    p_course_id::text,
    null,
    jsonb_build_object(
      'importId', v_row.id,
      'status', p_status,
      'rejectedCount', v_row.rejected_count,
      'errorSummary', v_row.error_summary
    )
  );

  return v_row;
end;
$$;

revoke all on function public.admin_log_content_import_event(uuid, text, text, integer, integer, text, jsonb) from public, anon;
grant execute on function public.admin_log_content_import_event(uuid, text, text, integer, integer, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Transactional snapshot recovery RPC (never touches learner progress/enrollments)
-- ---------------------------------------------------------------------------
create or replace function public.admin_restore_course_snapshot(
  p_course_id uuid,
  p_version_id uuid,
  p_restore_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_target_ver public.course_versions;
  v_actor_email text;
  v_notes text := trim(coalesce(p_restore_notes, ''));
  v_safety_snapshot jsonb;
  v_safety_ver_id uuid;
  v_safety_ver_num integer;
  v_snap jsonb;
  v_snap_course jsonb;
  v_phase jsonb;
  v_lesson jsonb;
  v_phase_id uuid;
  v_lesson_id uuid;
  v_restored_lesson_ids uuid[] := array[]::uuid[];
  v_restored_lessons_cnt integer := 0;
  v_archived_extra_cnt integer := 0;
  v_deleted_extra_cnt integer := 0;
  v_extra record;
  v_shift integer := 0;
  v_max_pos integer;
  v_resources jsonb;
  v_res jsonb;
  v_res_idx integer;
  v_restore_import_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if length(v_notes) > 2000 then
    raise exception 'Restore notes cannot exceed 2,000 characters';
  end if;

  perform pg_advisory_xact_lock(hashtext('bulk_import:' || coalesce(p_course_id::text, '')));

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Course not found';
  end if;

  select * into v_target_ver
  from public.course_versions
  where id = p_version_id and course_id = p_course_id;

  if not found then
    raise exception 'Course version snapshot not found';
  end if;

  v_snap := v_target_ver.snapshot_data;
  if v_snap is null
     or jsonb_typeof(v_snap) <> 'object'
     or jsonb_typeof(v_snap -> 'phases') <> 'array' then
    raise exception 'Selected course version does not contain a restorable full curriculum snapshot';
  end if;

  select email into v_actor_email from public.profiles where id = auth.uid();

  -- Step 1: Capture pre_restore safety snapshot BEFORE restoring
  v_safety_snapshot := public.capture_course_curriculum_snapshot(p_course_id);
  v_safety_ver_num := coalesce(v_course.version, 1) + 1;

  update public.courses
  set version = v_safety_ver_num, updated_at = now()
  where id = p_course_id;

  insert into public.course_versions (
    course_id, version_number, change_notes, snapshot_type, snapshot, snapshot_data, created_by
  )
  values (
    p_course_id,
    v_safety_ver_num,
    'Pre-restore automatic backup before reverting to v' || v_target_ver.version_number,
    'pre_restore',
    jsonb_build_object(
      'title', v_course.title,
      'publicationStatus', v_course.publication_status,
      'difficulty', v_course.difficulty,
      'phaseCount', jsonb_array_length(coalesce(v_safety_snapshot -> 'phases', '[]'::jsonb))
    ),
    v_safety_snapshot,
    auth.uid()
  )
  returning id into v_safety_ver_id;

  perform public.record_admin_audit_log(
    'course_snapshot_created',
    'course_versions',
    v_safety_ver_id::text,
    null,
    jsonb_build_object(
      'courseId', p_course_id,
      'versionNumber', v_safety_ver_num,
      'snapshotType', 'pre_restore'
    )
  );

  -- Step 2: Shift current lesson positions safely out of the way to avoid unique collisions
  for v_extra in
    select l.id
    from public.lessons l
    join public.phases ph on ph.id = l.phase_id
    where ph.course_id = p_course_id
  loop
    v_shift := v_shift + 1;
    update public.lessons set position = -2000000 - v_shift where id = v_extra.id;
  end loop;

  -- Step 3: Restore phases and lessons from snapshot
  for v_phase in select value from jsonb_array_elements(v_snap -> 'phases') loop
    v_phase_id := (v_phase ->> 'id')::uuid;

    insert into public.phases (
      id, course_id, position, title, summary, objectives, difficulty, est_hours, publication_status
    )
    values (
      v_phase_id,
      p_course_id,
      greatest(1, coalesce((v_phase ->> 'position')::integer, 1)),
      coalesce(v_phase ->> 'title', 'Module'),
      coalesce(v_phase ->> 'summary', ''),
      coalesce(v_phase -> 'objectives', '[]'::jsonb),
      coalesce(v_phase ->> 'difficulty', 'Beginner'),
      coalesce((v_phase ->> 'estHours')::numeric, 2.0),
      coalesce(v_phase ->> 'publicationStatus', 'published')
    )
    on conflict (id) do update set
      course_id = excluded.course_id,
      position = excluded.position,
      title = excluded.title,
      summary = excluded.summary,
      objectives = excluded.objectives,
      difficulty = excluded.difficulty,
      est_hours = excluded.est_hours,
      publication_status = excluded.publication_status;

    for v_lesson in select value from jsonb_array_elements(coalesce(v_phase -> 'lessons', '[]'::jsonb)) loop
      v_lesson_id := (v_lesson ->> 'id')::uuid;
      v_restored_lesson_ids := array_append(v_restored_lesson_ids, v_lesson_id);

      insert into public.lessons (
        id, phase_id, position, title, introduction, objectives, est_minutes,
        blocks, videos, summary, takeaways, further_reading, completion_criteria,
        publication_status, is_required
      )
      values (
        v_lesson_id,
        v_phase_id,
        greatest(1, coalesce((v_lesson ->> 'position')::integer, 1)),
        coalesce(v_lesson ->> 'title', 'Lesson'),
        coalesce(v_lesson ->> 'introduction', ''),
        coalesce(v_lesson -> 'objectives', '[]'::jsonb),
        greatest(1, coalesce((v_lesson ->> 'estMinutes')::integer, 25)),
        coalesce(v_lesson -> 'blocks', '[]'::jsonb),
        coalesce(v_lesson -> 'videos', '[]'::jsonb),
        coalesce(v_lesson ->> 'summary', ''),
        coalesce(v_lesson -> 'takeaways', '[]'::jsonb),
        coalesce(v_lesson -> 'furtherReading', '[]'::jsonb),
        coalesce(v_lesson ->> 'completionCriteria', ''),
        coalesce(v_lesson ->> 'publicationStatus', 'draft'),
        coalesce((v_lesson ->> 'isRequired')::boolean, true)
      )
      on conflict (id) do update set
        phase_id = excluded.phase_id,
        position = excluded.position,
        title = excluded.title,
        introduction = excluded.introduction,
        objectives = excluded.objectives,
        est_minutes = excluded.est_minutes,
        blocks = excluded.blocks,
        videos = excluded.videos,
        summary = excluded.summary,
        takeaways = excluded.takeaways,
        further_reading = excluded.further_reading,
        completion_criteria = excluded.completion_criteria,
        publication_status = excluded.publication_status,
        is_required = excluded.is_required;

      v_resources := coalesce(v_lesson -> 'lessonResources', v_lesson -> 'furtherReading', '[]'::jsonb);
      delete from public.lesson_resources where lesson_id = v_lesson_id;
      if jsonb_typeof(v_resources) = 'array' and jsonb_array_length(v_resources) > 0 then
        v_res_idx := 0;
        for v_res in select value from jsonb_array_elements(v_resources) loop
          if trim(coalesce(v_res ->> 'url', '')) ~* '^https?://' then
            v_res_idx := v_res_idx + 1;
            insert into public.lesson_resources (lesson_id, title, url, resource_type, position)
            values (
              v_lesson_id,
              trim(coalesce(nullif(v_res ->> 'title', ''), v_res ->> 'url')),
              trim(v_res ->> 'url'),
              coalesce(nullif(trim(v_res ->> 'resourceType'), ''), 'Guide'),
              v_res_idx
            )
            on conflict (lesson_id, url) do update set
              title = excluded.title,
              resource_type = excluded.resource_type,
              position = excluded.position;
          end if;
        end loop;
      end if;

      v_restored_lessons_cnt := v_restored_lessons_cnt + 1;
    end loop;
  end loop;

  -- Step 4: Clean up or archive post-snapshot lessons without deleting learner progress
  for v_extra in
    select l.id, l.phase_id
    from public.lessons l
    join public.phases ph on ph.id = l.phase_id
    where ph.course_id = p_course_id
      and not (l.id = any(v_restored_lesson_ids))
  loop
    if exists (select 1 from public.lesson_progress lp where lp.lesson_id = v_extra.id)
       or exists (select 1 from public.quizzes q where q.lesson_id = v_extra.id)
       or exists (select 1 from public.activities a where a.lesson_id = v_extra.id) then
      select coalesce(max(position), 0) + 1 into v_max_pos
      from public.lessons
      where phase_id = v_extra.phase_id and position > 0;

      update public.lessons
      set publication_status = 'archived',
          position = greatest(1, v_max_pos)
      where id = v_extra.id;
      v_archived_extra_cnt := v_archived_extra_cnt + 1;
    else
      delete from public.lessons where id = v_extra.id;
      v_deleted_extra_cnt := v_deleted_extra_cnt + 1;
    end if;
  end loop;

  -- Step 5: Restore course metadata last so publish-readiness trigger sees restored phases/lessons
  v_snap_course := coalesce(v_snap -> 'course', '{}'::jsonb);
  if jsonb_typeof(v_snap_course) = 'object' and (v_snap_course ? 'title') then
    update public.courses
    set title = coalesce(nullif(trim(v_snap_course ->> 'title'), ''), title),
        description = coalesce(v_snap_course ->> 'description', description),
        target_audience = coalesce(v_snap_course ->> 'targetAudience', target_audience),
        outcomes = coalesce(v_snap_course -> 'outcomes', outcomes),
        difficulty = coalesce(v_snap_course ->> 'difficulty', difficulty),
        estimated_duration_weeks = coalesce((v_snap_course ->> 'estimatedDurationWeeks')::integer, estimated_duration_weeks),
        recommended_weekly_hours = coalesce((v_snap_course ->> 'recommendedWeeklyHours')::numeric, recommended_weekly_hours),
        recommended_schedule = coalesce(v_snap_course ->> 'recommendedSchedule', recommended_schedule),
        prerequisites = coalesce(v_snap_course -> 'prerequisites', prerequisites),
        thumbnail_url = coalesce(v_snap_course ->> 'thumbnailUrl', thumbnail_url),
        author_name = coalesce(v_snap_course ->> 'authorName', author_name),
        completion_rules = coalesce(v_snap_course -> 'completionRules', completion_rules),
        publication_status = coalesce(v_snap_course ->> 'publicationStatus', publication_status),
        updated_at = now()
    where id = p_course_id;
  end if;

  insert into public.content_imports (
    course_id, actor_id, actor_email, operation_type, package_version, status,
    processed_count, created_count, updated_count, unchanged_count, rejected_count,
    snapshot_version_id, change_notes, details
  )
  values (
    p_course_id,
    auth.uid(),
    v_actor_email,
    'restore',
    '1.0',
    'restored',
    v_restored_lessons_cnt,
    0,
    v_restored_lessons_cnt,
    0,
    0,
    v_safety_ver_id,
    case when length(v_notes) > 0 then v_notes else 'Restored snapshot v' || v_target_ver.version_number end,
    jsonb_build_object(
      'restoredFromVersionId', p_version_id,
      'restoredFromVersionNumber', v_target_ver.version_number,
      'archivedExtraLessons', v_archived_extra_cnt,
      'deletedExtraLessons', v_deleted_extra_cnt
    )
  )
  returning id into v_restore_import_id;

  update public.course_versions
  set source_import_id = v_restore_import_id
  where id = v_safety_ver_id;

  perform public.record_admin_audit_log(
    'course_snapshot_restored',
    'courses',
    p_course_id::text,
    null,
    jsonb_build_object(
      'restoreImportId', v_restore_import_id,
      'restoredFromVersionId', p_version_id,
      'restoredFromVersionNumber', v_target_ver.version_number,
      'safetySnapshotVersionId', v_safety_ver_id,
      'restoredLessonsCount', v_restored_lessons_cnt,
      'archivedExtraLessonsCount', v_archived_extra_cnt,
      'deletedExtraLessonsCount', v_deleted_extra_cnt
    )
  );

  return jsonb_build_object(
    'restoreImportId', v_restore_import_id,
    'restoredFromVersionId', p_version_id,
    'restoredVersionNumber', v_target_ver.version_number,
    'safetySnapshotVersionId', v_safety_ver_id,
    'safetySnapshotVersionNumber', v_safety_ver_num,
    'restoredLessonsCount', v_restored_lessons_cnt,
    'archivedExtraLessonsCount', v_archived_extra_cnt,
    'deletedExtraLessonsCount', v_deleted_extra_cnt
  );
end;
$$;

revoke all on function public.admin_restore_course_snapshot(uuid, uuid, text) from public, anon;
grant execute on function public.admin_restore_course_snapshot(uuid, uuid, text) to authenticated;
