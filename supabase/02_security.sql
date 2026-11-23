-- 02_security.sql (Synchronized with migrations 000003-000004, 20261122000010, and 20261123000011)

-- 20261121000003_auth_and_profiles.sql
-- Hardened authentication, role protection, and controlled admin provisioning.

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

-- Defense-in-depth trigger preventing learners/clients from altering id, email, role, or created_at
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

drop trigger if exists trg_protect_profile_privileged_fields on public.profiles;
create trigger trg_protect_profile_privileged_fields
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

-- Hardened auth.users trigger: assigns 'learner' + 'active' unconditionally; admin provisioning is service_role only
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Controlled admin role provisioning (strictly restricted to service_role / postgres operators)
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

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'alter function public.rls_auto_enable() set search_path = public';
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- 20261121000004_rls_and_permissions.sql
-- Least-privilege table grants and strict Row Level Security policies across all tables.

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.skills enable row level security;
alter table public.courses enable row level security;
alter table public.course_skills enable row level security;
alter table public.course_versions enable row level security;
alter table public.phases enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_resources enable row level security;
alter table public.activities enable row level security;
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.challenges enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.course_completions enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.enrollments enable row level security;
alter table public.activity_progress enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.submissions enable row level security;
alter table public.user_skills enable row level security;
alter table public.opportunities enable row level security;
alter table public.admin_audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- 1. Profiles: column-restricted updates (first_name, full_name ONLY)
-- ---------------------------------------------------------------------------
revoke all on public.profiles from public, anon, authenticated;
grant select (id, email, first_name, full_name, role, account_status, created_at) on public.profiles to authenticated;
grant update (first_name, full_name) on public.profiles to authenticated;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

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

-- ---------------------------------------------------------------------------
-- 2. Published catalog reads & admin-only mutations
-- ---------------------------------------------------------------------------
drop policy if exists "catalog_read_categories" on public.categories;
create policy "catalog_read_categories" on public.categories
  for select to authenticated, anon using (true);
drop policy if exists "catalog_admin_categories" on public.categories;
create policy "catalog_admin_categories" on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_skills" on public.skills;
create policy "catalog_read_skills" on public.skills
  for select to authenticated, anon using (publication_status = 'published');
drop policy if exists "catalog_admin_skills" on public.skills;
create policy "catalog_admin_skills" on public.skills
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_courses" on public.courses;
create policy "catalog_read_courses" on public.courses
  for select to authenticated, anon using (publication_status = 'published');
drop policy if exists "catalog_admin_courses" on public.courses;
create policy "catalog_admin_courses" on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_course_skills" on public.course_skills;
create policy "catalog_read_course_skills" on public.course_skills
  for select to authenticated, anon
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_skills.course_id and c.publication_status = 'published'
    )
  );
drop policy if exists "catalog_admin_course_skills" on public.course_skills;
create policy "catalog_admin_course_skills" on public.course_skills
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_course_versions" on public.course_versions;
create policy "catalog_read_course_versions" on public.course_versions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = course_versions.course_id and c.publication_status = 'published'
    )
  );
drop policy if exists "catalog_admin_course_versions" on public.course_versions;
create policy "catalog_admin_course_versions" on public.course_versions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_phases" on public.phases;
create policy "catalog_read_phases" on public.phases
  for select to authenticated, anon
  using (
    publication_status = 'published'
    and exists (
      select 1 from public.courses c
      where c.id = phases.course_id and c.publication_status = 'published'
    )
  );
drop policy if exists "catalog_admin_phases" on public.phases;
create policy "catalog_admin_phases" on public.phases
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_lessons" on public.lessons;
create policy "catalog_read_lessons" on public.lessons
  for select to authenticated, anon
  using (
    publication_status = 'published'
    and exists (
      select 1
      from public.phases p
      join public.courses c on c.id = p.course_id
      where p.id = lessons.phase_id
        and p.publication_status = 'published'
        and c.publication_status = 'published'
    )
  );
drop policy if exists "catalog_admin_lessons" on public.lessons;
create policy "catalog_admin_lessons" on public.lessons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_lesson_resources" on public.lesson_resources;
create policy "catalog_read_lesson_resources" on public.lesson_resources
  for select to authenticated, anon
  using (
    exists (
      select 1
      from public.lessons l
      join public.phases p on p.id = l.phase_id
      join public.courses c on c.id = p.course_id
      where l.id = lesson_resources.lesson_id
        and l.publication_status = 'published'
        and p.publication_status = 'published'
        and c.publication_status = 'published'
    )
  );
