-- 02_security.sql (Synchronized with migrations 000003-000004)

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
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Defense-in-depth trigger preventing learners/clients from altering id, email, role, or created_at
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and coalesce(current_setting('role', true), '') not in ('service_role', 'postgres', 'supabase_admin') then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.created_at is distinct from old.created_at then
      raise exception 'Privileged profile fields (id, email, role, created_at) cannot be modified directly';
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

-- Hardened auth.users trigger: assigns 'learner' by default; admin only when email is verified & designated
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text := 'learner';
  derived_first text;
  derived_full text;
begin
  if lower(coalesce(new.email, '')) = 'ethoppaofficial@gmail.com'
     and new.email_confirmed_at is not null then
    assigned_role := 'admin';
  end if;

  derived_full := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'learner'), '@', 1)
  );
  derived_first := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
    split_part(derived_full, ' ', 1)
  );

  insert into public.profiles (id, email, first_name, full_name, role)
  values (
    new.id,
    lower(new.email),
    derived_first,
    derived_full,
    assigned_role
  )
  on conflict (id) do update
    set email = excluded.email,
        first_name = coalesce(nullif(excluded.first_name, ''), public.profiles.first_name),
        full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
        role = case
          when lower(excluded.email) = 'ethoppaofficial@gmail.com'
               and new.email_confirmed_at is not null
          then 'admin'
          else public.profiles.role
        end;

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
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and coalesce(current_setting('role', true), '') not in ('service_role', 'postgres', 'supabase_admin') then
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
alter table public.submissions enable row level security;
alter table public.user_skills enable row level security;
alter table public.opportunities enable row level security;

-- ---------------------------------------------------------------------------
-- 1. Profiles: column-restricted updates (first_name, full_name ONLY)
-- ---------------------------------------------------------------------------
revoke all on public.profiles from public, anon, authenticated;
grant select (id, email, first_name, full_name, role, created_at) on public.profiles to authenticated;
grant update (first_name, full_name) on public.profiles to authenticated;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and email = (select p.email from public.profiles p where p.id = auth.uid())
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
  for select to authenticated, anon using (publication_status = 'published' or public.is_admin());
drop policy if exists "catalog_admin_skills" on public.skills;
create policy "catalog_admin_skills" on public.skills
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_courses" on public.courses;
create policy "catalog_read_courses" on public.courses
  for select to authenticated, anon using (publication_status = 'published' or public.is_admin());
drop policy if exists "catalog_admin_courses" on public.courses;
create policy "catalog_admin_courses" on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_course_skills" on public.course_skills;
create policy "catalog_read_course_skills" on public.course_skills
  for select to authenticated, anon
  using (
    public.is_admin()
    or exists (
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
    public.is_admin()
    or (
      publication_status = 'published'
      and exists (
        select 1 from public.courses c
        where c.id = phases.course_id and c.publication_status = 'published'
      )
    )
  );
drop policy if exists "catalog_admin_phases" on public.phases;
create policy "catalog_admin_phases" on public.phases
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_lessons" on public.lessons;
create policy "catalog_read_lessons" on public.lessons
  for select to authenticated, anon
  using (
    public.is_admin()
    or (
      publication_status = 'published'
      and exists (
        select 1
        from public.phases p
        join public.courses c on c.id = p.course_id
        where p.id = lessons.phase_id
          and p.publication_status = 'published'
          and c.publication_status = 'published'
      )
    )
  );
drop policy if exists "catalog_admin_lessons" on public.lessons;
create policy "catalog_admin_lessons" on public.lessons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_lesson_resources" on public.lesson_resources;
create policy "catalog_read_lesson_resources" on public.lesson_resources
  for select to authenticated, anon
  using (
    public.is_admin()
    or exists (
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
    public.is_admin()
    or exists (
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
grant insert, update, delete on public.questions to authenticated;

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
