-- 02_security.sql
-- Idempotent Row Level Security with strict actor isolation & answer-key protection

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

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

-- Profiles
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Catalog reads & admin authoring
drop policy if exists "catalog_read_categories" on public.categories;
create policy "catalog_read_categories" on public.categories for select using (true);
drop policy if exists "catalog_admin_categories" on public.categories;
create policy "catalog_admin_categories" on public.categories for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_skills" on public.skills;
create policy "catalog_read_skills" on public.skills for select using (publication_status = 'published' or public.is_admin());
drop policy if exists "catalog_admin_skills" on public.skills;
create policy "catalog_admin_skills" on public.skills for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_courses" on public.courses;
create policy "catalog_read_courses" on public.courses for select using (publication_status = 'published' or public.is_admin());
drop policy if exists "catalog_admin_courses" on public.courses;
create policy "catalog_admin_courses" on public.courses for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_course_skills" on public.course_skills;
create policy "catalog_read_course_skills" on public.course_skills for select using (true);
drop policy if exists "catalog_admin_course_skills" on public.course_skills;
create policy "catalog_admin_course_skills" on public.course_skills for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_course_versions" on public.course_versions;
create policy "catalog_read_course_versions" on public.course_versions for select using (true);
drop policy if exists "catalog_admin_course_versions" on public.course_versions;
create policy "catalog_admin_course_versions" on public.course_versions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_phases" on public.phases;
create policy "catalog_read_phases" on public.phases for select using (publication_status = 'published' or public.is_admin());
drop policy if exists "catalog_admin_phases" on public.phases;
create policy "catalog_admin_phases" on public.phases for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_lessons" on public.lessons;
create policy "catalog_read_lessons" on public.lessons for select using (publication_status = 'published' or public.is_admin());
drop policy if exists "catalog_admin_lessons" on public.lessons;
create policy "catalog_admin_lessons" on public.lessons for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_lesson_resources" on public.lesson_resources;
create policy "catalog_read_lesson_resources" on public.lesson_resources for select using (true);
drop policy if exists "catalog_admin_lesson_resources" on public.lesson_resources;
create policy "catalog_admin_lesson_resources" on public.lesson_resources for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_activities" on public.activities;
create policy "catalog_read_activities" on public.activities for select using (true);
drop policy if exists "catalog_admin_activities" on public.activities;
create policy "catalog_admin_activities" on public.activities for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_quizzes" on public.quizzes;
create policy "catalog_read_quizzes" on public.quizzes for select using (true);
drop policy if exists "catalog_admin_quizzes" on public.quizzes;
create policy "catalog_admin_quizzes" on public.quizzes for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_challenges" on public.challenges;
create policy "catalog_read_challenges" on public.challenges for select using (true);
drop policy if exists "catalog_admin_challenges" on public.challenges;
create policy "catalog_admin_challenges" on public.challenges for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "catalog_read_opportunities" on public.opportunities;
create policy "catalog_read_opportunities" on public.opportunities for select using (true);
drop policy if exists "catalog_admin_opportunities" on public.opportunities;
create policy "catalog_admin_opportunities" on public.opportunities for all using (public.is_admin()) with check (public.is_admin());

-- Questions: NEVER expose correct_index, answer_config, or explanation before submission
revoke select on public.questions from anon, authenticated;
grant select (id, quiz_id, position, question_type, difficulty, marks, prompt, context_text, options) on public.questions to authenticated;
drop policy if exists "questions_read_authenticated" on public.questions;
create policy "questions_read_authenticated" on public.questions for select to authenticated using (not public.is_admin());
drop policy if exists "questions_admin_all" on public.questions;
create policy "questions_admin_all" on public.questions for all using (public.is_admin()) with check (public.is_admin());

-- Strict learner-only personal workspace tables
drop policy if exists "course_enrollments_own_only" on public.course_enrollments;
create policy "course_enrollments_own_only" on public.course_enrollments
  for all using (user_id = auth.uid() and not public.is_admin())
  with check (user_id = auth.uid() and not public.is_admin());

drop policy if exists "course_completions_own_or_admin" on public.course_completions;
create policy "course_completions_own_or_admin" on public.course_completions
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "lesson_progress_own_only" on public.lesson_progress;
create policy "lesson_progress_own_only" on public.lesson_progress
  for all using (user_id = auth.uid() and not public.is_admin())
  with check (user_id = auth.uid() and not public.is_admin());

drop policy if exists "enrollments_own_only" on public.enrollments;
create policy "enrollments_own_only" on public.enrollments
  for all using (user_id = auth.uid() and not public.is_admin())
  with check (user_id = auth.uid() and not public.is_admin());

drop policy if exists "activity_progress_own_only" on public.activity_progress;
create policy "activity_progress_own_only" on public.activity_progress
  for all using (user_id = auth.uid() and not public.is_admin())
  with check (user_id = auth.uid() and not public.is_admin());

drop policy if exists "quiz_attempts_own_only" on public.quiz_attempts;
create policy "quiz_attempts_own_only" on public.quiz_attempts
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_skills_own_only" on public.user_skills;
create policy "user_skills_own_only" on public.user_skills
  for select using (user_id = auth.uid() and not public.is_admin());

-- Challenge submissions: learners manage own; admins review submissions
drop policy if exists "submissions_select_own_or_admin" on public.submissions;
create policy "submissions_select_own_or_admin" on public.submissions
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "submissions_insert_own" on public.submissions;
create policy "submissions_insert_own" on public.submissions
  for insert with check (user_id = auth.uid() and not public.is_admin());

drop policy if exists "submissions_admin_update" on public.submissions;
create policy "submissions_admin_update" on public.submissions
  for update using (public.is_admin()) with check (public.is_admin());
