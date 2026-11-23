-- 20261123000011_remediation_hardening.sql
-- Comprehensive remediation:
--   1. Profile account_status ('active' | 'suspended') & strict caller-role protection
--   2. Removal of hardcoded admin email auto-promotion from handle_new_user()
--   3. Conditional hardening of public.rls_auto_enable()
--   4. Foreign-key index coverage across all schema tables
--   5. Server-side timed assessments (public.quiz_sessions + start_quiz_session + submit_quiz enforcement)
--   6. Server-side course publish readiness validation trigger
--   7. Immutable administrative audit logging (public.admin_audit_logs + triggers)
--   8. Admin user governance RPCs (admin_list_users, admin_set_account_status)
--   9. Active-account enforcement in dashboard and learner progression RPCs

-- ---------------------------------------------------------------------------
-- 1. Profile account_status, grants & caller-aware privilege protection
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('active', 'suspended'));

revoke all on public.profiles from public, anon, authenticated;
grant select (id, email, first_name, full_name, role, account_status, created_at) on public.profiles to authenticated;
grant update (first_name, full_name) on public.profiles to authenticated;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() and account_status = 'active')
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and email = (select p.email from public.profiles p where p.id = auth.uid())
    and account_status = (select p.account_status from public.profiles p where p.id = auth.uid())
  );

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and account_status = 'active'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create or replace function public.is_active_learner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'learner'
      and account_status = 'active'
  );
$$;

revoke all on function public.is_active_learner() from public, anon;
grant execute on function public.is_active_learner() to authenticated, service_role;

-- Internal helper: verifies trusted service_role / postgres operator context accurately
-- (Does not rely on current_user inside SECURITY DEFINER functions)
create or replace function public.is_trusted_service_context()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_local_role text := nullif(nullif(current_setting('role', true), ''), 'none');
begin
  if session_user in ('anon', 'authenticated') then
    return false;
  end if;
  if coalesce(v_jwt_role, 'postgres') not in ('service_role', 'postgres', 'supabase_admin') then
    return false;
  end if;
  if coalesce(v_local_role, session_user) not in ('service_role', 'postgres', 'supabase_admin') then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.is_trusted_service_context() from public, anon, authenticated;

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service boolean := public.is_trusted_service_context();
  v_admin_status_op boolean := false;
begin
  if not v_is_service then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.created_at is distinct from old.created_at then
      raise exception 'Privileged profile fields (id, email, role, created_at) cannot be modified directly';
    end if;

    if new.account_status is distinct from old.account_status then
      v_admin_status_op := public.is_admin()
        and new.id is distinct from auth.uid()
        and old.role <> 'admin'
        and pg_trigger_depth() <= 1;
      if not v_admin_status_op then
        raise exception 'Account status can only be modified by an authorized administrator or service role';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_privileged_fields() from public, anon, authenticated;

-- Unconditional learner creation on signup: removes hardcoded email auto-admin promotion
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_first text;
  derived_full text;