drop policy if exists "catalog_admin_lesson_resources" on public.lesson_resources;
create policy "catalog_admin_lesson_resources" on public.lesson_resources
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_activities" on public.activities;
create policy "catalog_read_activities" on public.activities
  for select to authenticated, anon
  using (
    exists (
      select 1
      from public.phases p
      join public.courses c on c.id = p.course_id
      where p.id = activities.phase_id
        and p.publication_status = 'published'
        and c.publication_status = 'published'
    )
  );
drop policy if exists "catalog_admin_activities" on public.activities;
create policy "catalog_admin_activities" on public.activities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_quizzes" on public.quizzes;
create policy "catalog_read_quizzes" on public.quizzes
  for select to authenticated
  using (
    public.is_admin()
    or (
      course_id is null
      and exists (
        select 1 from public.skills s
        where s.id = quizzes.skill_id and s.publication_status = 'published'
      )
    )
    or (
      course_id is not null
      and exists (
        select 1 from public.courses c
        where c.id = quizzes.course_id and c.publication_status = 'published'
      )
      and (
        phase_id is null
        or exists (
          select 1 from public.phases p
          where p.id = quizzes.phase_id and p.publication_status = 'published'
        )
      )
      and (
        lesson_id is null
        or exists (
          select 1 from public.lessons l
          where l.id = quizzes.lesson_id and l.publication_status = 'published'
        )
      )
    )
  );
drop policy if exists "catalog_admin_quizzes" on public.quizzes;
create policy "catalog_admin_quizzes" on public.quizzes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_challenges" on public.challenges;
create policy "catalog_read_challenges" on public.challenges
  for select to authenticated
  using (
    public.is_admin()
    or (
      course_id is null
      and exists (
        select 1 from public.skills s
        where s.id = challenges.skill_id and s.publication_status = 'published'
      )
    )
    or (
      course_id is not null
      and exists (
        select 1 from public.courses c
        where c.id = challenges.course_id and c.publication_status = 'published'
      )
      and (
        phase_id is null
        or exists (
          select 1 from public.phases p
          where p.id = challenges.phase_id and p.publication_status = 'published'
        )
      )
    )
  );
drop policy if exists "catalog_admin_challenges" on public.challenges;
create policy "catalog_admin_challenges" on public.challenges
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_opportunities" on public.opportunities;
create policy "catalog_read_opportunities" on public.opportunities
  for select to authenticated, anon using (true);
drop policy if exists "catalog_admin_opportunities" on public.opportunities;
create policy "catalog_admin_opportunities" on public.opportunities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Questions: NEVER expose correct_index, answer_config, or explanation directly
-- Admins read full questions strictly through admin_get_quiz_questions RPC.
-- ---------------------------------------------------------------------------
revoke all on public.questions from public, anon, authenticated;
grant select (id, quiz_id, position, question_type, difficulty, marks, prompt, context_text, options) on public.questions to authenticated;

drop policy if exists "questions_read_authenticated" on public.questions;
create policy "questions_read_authenticated" on public.questions
  for select to authenticated
  using (
    not public.is_admin()
    and exists (
      select 1
      from public.quizzes q
      where q.id = questions.quiz_id
        and (
          (
            q.course_id is null
            and exists (
              select 1 from public.skills s
              where s.id = q.skill_id and s.publication_status = 'published'
            )
          )
          or (
            q.course_id is not null
            and exists (
              select 1
              from public.courses c
              join public.course_enrollments ce on ce.course_id = c.id
              where c.id = q.course_id
                and c.publication_status = 'published'
                and ce.user_id = auth.uid()
                and ce.status in ('active', 'completed')
            )
            and (
              q.phase_id is null
              or exists (
                select 1 from public.phases p
                where p.id = q.phase_id and p.publication_status = 'published'
              )
            )
            and (
              q.lesson_id is null
              or exists (
                select 1 from public.lessons l
                where l.id = q.lesson_id and l.publication_status = 'published'
              )
            )
          )
        )
    )
  );
drop policy if exists "questions_admin_all" on public.questions;
create policy "questions_admin_all" on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Progression, Assessments, Skills & Submissions:
--    Read-only to owning authenticated user (or admin); ALL mutations via SECURITY DEFINER RPCs!
-- ---------------------------------------------------------------------------
revoke all on public.course_enrollments from public, anon, authenticated;
grant select on public.course_enrollments to authenticated;
drop policy if exists "course_enrollments_own_only" on public.course_enrollments;
drop policy if exists "course_enrollments_select_own_or_admin" on public.course_enrollments;
create policy "course_enrollments_select_own_or_admin" on public.course_enrollments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.course_completions from public, anon, authenticated;
grant select on public.course_completions to authenticated;
drop policy if exists "course_completions_own_or_admin" on public.course_completions;
create policy "course_completions_own_or_admin" on public.course_completions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.lesson_progress from public, anon, authenticated;
grant select on public.lesson_progress to authenticated;
drop policy if exists "lesson_progress_own_only" on public.lesson_progress;
drop policy if exists "lesson_progress_select_own_or_admin" on public.lesson_progress;
create policy "lesson_progress_select_own_or_admin" on public.lesson_progress
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.enrollments from public, anon, authenticated;
grant select on public.enrollments to authenticated;
drop policy if exists "enrollments_own_only" on public.enrollments;
drop policy if exists "enrollments_select_own_or_admin" on public.enrollments;
create policy "enrollments_select_own_or_admin" on public.enrollments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.activity_progress from public, anon, authenticated;
grant select on public.activity_progress to authenticated;
drop policy if exists "activity_progress_own_only" on public.activity_progress;
drop policy if exists "activity_progress_select_own_or_admin" on public.activity_progress;
create policy "activity_progress_select_own_or_admin" on public.activity_progress
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.quiz_attempts from public, anon, authenticated;
grant select on public.quiz_attempts to authenticated;
drop policy if exists "quiz_attempts_own_only" on public.quiz_attempts;
create policy "quiz_attempts_own_only" on public.quiz_attempts
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.user_skills from public, anon, authenticated;
grant select on public.user_skills to authenticated;
drop policy if exists "user_skills_own_only" on public.user_skills;
drop policy if exists "user_skills_select_own_or_admin" on public.user_skills;
create policy "user_skills_select_own_or_admin" on public.user_skills
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.submissions from public, anon, authenticated;
grant select on public.submissions to authenticated;
drop policy if exists "submissions_select_own_or_admin" on public.submissions;
create policy "submissions_select_own_or_admin" on public.submissions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "submissions_insert_own" on public.submissions;
drop policy if exists "submissions_admin_update" on public.submissions;

-- ---------------------------------------------------------------------------
-- 5. Explicit least-privilege table grants & anon surface lock (000010 sync)
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.profiles,
  public.categories,
  public.skills,
  public.courses,
  public.course_skills,
  public.course_versions,
  public.phases,
  public.lessons,
  public.lesson_resources,
  public.activities,
  public.quizzes,
  public.questions,
  public.challenges,
  public.course_enrollments,
  public.course_completions,
  public.lesson_progress,
  public.enrollments,
  public.activity_progress,
  public.quiz_attempts,
  public.quiz_sessions,
  public.submissions,
  public.user_skills,
  public.opportunities,
  public.admin_audit_logs
from public, anon;

revoke select on
  public.profiles,
  public.course_versions,
  public.quizzes,
  public.questions,
  public.challenges,
  public.course_enrollments,
  public.course_completions,
  public.lesson_progress,
  public.enrollments,
  public.activity_progress,
  public.quiz_attempts,
  public.quiz_sessions,
  public.submissions,
  public.user_skills,
  public.admin_audit_logs
from anon;

grant select on
  public.categories,
  public.skills,
  public.courses,
  public.course_skills,
  public.phases,
  public.lessons,
  public.lesson_resources,
  public.activities,
  public.opportunities
to anon, authenticated;

grant select on
  public.course_versions,
  public.quizzes,
  public.challenges
to authenticated;

grant insert, update, delete on
  public.categories,
  public.skills,
  public.courses,
  public.course_skills,
  public.course_versions,
  public.phases,
  public.lessons,
  public.lesson_resources,
  public.activities,
  public.quizzes,
  public.challenges,
  public.opportunities
to authenticated;

-- Quiz sessions & Immutable admin audit logs RLS
revoke all on public.quiz_sessions from public, anon, authenticated;
grant select on public.quiz_sessions to authenticated;
drop policy if exists "quiz_sessions_select_own_or_admin" on public.quiz_sessions;
create policy "quiz_sessions_select_own_or_admin" on public.quiz_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

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