begin
  derived_full := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'learner'), '@', 1)
  );
  derived_first := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
    split_part(derived_full, ' ', 1)
  );

  insert into public.profiles (id, email, first_name, full_name, role, account_status)
  values (
    new.id,
    lower(new.email),
    derived_first,
    derived_full,
    'learner',
    'active'
  )
  on conflict (id) do update
    set first_name = coalesce(nullif(excluded.first_name, ''), public.profiles.first_name),
        full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.admin_assign_profile_role(
  p_target_user_id uuid,
  p_new_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if not public.is_trusted_service_context() then
    raise exception 'Service role authorization required to assign profile roles';
  end if;

  if p_new_role not in ('learner', 'admin') then
    raise exception 'Invalid role: must be learner or admin';
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_target_user_id
  returning * into v_row;

  if not found then
    raise exception 'Profile not found for user %', p_target_user_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_assign_profile_role(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_assign_profile_role(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Conditional hardening of public.rls_auto_enable() if present in DB
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'alter function public.rls_auto_enable() set search_path = public';
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Immutable administrative audit log table & capture triggers
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null default 'system',
  action text not null,
  target_table text not null,
  target_id text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_created on public.admin_audit_logs(created_at desc);
create index if not exists idx_admin_audit_logs_actor on public.admin_audit_logs(actor_id, created_at desc);
create index if not exists idx_admin_audit_logs_target on public.admin_audit_logs(target_table, target_id, created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from public, anon, authenticated;
grant select on public.admin_audit_logs to authenticated;

drop policy if exists "admin_audit_logs_select_admin_only" on public.admin_audit_logs;
create policy "admin_audit_logs_select_admin_only" on public.admin_audit_logs
  for select to authenticated
  using (public.is_admin());

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Administrative audit logs are append-only and immutable';
end;
$$;

revoke all on function public.prevent_audit_log_mutation() from public, anon, authenticated;

drop trigger if exists trg_prevent_audit_log_mutation on public.admin_audit_logs;
create trigger trg_prevent_audit_log_mutation
  before update or delete on public.admin_audit_logs
  for each row execute function public.prevent_audit_log_mutation();

create or replace function public.record_admin_audit_log(
  p_action text,
  p_target_table text,
  p_target_id text,
  p_before_data jsonb default null,
  p_after_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'system');
begin
  if v_actor_id is not null and exists (select 1 from public.profiles where id = v_actor_id and role = 'admin') then
    v_actor_role := 'admin';
  elsif v_actor_id is not null then
    v_actor_role := 'authenticated';
  end if;

  insert into public.admin_audit_logs (
    actor_id, actor_role, action, target_table, target_id, before_data, after_data
  )
  values (
    v_actor_id,
    v_actor_role,
    p_action,
    p_target_table,
    coalesce(p_target_id, ''),
    p_before_data,
    p_after_data
  );
end;
$$;

revoke all on function public.record_admin_audit_log(text, text, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.trg_capture_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_has_runtime_actor boolean := auth.uid() is not null or v_jwt_role in ('authenticated', 'service_role');
  v_action text;
  v_target_id text;
  v_before jsonb := null;
  v_after jsonb := null;
begin
  if tg_table_name = 'profiles' then
    if tg_op <> 'UPDATE' then
      return null;
    end if;
    if old.role is not distinct from new.role
       and old.account_status is not distinct from new.account_status then
      return null;
    end if;
    v_action := case
      when old.role is distinct from new.role and old.account_status is distinct from new.account_status then 'profile_role_and_status_changed'
      when old.role is distinct from new.role then 'profile_role_changed'
      else 'profile_status_changed'
    end;
    v_target_id := new.id::text;
    v_before := jsonb_build_object('role', old.role, 'accountStatus', old.account_status);
    v_after := jsonb_build_object('role', new.role, 'accountStatus', new.account_status);
    perform public.record_admin_audit_log(v_action, 'profiles', v_target_id, v_before, v_after);
    return null;
  end if;

  -- Skip bulk offline SQL seed operations outside runtime requests
  if not v_has_runtime_actor then
    return null;
  end if;

  if tg_table_name = 'courses' then
    v_target_id := coalesce(new.id, old.id)::text;
    if tg_op = 'INSERT' then
      v_action := 'course_created';
      v_after := jsonb_build_object('slug', new.slug, 'title', new.title, 'skillId', new.skill_id, 'difficulty', new.difficulty, 'publicationStatus', new.publication_status, 'version', new.version);
    elsif tg_op = 'UPDATE' then
      v_action := case
        when old.publication_status is distinct from new.publication_status and new.publication_status = 'published' then 'course_published'
        when old.publication_status is distinct from new.publication_status and old.publication_status = 'published' then 'course_unpublished'
        else 'course_updated'
      end;
      v_before := jsonb_build_object('slug', old.slug, 'title', old.title, 'skillId', old.skill_id, 'difficulty', old.difficulty, 'publicationStatus', old.publication_status, 'version', old.version);
      v_after := jsonb_build_object('slug', new.slug, 'title', new.title, 'skillId', new.skill_id, 'difficulty', new.difficulty, 'publicationStatus', new.publication_status, 'version', new.version);
    else
      v_action := 'course_deleted';
      v_before := jsonb_build_object('slug', old.slug, 'title', old.title, 'publicationStatus', old.publication_status);
    end if;
    perform public.record_admin_audit_log(v_action, 'courses', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'skills' then
    v_target_id := coalesce(new.id, old.id)::text;
    v_action := 'skill_' || lower(tg_op) || 'd';
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object('slug', old.slug, 'title', old.title, 'level', old.level, 'publicationStatus', old.publication_status);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object('slug', new.slug, 'title', new.title, 'level', new.level, 'publicationStatus', new.publication_status);
    end if;
    perform public.record_admin_audit_log(v_action, 'skills', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'phases' then
    v_target_id := coalesce(new.id, old.id)::text;
    v_action := 'phase_' || lower(tg_op) || 'd';
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object('courseId', old.course_id, 'title', old.title, 'position', old.position, 'publicationStatus', old.publication_status);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object('courseId', new.course_id, 'title', new.title, 'position', new.position, 'publicationStatus', new.publication_status);
    end if;
    perform public.record_admin_audit_log(v_action, 'phases', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'lessons' then
    v_target_id := coalesce(new.id, old.id)::text;
    v_action := 'lesson_' || lower(tg_op) || 'd';
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object('phaseId', old.phase_id, 'title', old.title, 'position', old.position, 'publicationStatus', old.publication_status);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object('phaseId', new.phase_id, 'title', new.title, 'position', new.position, 'publicationStatus', new.publication_status);
    end if;
    perform public.record_admin_audit_log(v_action, 'lessons', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'quizzes' then
    v_target_id := coalesce(new.id, old.id)::text;
    v_action := 'quiz_' || lower(tg_op) || 'd';
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object('title', old.title, 'quizType', old.quiz_type, 'courseId', old.course_id, 'passPercent', old.pass_percent, 'timeLimitMinutes', old.time_limit_minutes);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object('title', new.title, 'quizType', new.quiz_type, 'courseId', new.course_id, 'passPercent', new.pass_percent, 'timeLimitMinutes', new.time_limit_minutes);
    end if;
    perform public.record_admin_audit_log(v_action, 'quizzes', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'questions' then
    v_target_id := coalesce(new.id, old.id)::text;
    v_action := 'question_' || lower(tg_op) || 'd';
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object('quizId', old.quiz_id, 'position', old.position, 'questionType', old.question_type, 'marks', old.marks);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object('quizId', new.quiz_id, 'position', new.position, 'questionType', new.question_type, 'marks', new.marks);
    end if;
    perform public.record_admin_audit_log(v_action, 'questions', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'challenges' then
    v_target_id := coalesce(new.id, old.id)::text;
    v_action := 'challenge_' || lower(tg_op) || 'd';
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object('title', old.title, 'courseId', old.course_id, 'maxScore', old.max_score, 'passingScore', old.passing_score);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object('title', new.title, 'courseId', new.course_id, 'maxScore', new.max_score, 'passingScore', new.passing_score);
    end if;
    perform public.record_admin_audit_log(v_action, 'challenges', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'submissions' then
    if tg_op <> 'UPDATE' then
      return null;
    end if;
    if old.status is not distinct from new.status and old.rubric_total is not distinct from new.rubric_total then
      return null;
    end if;
    v_target_id := new.id::text;
    v_before := jsonb_build_object('status', old.status, 'rubricTotal', old.rubric_total);
    v_after := jsonb_build_object('status', new.status, 'rubricTotal', new.rubric_total, 'rubricMax', new.rubric_max, 'reviewedBy', new.reviewed_by);
    perform public.record_admin_audit_log('submission_reviewed', 'submissions', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'quiz_attempts' then
    if tg_op <> 'UPDATE' then
      return null;
    end if;
    if old.review_status is not distinct from new.review_status and old.score is not distinct from new.score then
      return null;
    end if;
    v_target_id := new.id::text;
    v_before := jsonb_build_object('reviewStatus', old.review_status, 'score', old.score, 'passed', old.passed);
    v_after := jsonb_build_object('reviewStatus', new.review_status, 'score', new.score, 'total', new.total, 'passed', new.passed, 'reviewedBy', new.reviewed_by);
    perform public.record_admin_audit_log('quiz_attempt_graded', 'quiz_attempts', v_target_id, v_before, v_after);
    return null;
  elsif tg_table_name = 'opportunities' then
    v_target_id := coalesce(new.id, old.id)::text;
    v_action := 'opportunity_' || lower(tg_op) || 'd';
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object('title', old.title, 'organization', old.organization, 'workMode', old.work_mode);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object('title', new.title, 'organization', new.organization, 'workMode', new.work_mode);
    end if;
    perform public.record_admin_audit_log(v_action, 'opportunities', v_target_id, v_before, v_after);
    return null;
  end if;

  return null;
end;
$$;

revoke all on function public.trg_capture_admin_audit() from public, anon, authenticated;

drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles after update on public.profiles for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_courses on public.courses;
create trigger trg_audit_courses after insert or update or delete on public.courses for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_skills on public.skills;
create trigger trg_audit_skills after insert or update or delete on public.skills for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_phases on public.phases;
create trigger trg_audit_phases after insert or update or delete on public.phases for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_lessons on public.lessons;
create trigger trg_audit_lessons after insert or update or delete on public.lessons for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_quizzes on public.quizzes;
create trigger trg_audit_quizzes after insert or update or delete on public.quizzes for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_questions on public.questions;
create trigger trg_audit_questions after insert or update or delete on public.questions for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_challenges on public.challenges;
create trigger trg_audit_challenges after insert or update or delete on public.challenges for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_submissions on public.submissions;
create trigger trg_audit_submissions after update on public.submissions for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_quiz_attempts on public.quiz_attempts;
create trigger trg_audit_quiz_attempts after update on public.quiz_attempts for each row execute function public.trg_capture_admin_audit();

drop trigger if exists trg_audit_opportunities on public.opportunities;
create trigger trg_audit_opportunities after insert or update or delete on public.opportunities for each row execute function public.trg_capture_admin_audit();

-- ---------------------------------------------------------------------------
-- 4. Missing Foreign-Key Indexes across schema
-- ---------------------------------------------------------------------------
create index if not exists idx_phases_skill on public.phases(skill_id);
create index if not exists idx_course_versions_created_by on public.course_versions(created_by);
create index if not exists idx_activities_lesson on public.activities(lesson_id);
create index if not exists idx_quizzes_phase on public.quizzes(phase_id);
create index if not exists idx_quizzes_lesson on public.quizzes(lesson_id);
create index if not exists idx_challenges_phase on public.challenges(phase_id);
create index if not exists idx_course_enrollments_course on public.course_enrollments(course_id);
create index if not exists idx_course_enrollments_skill on public.course_enrollments(skill_id);
create index if not exists idx_course_completions_course on public.course_completions(course_id);
create index if not exists idx_lesson_progress_lesson on public.lesson_progress(lesson_id);
create index if not exists idx_lesson_progress_course on public.lesson_progress(course_id);
create index if not exists idx_enrollments_skill on public.enrollments(skill_id);
create index if not exists idx_activity_progress_activity on public.activity_progress(activity_id);
create index if not exists idx_quiz_attempts_quiz on public.quiz_attempts(quiz_id);
create index if not exists idx_quiz_attempts_course on public.quiz_attempts(course_id);
create index if not exists idx_quiz_attempts_reviewed_by on public.quiz_attempts(reviewed_by);
create index if not exists idx_submissions_challenge on public.submissions(challenge_id);
create index if not exists idx_submissions_course on public.submissions(course_id);
create index if not exists idx_submissions_reviewed_by on public.submissions(reviewed_by);
create index if not exists idx_user_skills_skill on public.user_skills(skill_id);

-- ---------------------------------------------------------------------------
-- 5. Server-side course publish readiness validation trigger
-- ---------------------------------------------------------------------------
create or replace function public.trg_validate_course_publish_readiness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_phase boolean := false;
  v_has_lesson boolean := false;
  v_empty_lesson text;
  v_require_quiz boolean := false;
  v_require_challenge boolean := false;
  v_has_quiz boolean := false;
  v_has_challenge boolean := false;
begin
  if new.publication_status <> 'published' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.courses c
      where c.id = new.id or c.slug = new.slug
    ) then
      raise exception 'New courses must be saved as draft with published modules and lessons before publishing';
    end if;
    return new;
  end if;

  if length(trim(coalesce(new.title, ''))) < 3 then
    raise exception 'Course title must be at least 3 characters before publishing';
  end if;

  if length(trim(coalesce(new.description, ''))) < 15 then
    raise exception 'Course description must be at least 15 characters before publishing';
  end if;

  if new.skill_id is null then
    raise exception 'Course must have a primary skill before publishing';
  end if;

  if jsonb_typeof(coalesce(new.outcomes, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.outcomes, '[]'::jsonb)) < 1 then
    raise exception 'Course must have at least 1 learning objective before publishing';
  end if;

  select exists (
    select 1 from public.phases p
    where p.course_id = new.id
      and p.publication_status = 'published'
  ) into v_has_phase;

  if not v_has_phase then
    raise exception 'Course must contain at least 1 published module before publishing';
  end if;

  select exists (
    select 1
    from public.lessons l
    join public.phases p on p.id = l.phase_id
    where p.course_id = new.id
      and p.publication_status = 'published'
      and l.publication_status = 'published'
  ) into v_has_lesson;

  if not v_has_lesson then
    raise exception 'Course must contain at least 1 published lesson before publishing';
  end if;

  select l.title into v_empty_lesson
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  where p.course_id = new.id
    and p.publication_status = 'published'
    and l.publication_status = 'published'
    and (
      length(trim(coalesce(l.title, ''))) = 0
      or jsonb_typeof(coalesce(l.blocks, '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(l.blocks, '[]'::jsonb)) < 1
    )
  limit 1;

  if v_empty_lesson is not null then
    raise exception 'Published lesson "%" must contain structured content blocks before publishing course', v_empty_lesson;
  end if;

  v_require_quiz := coalesce((new.completion_rules ->> 'requireAllAssessments')::boolean, false);
  if v_require_quiz then
    select exists (
      select 1
      from public.quizzes q
      where q.course_id = new.id
        and exists (select 1 from public.questions qs where qs.quiz_id = q.id)
    ) into v_has_quiz;
    if not v_has_quiz then
      raise exception 'Course requires at least 1 configured assessment with questions before publishing';
    end if;
  end if;

  v_require_challenge := coalesce((new.completion_rules ->> 'requireChallengeSubmission')::boolean, false)
    or coalesce((new.completion_rules ->> 'requireChallengeApproval')::boolean, false);
  if v_require_challenge then
    select exists (
      select 1
      from public.challenges ch
      where ch.course_id = new.id
        and jsonb_typeof(coalesce(ch.rubric, '[]'::jsonb)) = 'array'
        and jsonb_array_length(coalesce(ch.rubric, '[]'::jsonb)) >= 1
    ) into v_has_challenge;
    if not v_has_challenge then
      raise exception 'Course requires a practical challenge with a valid rubric before publishing';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_validate_course_publish_readiness() from public, anon, authenticated;

drop trigger if exists trg_validate_course_publish_readiness on public.courses;
create trigger trg_validate_course_publish_readiness
  before insert or update on public.courses
  for each row execute function public.trg_validate_course_publish_readiness();

-- ---------------------------------------------------------------------------
-- 6. Server-side quiz_sessions table, start_quiz_session RPC & submit_quiz timer guard
-- ---------------------------------------------------------------------------
create table if not exists public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  completed_attempt_id uuid references public.quiz_attempts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_quiz_sessions_user_quiz on public.quiz_sessions(user_id, quiz_id, started_at desc);
create index if not exists idx_quiz_sessions_attempt on public.quiz_sessions(completed_attempt_id);

alter table public.quiz_sessions enable row level security;
revoke all on public.quiz_sessions from public, anon, authenticated;
grant select on public.quiz_sessions to authenticated;

drop policy if exists "quiz_sessions_select_own_or_admin" on public.quiz_sessions;
create policy "quiz_sessions_select_own_or_admin" on public.quiz_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.start_quiz_session(
  p_quiz_id uuid,
  p_restart_expired boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_quiz public.quizzes;
  v_session public.quiz_sessions;
  v_attempts_used integer := 0;
  v_now timestamptz := now();
  v_expires timestamptz := null;
begin
  if auth.uid() is null then
    raise exception 'Learner authentication required';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.account_status <> 'active' then
    raise exception 'Account is suspended or inactive';
  end if;
  if v_profile.role = 'admin' then
    raise exception 'Learner authentication required';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Assessment not found';
  end if;

  if v_quiz.course_id is not null then
    if not exists (
      select 1 from public.courses
      where id = v_quiz.course_id and publication_status = 'published'
    ) then
      raise exception 'Course assessment is not currently published';
    end if;
    if v_quiz.phase_id is not null and not exists (
      select 1 from public.phases
      where id = v_quiz.phase_id and publication_status = 'published'
    ) then
      raise exception 'Module assessment is not currently published';
    end if;
    if v_quiz.lesson_id is not null and not exists (
      select 1 from public.lessons
      where id = v_quiz.lesson_id and publication_status = 'published'
    ) then
      raise exception 'Lesson assessment is not currently published';
    end if;
    if not exists (
      select 1 from public.course_enrollments
      where user_id = auth.uid()
        and course_id = v_quiz.course_id
        and status in ('active', 'completed')
    ) then
      raise exception 'Active course enrollment required to start this assessment';
    end if;
  else
    if not exists (
      select 1 from public.skills
      where id = v_quiz.skill_id and publication_status = 'published'
    ) then
      raise exception 'Assessment skill is not currently published';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('quiz_session:' || auth.uid()::text || ':' || p_quiz_id::text));

  select count(*) into v_attempts_used
  from public.quiz_attempts
  where user_id = auth.uid() and quiz_id = p_quiz_id;

  if v_quiz.max_attempts is not null and v_attempts_used >= v_quiz.max_attempts then
    raise exception 'Maximum number of attempts reached for this assessment';
  end if;

  select * into v_session
  from public.quiz_sessions
  where user_id = auth.uid()
    and quiz_id = p_quiz_id
    and status = 'active'
    and completed_attempt_id is null
  order by started_at desc
  limit 1;

  if found then
    if v_session.expires_at is null or v_session.expires_at >= v_now then
      return jsonb_build_object(
        'sessionId', v_session.id,
        'quizId', v_session.quiz_id,
        'startedAt', v_session.started_at,
        'expiresAt', v_session.expires_at,
        'serverNow', v_now,
        'expired', false
      );
    elsif not coalesce(p_restart_expired, false) then
      return jsonb_build_object(
        'sessionId', v_session.id,
        'quizId', v_session.quiz_id,
        'startedAt', v_session.started_at,
        'expiresAt', v_session.expires_at,
        'serverNow', v_now,
        'expired', true
      );
    else
      update public.quiz_sessions
      set status = 'expired'
      where id = v_session.id;
    end if;
  end if;

  if v_quiz.time_limit_minutes is not null and v_quiz.time_limit_minutes > 0 then
    v_expires := v_now + make_interval(mins => v_quiz.time_limit_minutes);
  end if;

  insert into public.quiz_sessions (user_id, quiz_id, status, started_at, expires_at)
  values (auth.uid(), p_quiz_id, 'active', v_now, v_expires)
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'quizId', v_session.quiz_id,
    'startedAt', v_session.started_at,
    'expiresAt', v_session.expires_at,
    'serverNow', v_now,
    'expired', false
  );
end;
$$;

revoke all on function public.start_quiz_session(uuid, boolean) from public, anon;
grant execute on function public.start_quiz_session(uuid, boolean) to authenticated;

-- Update submit_quiz to verify active account_status and server-side timer session
create or replace function public.submit_quiz(
  p_quiz_id uuid,
  p_answers jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_quiz public.quizzes;
  v_session public.quiz_sessions;
  v_q record;
  v_raw jsonb;
  v_raw_text text;
  v_selected integer;
  v_opt_len integer;
  v_score integer := 0;
  v_total integer := 0;
  v_pct integer := 0;
  v_passed boolean := false;
  v_has_manual boolean := false;
  v_review_status text := 'auto_graded';
  v_solutions_released boolean := false;
  v_results jsonb := '[]'::jsonb;
  v_existing public.quiz_attempts;
  v_attempt_id uuid;
  v_attempt_num integer := 1;
  v_is_correct boolean;
  v_sel_sorted jsonb;
  v_exp_sorted jsonb;
  v_exp_order jsonb;
  v_clean_answers jsonb := '{}'::jsonb;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_replay boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Learner authentication required';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.account_status <> 'active' then
    raise exception 'Account is suspended or inactive';
  end if;
  if v_profile.role = 'admin' then
    raise exception 'Learner authentication required';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers payload must be a JSON object';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Assessment not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('submit_quiz:' || auth.uid()::text || ':' || p_quiz_id::text));

  if v_idem is not null then
    select * into v_existing
    from public.quiz_attempts
    where user_id = auth.uid() and idempotency_key = v_idem;
    if found then
      if v_existing.quiz_id <> p_quiz_id then
        raise exception 'Idempotency key already used for a different assessment';
      end if;
      v_replay := true;
    end if;
  end if;

  if v_quiz.course_id is not null then
    if not exists (
      select 1 from public.courses
      where id = v_quiz.course_id and publication_status = 'published'
    ) then
      raise exception 'Course assessment is not currently published';
    end if;

    if v_quiz.phase_id is not null and not exists (
      select 1 from public.phases
      where id = v_quiz.phase_id and publication_status = 'published'
    ) then
      raise exception 'Module assessment is not currently published';
    end if;

    if v_quiz.lesson_id is not null and not exists (
      select 1 from public.lessons
      where id = v_quiz.lesson_id and publication_status = 'published'
    ) then
      raise exception 'Lesson assessment is not currently published';
    end if;

    if not exists (
      select 1 from public.course_enrollments
      where user_id = auth.uid()
        and course_id = v_quiz.course_id
        and status in ('active', 'completed')
    ) then
      raise exception 'Active course enrollment required to submit this assessment';
    end if;
  else
    if not exists (
      select 1 from public.skills
      where id = v_quiz.skill_id and publication_status = 'published'
    ) then
      raise exception 'Assessment skill is not currently published';
    end if;
  end if;

  if not v_replay then
    select count(*) + 1 into v_attempt_num
    from public.quiz_attempts
    where user_id = auth.uid() and quiz_id = p_quiz_id;

    if v_quiz.max_attempts is not null and (v_attempt_num - 1) >= v_quiz.max_attempts then
      raise exception 'Maximum number of attempts reached for this assessment';
    end if;

    if v_quiz.time_limit_minutes is not null and v_quiz.time_limit_minutes > 0 then
      select * into v_session
      from public.quiz_sessions
      where user_id = auth.uid()
        and quiz_id = p_quiz_id
        and status = 'active'
        and completed_attempt_id is null
      order by started_at desc
      limit 1;

      if not found then
        raise exception 'Active assessment session required before submitting a timed assessment';
      end if;

      if v_session.expires_at is not null and now() > (v_session.expires_at + interval '30 seconds') then
        raise exception 'Assessment time limit exceeded for this session';
      end if;
    end if;
  end if;

  for v_q in
    select id, position, question_type, marks, prompt, options, correct_index, answer_config, explanation
    from public.questions
    where quiz_id = p_quiz_id
    order by position asc
  loop
    v_total := v_total + greatest(1, coalesce(v_q.marks, 1));
    if v_replay then
      v_raw := v_existing.answers -> (v_q.id::text);
    else
      v_raw := p_answers -> (v_q.id::text);
    end if;
    v_is_correct := false;
    v_opt_len := coalesce(jsonb_array_length(v_q.options), 0);

    if v_raw is not null then
      v_clean_answers := v_clean_answers || jsonb_build_object(v_q.id::text, v_raw);
    end if;

    if v_q.question_type in ('short_answer', 'long_form', 'practical_submission') then
      v_has_manual := true;
    elsif v_q.question_type = 'multiple_select' then
      if v_raw is not null and jsonb_typeof(v_raw) = 'array' then
        if not exists (
          select 1 from jsonb_array_elements_text(v_raw) val
          where val !~ '^\d+$' or val::int < 0 or val::int >= v_opt_len
        ) then
          select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_sel_sorted
          from jsonb_array_elements_text(v_raw) val;

          select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_exp_sorted
          from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'correctIndices', '[]'::jsonb)) val
          where val ~ '^\d+$';

          v_is_correct := jsonb_array_length(v_exp_sorted) > 0 and v_sel_sorted = v_exp_sorted;
        end if;
      end if;
    elsif v_q.question_type = 'fill_blank' then
      v_is_correct := exists (
        select 1
        from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'acceptedAnswers', '[]'::jsonb)) acc
        where lower(regexp_replace(trim(acc), '\s+', ' ', 'g')) =
              lower(regexp_replace(trim(coalesce(v_raw #>> '{}', '')), '\s+', ' ', 'g'))
          and trim(coalesce(v_raw #>> '{}', '')) <> ''
      );
    elsif v_q.question_type = 'ordering' then
      v_exp_order := coalesce(v_q.answer_config -> 'correctOrder', '[]'::jsonb);
      if v_raw is not null
         and jsonb_typeof(v_raw) = 'array'
         and jsonb_array_length(v_raw) = jsonb_array_length(v_exp_order)
         and jsonb_array_length(v_exp_order) >= 2 then
        v_is_correct := not exists (
          select 1
          from generate_series(0, jsonb_array_length(v_exp_order) - 1) idx
          where (v_raw ->> idx) !~ '^\d+$'
             or (v_exp_order ->> idx) !~ '^\d+$'
             or (v_raw ->> idx)::int <> (v_exp_order ->> idx)::int
        );
      end if;
    elsif v_q.question_type = 'true_false' then
      v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
      if v_raw_text ~ '^\d+$' then
        v_selected := v_raw_text::integer;
        if v_selected >= 0 and v_selected < coalesce(nullif(v_opt_len, 0), 2) then
          v_is_correct := (v_selected = v_q.correct_index);
        end if;
      end if;
    else
      v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
      if v_raw_text ~ '^\d+$' then
        v_selected := v_raw_text::integer;
        if v_selected >= 0 and v_selected < v_opt_len then
          v_is_correct := (v_selected = v_q.correct_index);
        end if;
      end if;
    end if;

    if v_is_correct then
      v_score := v_score + greatest(1, coalesce(v_q.marks, 1));
    end if;

    v_results := v_results || jsonb_build_object(
      'questionId', v_q.id,
      'questionType', v_q.question_type,
      'marks', greatest(1, coalesce(v_q.marks, 1)),
      'earnedMarks', case when v_is_correct then greatest(1, coalesce(v_q.marks, 1)) else 0 end,
      'isCorrect', v_is_correct,
      'pendingReview', v_q.question_type in ('short_answer', 'long_form', 'practical_submission'),
      'correctIndex', v_q.correct_index,
      'answerConfig', v_q.answer_config,
      'explanation', v_q.explanation
    );
  end loop;

  if v_replay then
    v_solutions_released := (v_existing.review_status <> 'pending_review')
      and (v_existing.passed or (v_quiz.max_attempts is not null and v_existing.attempt_number >= v_quiz.max_attempts));
    if not v_solutions_released then
      select coalesce(jsonb_agg(
        (elem - 'correctIndex' - 'answerConfig' - 'explanation')
        || jsonb_build_object('correctIndex', null, 'answerConfig', '{}'::jsonb, 'explanation', null)
      ), '[]'::jsonb)
      into v_results
      from jsonb_array_elements(v_results) elem;
    end if;
    return jsonb_build_object(
      'attemptId', v_existing.id,
      'quizId', v_existing.quiz_id,
      'attemptNumber', v_existing.attempt_number,
      'score', v_existing.score,
      'total', v_existing.total,
      'percentage', v_existing.percentage,
      'passed', v_existing.passed,
      'reviewStatus', v_existing.review_status,
      'solutionsReleased', v_solutions_released,
      'results', v_results
    );
  end if;

  if v_total <= 0 then
    raise exception 'Assessment has no configured questions';
  end if;

  v_pct := round((v_score::numeric / v_total::numeric) * 100);

  if v_has_manual or v_quiz.requires_manual_review then
    v_review_status := 'pending_review';
    v_passed := false;
  else
    v_passed := v_pct >= v_quiz.pass_percent;
  end if;

  v_solutions_released := (v_review_status <> 'pending_review')
    and (v_passed or (v_quiz.max_attempts is not null and v_attempt_num >= v_quiz.max_attempts));

  if not v_solutions_released then
    select coalesce(jsonb_agg(
      (elem - 'correctIndex' - 'answerConfig' - 'explanation')
      || jsonb_build_object('correctIndex', null, 'answerConfig', '{}'::jsonb, 'explanation', null)
    ), '[]'::jsonb)
    into v_results
    from jsonb_array_elements(v_results) elem;
  end if;

  insert into public.quiz_attempts (
    user_id, quiz_id, course_id, attempt_number, answers, score, total, percentage, passed, review_status, idempotency_key
  )
  values (
    auth.uid(), p_quiz_id, v_quiz.course_id, v_attempt_num, v_clean_answers, v_score, v_total, v_pct, v_passed, v_review_status, v_idem
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null and v_idem is not null then
    select id into v_attempt_id
    from public.quiz_attempts
    where user_id = auth.uid() and idempotency_key = v_idem;
  end if;

  if v_session.id is not null and v_attempt_id is not null then
    update public.quiz_sessions
    set status = 'completed',
        completed_attempt_id = v_attempt_id
    where id = v_session.id;
  end if;

  if v_passed then
    perform public.recompute_user_skill_level(auth.uid(), v_quiz.skill_id);
    if v_quiz.course_id is not null then
      perform public.evaluate_course_and_skill_progression(auth.uid(), v_quiz.course_id);
    end if;
  end if;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'quizId', p_quiz_id,
    'attemptNumber', v_attempt_num,
    'score', v_score,
    'total', v_total,
    'percentage', v_pct,
    'passed', v_passed,
    'reviewStatus', v_review_status,
    'solutionsReleased', v_solutions_released,
    'results', v_results
  );
end;
$$;

revoke all on function public.submit_quiz(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_quiz(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Enforce active account_status in remaining learner RPCs & get_dashboard()
-- ---------------------------------------------------------------------------
create or replace function public.declare_user_skill(p_skill_id uuid)
returns public.user_skills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skill public.skills;
  row_out public.user_skills;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  select * into v_skill from public.skills where id = p_skill_id;
  if not found or v_skill.publication_status <> 'published' then
    raise exception 'Published skill not found';
  end if;

  perform public.upgrade_user_skill_level(auth.uid(), p_skill_id, 'declared');
  select * into row_out
  from public.user_skills
  where user_id = auth.uid() and skill_id = p_skill_id;
  return row_out;
end;
$$;

revoke all on function public.declare_user_skill(uuid) from public, anon;
grant execute on function public.declare_user_skill(uuid) to authenticated;

create or replace function public.enroll_in_course(p_course_id uuid)
returns public.course_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_projected timestamptz;
  v_enrollment public.course_enrollments;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  select * into v_course
  from public.courses
  where id = p_course_id and publication_status = 'published';
  if not found then
    raise exception 'Published course not found';
  end if;

  v_projected := now() + make_interval(days => greatest(7, coalesce(v_course.estimated_duration_weeks, 4) * 7));

  insert into public.course_enrollments (
    user_id, course_id, skill_id, status, completion_state, enrolled_at, projected_completion_at, updated_at
  )
  values (
    auth.uid(), p_course_id, v_course.skill_id, 'active', 'in_progress', now(), v_projected, now()
  )
  on conflict (user_id, course_id) do update set
    status = case
      when public.course_enrollments.status = 'completed' then 'completed'
      else 'active'
    end,
    projected_completion_at = coalesce(public.course_enrollments.projected_completion_at, excluded.projected_completion_at),
    updated_at = now()
  returning * into v_enrollment;

  insert into public.enrollments (user_id, skill_id, status, enrolled_at, updated_at)
  values (auth.uid(), v_course.skill_id, 'active', now(), now())
  on conflict (user_id, skill_id) do update set
    status = case
      when public.enrollments.status = 'completed' then 'completed'
      else 'active'
    end,
    updated_at = now();

  perform public.upgrade_user_skill_level(auth.uid(), v_course.skill_id, 'declared');
  perform public.evaluate_course_and_skill_progression(auth.uid(), p_course_id);

  select * into v_enrollment
  from public.course_enrollments
  where user_id = auth.uid() and course_id = p_course_id;
  return v_enrollment;
end;
$$;

revoke all on function public.enroll_in_course(uuid) from public, anon;
grant execute on function public.enroll_in_course(uuid) to authenticated;

create or replace function public.set_course_enrollment_status(
  p_course_id uuid,
  p_status text
)
returns public.course_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.course_enrollments;
  v_updated public.course_enrollments;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  if p_status not in ('active', 'paused') then
    raise exception 'Status must be active or paused';
  end if;

  select * into v_existing
  from public.course_enrollments
  where user_id = auth.uid() and course_id = p_course_id;

  if not found then
    raise exception 'Course enrollment not found';
  end if;

  if v_existing.status = 'completed' then
    raise exception 'Completed courses cannot be paused or reverted directly';
  end if;

  update public.course_enrollments
  set status = p_status,
      updated_at = now()
  where id = v_existing.id
  returning * into v_updated;

  update public.enrollments
  set status = case
        when exists (
          select 1 from public.course_enrollments ce
          where ce.user_id = auth.uid() and ce.skill_id = v_existing.skill_id and ce.status = 'active'
        ) then 'active'
        when exists (
          select 1 from public.course_enrollments ce
          where ce.user_id = auth.uid() and ce.skill_id = v_existing.skill_id and ce.status = 'completed'
        ) then 'completed'
        else 'paused'
      end,
      updated_at = now()
  where user_id = auth.uid() and skill_id = v_existing.skill_id;

  return v_updated;
end;
$$;

revoke all on function public.set_course_enrollment_status(uuid, text) from public, anon;
grant execute on function public.set_course_enrollment_status(uuid, text) to authenticated;

create or replace function public.save_lesson_notes(
  p_lesson_id uuid,
  p_notes text
)
returns public.lesson_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_clean_notes text := coalesce(p_notes, '');
  v_row public.lesson_progress;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  if length(v_clean_notes) > 20000 then
    raise exception 'Lesson notes cannot exceed 20,000 characters';
  end if;

  select c.id into v_course_id
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  join public.courses c on c.id = p.course_id
  where l.id = p_lesson_id
    and l.publication_status = 'published'
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  if v_course_id is null then
    raise exception 'Published lesson not found';
  end if;

  if not exists (
    select 1 from public.course_enrollments ce
    where ce.user_id = auth.uid()
      and ce.course_id = v_course_id
      and ce.status in ('active', 'completed')
  ) then
    raise exception 'Active course enrollment required to save lesson notes';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, course_id, notes, completed, updated_at)
  values (auth.uid(), p_lesson_id, v_course_id, v_clean_notes, false, now())
  on conflict (user_id, lesson_id) do update set
    notes = excluded.notes,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.save_lesson_notes(uuid, text) from public, anon;
grant execute on function public.save_lesson_notes(uuid, text) to authenticated;

create or replace function public.set_lesson_completion(
  p_lesson_id uuid,
  p_completed boolean
)
returns public.lesson_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_est_minutes integer := 25;
  v_completed boolean := coalesce(p_completed, true);
  v_row public.lesson_progress;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  select c.id, greatest(1, coalesce(l.est_minutes, 25))
  into v_course_id, v_est_minutes
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  join public.courses c on c.id = p.course_id
  where l.id = p_lesson_id
    and l.publication_status = 'published'
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  if v_course_id is null then
    raise exception 'Published lesson not found';
  end if;

  if not exists (
    select 1 from public.course_enrollments ce
    where ce.user_id = auth.uid()
      and ce.course_id = v_course_id
      and ce.status in ('active', 'completed')
  ) then
    raise exception 'Active course enrollment required to complete lessons';
  end if;

  insert into public.lesson_progress (
    user_id, lesson_id, course_id, completed, minutes_spent, completed_at, updated_at
  )
  values (
    auth.uid(),
    p_lesson_id,
    v_course_id,
    v_completed,
    case when v_completed then v_est_minutes else null end,
    case when v_completed then now() else null end,
    now()
  )
  on conflict (user_id, lesson_id) do update set
    completed = excluded.completed,
    minutes_spent = case when excluded.completed then v_est_minutes else null end,
    completed_at = case when excluded.completed then coalesce(public.lesson_progress.completed_at, now()) else null end,
    updated_at = now()
  returning * into v_row;

  perform public.evaluate_course_and_skill_progression(auth.uid(), v_course_id);
  return v_row;
end;
$$;

revoke all on function public.set_lesson_completion(uuid, boolean) from public, anon;
grant execute on function public.set_lesson_completion(uuid, boolean) to authenticated;

create or replace function public.set_activity_completion(
  p_activity_id uuid,
  p_completed boolean,
  p_notes text default null
)
returns public.activity_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_est_minutes integer := 20;
  v_completed boolean := coalesce(p_completed, true);
  v_row public.activity_progress;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  if p_notes is not null and length(p_notes) > 20000 then
    raise exception 'Activity notes cannot exceed 20,000 characters';
  end if;

  select c.id, greatest(1, coalesce(a.est_minutes, 20))
  into v_course_id, v_est_minutes
  from public.activities a
  join public.phases p on p.id = a.phase_id
  join public.courses c on c.id = p.course_id
  where a.id = p_activity_id
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  if v_course_id is null then
    raise exception 'Published phase activity not found';
  end if;

  if not exists (
    select 1 from public.course_enrollments ce
    where ce.user_id = auth.uid()
      and ce.course_id = v_course_id
      and ce.status in ('active', 'completed')
  ) then
    raise exception 'Active course enrollment required to track activities';
  end if;

  insert into public.activity_progress (
    user_id, activity_id, notes, completed, minutes_spent, completed_at, updated_at
  )
  values (
    auth.uid(),
    p_activity_id,
    coalesce(p_notes, ''),
    v_completed,
    case when v_completed then v_est_minutes else null end,
    case when v_completed then now() else null end,
    now()
  )
  on conflict (user_id, activity_id) do update set
    notes = case when p_notes is not null then p_notes else public.activity_progress.notes end,
    completed = excluded.completed,
    minutes_spent = case when excluded.completed then v_est_minutes else null end,
    completed_at = case when excluded.completed then coalesce(public.activity_progress.completed_at, now()) else null end,
    updated_at = now()
  returning * into v_row;

  perform public.evaluate_course_and_skill_progression(auth.uid(), v_course_id);
  return v_row;
end;
$$;

revoke all on function public.set_activity_completion(uuid, boolean, text) from public, anon;
grant execute on function public.set_activity_completion(uuid, boolean, text) to authenticated;

create or replace function public.submit_challenge_evidence(
  p_challenge_id uuid,
  p_evidence_url text default null,
  p_repo_url text default null,
  p_file_path text default null,
  p_file_name text default null,
  p_submission_text text default '',
  p_explanation text default '',
  p_idempotency_key text default null
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.challenges;
  v_existing public.submissions;
  v_row public.submissions;
  v_obj record;
  v_evidence_url text := nullif(trim(coalesce(p_evidence_url, '')), '');
  v_repo_url text := nullif(trim(coalesce(p_repo_url, '')), '');
  v_file_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_file_name text := nullif(trim(coalesce(p_file_name, '')), '');
  v_sub_text text := trim(coalesce(p_submission_text, ''));
  v_explanation text := trim(coalesce(p_explanation, ''));
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_allowed_types jsonb;
  v_allowed_mimes jsonb;
  v_max_bytes bigint;
  v_obj_size bigint;
  v_obj_mime text;
  v_file_ext text;
  v_rubric_max integer := 0;
  v_crit jsonb;
  v_has_file_evidence boolean := false;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id;
  if not found then
    raise exception 'Challenge not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('submit_challenge:' || auth.uid()::text || ':' || p_challenge_id::text));

  if v_idem is not null then
    select * into v_existing
    from public.submissions
    where user_id = auth.uid() and idempotency_key = v_idem;
    if found then
      if v_existing.challenge_id <> p_challenge_id then
        raise exception 'Idempotency key already used for a different challenge';
      end if;
      return v_existing;
    end if;
  end if;

  if v_challenge.course_id is not null then
    if not exists (
      select 1 from public.courses
      where id = v_challenge.course_id and publication_status = 'published'
    ) then
      raise exception 'Course challenge is not currently published';
    end if;

    if v_challenge.phase_id is not null and not exists (
      select 1 from public.phases
      where id = v_challenge.phase_id and publication_status = 'published'
    ) then
      raise exception 'Module challenge is not currently published';
    end if;

    if not exists (
      select 1 from public.course_enrollments
      where user_id = auth.uid()
        and course_id = v_challenge.course_id
        and status in ('active', 'completed')
    ) then
      raise exception 'Active course enrollment required before submitting evidence';
    end if;
  else
    if not exists (
      select 1 from public.skills
      where id = v_challenge.skill_id and publication_status = 'published'
    ) then
      raise exception 'Skill is not currently published';
    end if;
  end if;

  if length(v_explanation) < 20 then
    raise exception 'Submission explanation must be at least 20 characters';
  end if;

  v_allowed_types := coalesce(
    v_challenge.allowed_evidence_types,
    '["written","file","project_url","repo_url","screenshot","audio","video"]'::jsonb
  );
  v_allowed_mimes := coalesce(v_challenge.allowed_mime_types, '[]'::jsonb);
  v_max_bytes := greatest(1, coalesce(v_challenge.max_file_size_mb, 25))::bigint * 1024 * 1024;

  if v_evidence_url is not null then
    if not (v_allowed_types ? 'project_url') then
      raise exception 'Project URL submissions are not permitted for this challenge';
    end if;
    if length(v_evidence_url) > 1000 or v_evidence_url !~* '^https?://' then
      raise exception 'Evidence URL must begin with https:// or http://';
    end if;
  end if;

  if v_repo_url is not null then
    if not (v_allowed_types ? 'repo_url') then
      raise exception 'Repository URL submissions are not permitted for this challenge';
    end if;
    if length(v_repo_url) > 1000 or v_repo_url !~* '^https?://' then
      raise exception 'Repository URL must begin with https:// or http://';
    end if;
  end if;

  if length(v_sub_text) > 0 then
    if length(v_sub_text) < 20 and v_evidence_url is null and v_repo_url is null and v_file_path is null then
      raise exception 'Written deliverable must be at least 20 characters';
    end if;
    if not (v_allowed_types ? 'written') then
      raise exception 'Written text deliverables are not permitted for this challenge';
    end if;
  end if;

  if v_file_path is not null then
    v_has_file_evidence := (
      (v_allowed_types ? 'file')
      or (v_allowed_types ? 'screenshot')
      or (v_allowed_types ? 'audio')
      or (v_allowed_types ? 'video')
    );
    if not v_has_file_evidence then
      raise exception 'File uploads are not permitted for this challenge';
    end if;

    if position('..' in v_file_path) > 0
       or left(v_file_path, 1) = '/'
       or split_part(v_file_path, '/', 1) <> auth.uid()::text
       or coalesce(array_length(string_to_array(v_file_path, '/'), 1), 0) < 2 then
      raise exception 'Invalid evidence file ownership path';
    end if;

    select o.id, o.owner, o.owner_id, o.metadata
    into v_obj
    from storage.objects o
    where o.bucket_id = 'evidence' and o.name = v_file_path;

    if not found then
      raise exception 'Uploaded evidence file not found in private storage';
    end if;

    if (v_obj.owner is not null and v_obj.owner <> auth.uid())
       or (nullif(v_obj.owner_id, '') is not null and v_obj.owner_id <> auth.uid()::text) then
      raise exception 'Uploaded evidence file is not owned by the submitting learner';
    end if;

    if exists (
      select 1 from public.submissions s
      where s.file_path = v_file_path
        and (s.user_id <> auth.uid() or s.challenge_id <> p_challenge_id)
    ) then
      raise exception 'Uploaded evidence file cannot be reused across submissions';
    end if;

    v_file_ext := lower(coalesce(nullif(regexp_replace(v_file_path, '^.*\.', ''), v_file_path), ''));
    if v_file_ext = '' or not (v_file_ext = any(array[
      'pdf','png','jpg','jpeg','webp','txt','md','csv','zip','docx',
      'mp3','wav','m4a','webm','ogg','mp4','mov'
    ])) then
      raise exception 'Evidence file extension ".%" is not permitted', v_file_ext;
    end if;

    if coalesce(v_obj.metadata ->> 'size', '') ~ '^\d+$' then
      v_obj_size := (v_obj.metadata ->> 'size')::bigint;
      if v_obj_size <= 0 or v_obj_size > v_max_bytes then
        raise exception 'Uploaded evidence file exceeds the % MB limit for this challenge', greatest(1, coalesce(v_challenge.max_file_size_mb, 25));
      end if;
    end if;

    v_obj_mime := lower(nullif(trim(coalesce(v_obj.metadata ->> 'mimetype', '')), ''));
    if v_obj_mime is not null then
      if jsonb_typeof(v_allowed_mimes) = 'array' and jsonb_array_length(v_allowed_mimes) > 0 then
        if not exists (
          select 1 from jsonb_array_elements_text(v_allowed_mimes) m where lower(m) = v_obj_mime
        ) then
          raise exception 'File MIME type "%" is not permitted for this challenge', v_obj_mime;
        end if;
      end if;

      if not (v_allowed_types ? 'file') then
        if (v_allowed_types ? 'screenshot') and not (v_allowed_types ? 'audio') and not (v_allowed_types ? 'video')
           and v_obj_mime not like 'image/%' then
          raise exception 'Challenge only accepts image screenshot uploads';
        elsif not (v_allowed_types ? 'screenshot') and ((v_allowed_types ? 'audio') or (v_allowed_types ? 'video'))
           and v_obj_mime not like 'audio/%' and v_obj_mime not like 'video/%' then
          raise exception 'Challenge only accepts audio or video media uploads';
        end if;
      end if;
    end if;
  end if;

  if v_evidence_url is null and v_repo_url is null and v_file_path is null and length(v_sub_text) < 20 then
    raise exception 'Provide a valid project URL, repository URL, uploaded file, or written deliverable (20+ chars)';
  end if;

  if jsonb_typeof(v_challenge.rubric) = 'array' and jsonb_array_length(v_challenge.rubric) > 0 then
    for v_crit in select value from jsonb_array_elements(v_challenge.rubric) loop
      v_rubric_max := v_rubric_max + greatest(1, coalesce((v_crit ->> 'maxPoints')::integer, 5));
    end loop;
  end if;
  if v_rubric_max <= 0 then
    v_rubric_max := greatest(1, coalesce(v_challenge.max_score, 20));
  end if;

  insert into public.submissions (
    user_id, challenge_id, course_id, evidence_url, repo_url, file_path, file_name,
    submission_text, explanation, status, rubric_scores, rubric_total, rubric_max,
    feedback, reviewed_by, reviewed_at, idempotency_key
  )
  values (
    auth.uid(),
    p_challenge_id,
    v_challenge.course_id,
    v_evidence_url,
    v_repo_url,
    v_file_path,
    v_file_name,
    v_sub_text,
    v_explanation,
    'pending',
    '{}'::jsonb,
    null,
    v_rubric_max,
    '',
    null,
    null,
    v_idem
  )
  on conflict (user_id, idempotency_key) do nothing
  returning * into v_row;

  if v_row.id is null and v_idem is not null then
    select * into v_row
    from public.submissions
    where user_id = auth.uid() and idempotency_key = v_idem;
  end if;

  if v_challenge.course_id is not null then
    perform public.evaluate_course_and_skill_progression(auth.uid(), v_challenge.course_id);
  end if;

  return v_row;
end;
$$;

revoke all on function public.submit_challenge_evidence(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_challenge_evidence(uuid, text, text, text, text, text, text, text) to authenticated;

-- Update get_dashboard() to require an active profile account_status
create or replace function public.get_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_status text;
  v_completed_lessons integer := 0;
  v_completed_activities integer := 0;
  v_total_minutes integer := 0;
  v_active_courses integer := 0;
  v_paused_courses integer := 0;
  v_completed_courses integer := 0;
  v_passed_quizzes integer := 0;
  v_total_attempts integer := 0;
  v_avg_score integer := 0;
  v_approved_subs integer := 0;
  v_pending_subs integer := 0;
  v_revision_subs integer := 0;
  v_total_subs integer := 0;
  v_skills jsonb := '[]'::jsonb;
  v_enrolled_courses jsonb := '[]'::jsonb;
  v_weekly_minutes jsonb := '[]'::jsonb;
  v_hourly_distribution jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select account_status into v_account_status from public.profiles where id = v_uid;
  if v_account_status is distinct from 'active' then
    raise exception 'Account is suspended or inactive';
  end if;

  select count(*), coalesce(sum(coalesce(lp.minutes_spent, l.est_minutes)), 0)::int
  into v_completed_lessons, v_total_minutes
  from public.lesson_progress lp
  join public.lessons l on l.id = lp.lesson_id
  join public.phases p on p.id = l.phase_id
  join public.courses c on c.id = p.course_id
  where lp.user_id = v_uid
    and lp.completed = true
    and l.publication_status = 'published'
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  select count(*) into v_completed_activities
  from public.activity_progress ap
  join public.activities a on a.id = ap.activity_id
  join public.phases p on p.id = a.phase_id
  join public.courses c on c.id = p.course_id
  where ap.user_id = v_uid
    and ap.completed = true
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  select
    count(*) filter (where ce.status = 'active'),
    count(*) filter (where ce.status = 'paused'),
    count(*) filter (where ce.status = 'completed')
  into v_active_courses, v_paused_courses, v_completed_courses
  from public.course_enrollments ce
  join public.courses c on c.id = ce.course_id
  where ce.user_id = v_uid
    and c.publication_status = 'published';

  select
    count(distinct qa.quiz_id) filter (where qa.passed and qa.review_status in ('auto_graded', 'reviewed', 'graded')),
    count(*),
    coalesce(round(avg(qa.percentage))::int, 0)
  into v_passed_quizzes, v_total_attempts, v_avg_score
  from public.quiz_attempts qa
  where qa.user_id = v_uid;

  select
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'needs_revision'),
    count(*)
  into v_approved_subs, v_pending_subs, v_revision_subs, v_total_subs
  from public.submissions
  where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'skillId', s.id,
    'slug', s.slug,
    'title', s.title,
    'category', s.category,
    'level', us.level,
    'updatedAt', us.updated_at
  ) order by us.updated_at desc), '[]'::jsonb)
  into v_skills
  from public.user_skills us
  join public.skills s on s.id = us.skill_id
  where us.user_id = v_uid
    and s.publication_status = 'published';

  with course_stats as (
    select
      c.id as course_id,
      c.slug,
      c.title,
      coalesce(sk.title, '') as skill_title,
      coalesce(sk.slug, '') as skill_slug,
      c.difficulty,
      c.estimated_duration_weeks,
      ce.status,
      coalesce(cc.completion_state, ce.completion_state, 'in_progress') as completion_state,
      coalesce(cc.practical_approved, false) as practical_approved,
      ce.projected_completion_at,
      ce.updated_at,
      (
        select count(*)
        from public.lessons l
        join public.phases p on p.id = l.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and l.publication_status = 'published'
          and l.is_required = true
      )::int as req_lessons,
      (
        select count(*)
        from public.lesson_progress lp
        join public.lessons l on l.id = lp.lesson_id
        join public.phases p on p.id = l.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and l.publication_status = 'published'
          and l.is_required = true
          and lp.user_id = v_uid
          and lp.completed = true
      )::int as done_lessons,
      (
        select count(*)
        from public.activities a
        join public.phases p on p.id = a.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and a.is_required = true
      )::int as req_activities,
      (
        select count(*)
        from public.activity_progress ap
        join public.activities a on a.id = ap.activity_id
        join public.phases p on p.id = a.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and a.is_required = true
          and ap.user_id = v_uid
          and ap.completed = true
      )::int as done_activities,
      (
        select count(*)
        from public.quizzes q
        where q.course_id = c.id
          and (q.phase_id is null or exists (select 1 from public.phases p where p.id = q.phase_id and p.publication_status = 'published'))
          and (q.lesson_id is null or exists (select 1 from public.lessons l where l.id = q.lesson_id and l.publication_status = 'published'))
      )::int as req_quizzes,
      (
        select count(distinct qa.quiz_id)
        from public.quiz_attempts qa
        join public.quizzes q on q.id = qa.quiz_id
        where q.course_id = c.id
          and (q.phase_id is null or exists (select 1 from public.phases p where p.id = q.phase_id and p.publication_status = 'published'))
          and (q.lesson_id is null or exists (select 1 from public.lessons l where l.id = q.lesson_id and l.publication_status = 'published'))
          and qa.user_id = v_uid
          and qa.passed = true
          and qa.review_status in ('auto_graded', 'reviewed', 'graded')
      )::int as passed_quizzes,
      (
        select count(*)
        from public.challenges ch
        where ch.course_id = c.id
          and ch.is_required = true
          and (ch.phase_id is null or exists (select 1 from public.phases p where p.id = ch.phase_id and p.publication_status = 'published'))
      )::int as req_challenges,
      (
        select count(distinct s.challenge_id)
        from public.submissions s
        join public.challenges ch on ch.id = s.challenge_id
        where ch.course_id = c.id
          and ch.is_required = true
          and (ch.phase_id is null or exists (select 1 from public.phases p where p.id = ch.phase_id and p.publication_status = 'published'))
          and s.user_id = v_uid
          and s.status = 'approved'
      )::int as approved_challenges
    from public.course_enrollments ce
    join public.courses c on c.id = ce.course_id
    left join public.skills sk on sk.id = c.skill_id
    left join public.course_completions cc on cc.user_id = ce.user_id and cc.course_id = ce.course_id
    where ce.user_id = v_uid
      and c.publication_status = 'published'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cs.course_id,
    'slug', cs.slug,
    'title', cs.title,
    'skillTitle', cs.skill_title,
    'skillSlug', cs.skill_slug,
    'difficulty', cs.difficulty,
    'estimatedDurationWeeks', cs.estimated_duration_weeks,
    'status', cs.status,
    'completionState', cs.completion_state,
    'progress', jsonb_build_object(
      'requiredLessonsCount', cs.req_lessons,
      'completedLessonsCount', cs.done_lessons,
      'requiredActivitiesCount', cs.req_activities,
      'completedActivitiesCount', cs.done_activities,
      'assessmentsCount', cs.req_quizzes,
      'passedAssessmentsCount', cs.passed_quizzes,
      'challengesCount', cs.req_challenges,
      'approvedChallengesCount', cs.approved_challenges,
      'practicalApproved', cs.practical_approved,
      'completionState', cs.completion_state,
      'isCompleted', (cs.status = 'completed' or cs.completion_state in ('completed', 'completed_verified')),
      'progressPercent', case
        when (cs.req_lessons + cs.req_activities + cs.req_quizzes + cs.req_challenges) > 0 then
          least(100, round(
            ((cs.done_lessons + cs.done_activities + cs.passed_quizzes + cs.approved_challenges)::numeric
              / (cs.req_lessons + cs.req_activities + cs.req_quizzes + cs.req_challenges)::numeric) * 100
          )::int)
        else 0
      end,
      'projectedCompletionAt', cs.projected_completion_at
    )
  ) order by cs.updated_at desc), '[]'::jsonb)
  into v_enrolled_courses
  from course_stats cs;

  with current_wk as (
    select date_trunc('week', timezone('UTC', now()))::date as wk_start
  ),
  weeks as (
    select (wk_start - (offset_w * 7))::date as wk
    from current_wk, generate_series(8, 0, -1) as offset_w
  ),
  lesson_mins as (
    select
      date_trunc('week', timezone('UTC', lp.completed_at))::date as wk,
      sum(coalesce(lp.minutes_spent, l.est_minutes))::int as mins
    from public.lesson_progress lp
    join public.lessons l on l.id = lp.lesson_id
    join public.phases p on p.id = l.phase_id
    join public.courses c on c.id = p.course_id
    where lp.user_id = v_uid
      and lp.completed = true
      and lp.completed_at is not null
      and l.publication_status = 'published'
      and p.publication_status = 'published'
      and c.publication_status = 'published'
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', to_char(w.wk, 'YYYY-MM-DD'),
    'label', to_char(w.wk, 'FMDD Mon'),
    'minutes', coalesce(lm.mins, 0)
  ) order by w.wk asc), '[]'::jsonb)
  into v_weekly_minutes
  from weeks w
  left join lesson_mins lm on lm.wk = w.wk;

  with buckets(label, start_hr, end_hr) as (
    values
      ('06–09', 6, 9),
      ('09–12', 9, 12),
      ('12–15', 12, 15),
      ('15–18', 15, 18),
      ('18–21', 18, 21),
      ('21–24', 21, 24)
  ),
  lesson_hours as (
    select
      extract(hour from timezone('UTC', lp.completed_at))::int as hr,
      coalesce(lp.minutes_spent, l.est_minutes)::int as mins
    from public.lesson_progress lp
    join public.lessons l on l.id = lp.lesson_id
    join public.phases p on p.id = l.phase_id
    join public.courses c on c.id = p.course_id
    where lp.user_id = v_uid
      and lp.completed = true
      and lp.completed_at is not null
      and l.publication_status = 'published'
      and p.publication_status = 'published'
      and c.publication_status = 'published'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'label', b.label,
    'start', b.start_hr,
    'end', b.end_hr,
    'minutes', coalesce((
      select sum(lh.mins)::int
      from lesson_hours lh
      where lh.hr >= b.start_hr and lh.hr < b.end_hr
    ), 0)
  ) order by b.start_hr asc), '[]'::jsonb)
  into v_hourly_distribution
  from buckets b;

  return jsonb_build_object(
    'learning', jsonb_build_object(
      'activeCourses', v_active_courses,
      'pausedCourses', v_paused_courses,
      'completedCourses', v_completed_courses,
      'completedLessons', v_completed_lessons,
      'completedActivities', v_completed_activities,
      'minutesLearned', v_total_minutes
    ),
    'understanding', jsonb_build_object(
      'passedQuizzes', v_passed_quizzes,
      'totalAttempts', v_total_attempts,
      'averageScore', v_avg_score
    ),
    'demonstrating', jsonb_build_object(
      'approvedSubmissions', v_approved_subs,
      'pendingSubmissions', v_pending_subs,
      'needsRevisionSubmissions', v_revision_subs,
      'totalSubmissions', v_total_subs
    ),
    'enrolledCourses', v_enrolled_courses,
    'skillLevels', v_skills,
    'weeklyMinutes', v_weekly_minutes,
    'hourlyDistribution', v_hourly_distribution
  );
end;
$$;

revoke all on function public.get_dashboard() from public, anon;
grant execute on function public.get_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Admin User Governance RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  first_name text,
  full_name text,
  role text,
  account_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  return query
  select p.id, p.email, p.first_name, p.full_name, p.role, p.account_status, p.created_at
  from public.profiles p
  order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_set_account_status(
  p_target_user_id uuid,
  p_new_status text,
  p_reason text default ''
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_updated public.profiles;
  v_clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() and not public.is_trusted_service_context() then
    raise exception 'Administrator access required';
  end if;

  if p_new_status not in ('active', 'suspended') then
    raise exception 'Invalid account status: must be active or suspended';
  end if;

  select * into v_target from public.profiles where id = p_target_user_id;
  if not found then
    raise exception 'Target user profile not found';
  end if;

  if v_target.id = auth.uid() then
    raise exception 'Administrators cannot suspend or modify their own account status';
  end if;

  if v_target.role = 'admin' and not public.is_trusted_service_context() then
    raise exception 'Service role authorization required to modify another administrator account status';
  end if;

  update public.profiles
  set account_status = p_new_status
  where id = p_target_user_id
  returning * into v_updated;

  if v_clean_reason is not null then
    perform public.record_admin_audit_log(
      'account_status_reason_noted',
      'profiles',
      p_target_user_id::text,
      null,
      jsonb_build_object('accountStatus', p_new_status, 'reason', left(v_clean_reason, 300))
    );
  end if;

  return v_updated;
end;
$$;

revoke all on function public.admin_set_account_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated, service_role;
