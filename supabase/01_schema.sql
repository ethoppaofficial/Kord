-- 01_schema.sql (Synchronized with migrations 000001-000002 and 20261123000011)

-- 20261121000001_extensions_and_schema.sql
-- Ordered base schema migration for Kord (idempotent, non-destructive).

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text not null default '',
  full_name text not null default '',
  role text not null default 'learner' check (role in ('learner', 'admin')),
  account_status text not null default 'active' check (account_status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists first_name text not null default '';
alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('active', 'suspended'));

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  description text not null default '',
  position integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  slug text not null unique,
  title text not null,
  category text not null,
  level text not null check (level in ('Beginner', 'Intermediate', 'Advanced')),
  summary text not null,
  competency_expectations text not null default '',
  prerequisites jsonb not null default '[]'::jsonb,
  supported_by_course_slug text,
  roadmap_status text not null default 'full' check (roadmap_status in ('full', 'coming_soon')),
  publication_status text not null default 'published' check (publication_status in ('published', 'draft', 'coming_soon')),
  est_hours numeric(5,1) not null default 2.0,
  outcomes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.skills add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.skills add column if not exists competency_expectations text not null default '';
alter table public.skills add column if not exists prerequisites jsonb not null default '[]'::jsonb;
alter table public.skills add column if not exists publication_status text not null default 'published';
alter table public.skills add column if not exists supported_by_course_slug text;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text not null default '',
  target_audience text not null default '',
  outcomes jsonb not null default '[]'::jsonb,
  difficulty text not null default 'Beginner' check (difficulty in ('Beginner', 'Intermediate', 'Advanced')),
  estimated_duration_weeks integer not null default 4,
  recommended_weekly_hours numeric(4,1) not null default 4.0,
  recommended_schedule text not null default 'Self-paced weekly milestones',
  prerequisites jsonb not null default '[]'::jsonb,
  thumbnail_url text not null default '',
  author_name text not null default '',
  completion_rules jsonb not null default '{"requireAllRequiredLessons":true,"requireAllActivities":true,"requireAllAssessments":true,"requireChallengeSubmission":true,"requireChallengeApproval":true}'::jsonb,
  publication_status text not null default 'published' check (publication_status in ('published', 'draft', 'archived')),
  version integer not null default 1,
  position integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.courses add column if not exists target_audience text not null default '';
alter table public.courses add column if not exists thumbnail_url text not null default '';
alter table public.courses add column if not exists author_name text not null default '';
alter table public.courses add column if not exists version integer not null default 1;
alter table public.courses add column if not exists updated_at timestamptz not null default now();

create table if not exists public.course_skills (
  course_id uuid not null references public.courses(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (course_id, skill_id)
);

create table if not exists public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  version_number integer not null,
  change_notes text not null default '',
  snapshot_type text not null default 'manual' check (snapshot_type in ('manual', 'pre_import', 'pre_restore')),
  snapshot jsonb not null default '{}'::jsonb,
  snapshot_data jsonb not null default '{}'::jsonb,
  source_import_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (course_id, version_number)
);
alter table public.course_versions
  add column if not exists snapshot_type text not null default 'manual' check (snapshot_type in ('manual', 'pre_import', 'pre_restore')),
  add column if not exists snapshot_data jsonb not null default '{}'::jsonb,
  add column if not exists source_import_id uuid;

create table if not exists public.phases (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade,
  skill_id uuid references public.skills(id) on delete cascade,
  position integer not null,
  title text not null,
  summary text not null default '',
  objectives jsonb not null default '[]'::jsonb,
  difficulty text not null default 'Beginner',
  est_hours numeric(5,1) not null default 2.0,
  completion_requirements jsonb not null default '[]'::jsonb,
  publication_status text not null default 'published' check (publication_status in ('published', 'draft', 'archived'))
);
alter table public.phases add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.phases add column if not exists objectives jsonb not null default '[]'::jsonb;
alter table public.phases add column if not exists difficulty text not null default 'Beginner';
alter table public.phases add column if not exists est_hours numeric(5,1) not null default 2.0;
alter table public.phases add column if not exists completion_requirements jsonb not null default '[]'::jsonb;
alter table public.phases add column if not exists publication_status text not null default 'published';

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.phases(id) on delete cascade,
  position integer not null default 1,
  title text not null,
  introduction text not null default '',
  objectives jsonb not null default '[]'::jsonb,
  est_minutes integer not null default 25,
  blocks jsonb not null default '[]'::jsonb,
  videos jsonb not null default '[]'::jsonb,
  summary text not null default '',
  takeaways jsonb not null default '[]'::jsonb,
  further_reading jsonb not null default '[]'::jsonb,
  completion_criteria text not null default '',
  publication_status text not null default 'published' check (publication_status in ('published', 'draft', 'archived')),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (phase_id, position)
);
alter table public.lessons add column if not exists completion_criteria text not null default '';
alter table public.lessons add column if not exists publication_status text not null default 'published';

create table if not exists public.lesson_resources (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  title text not null,
  url text not null,
  resource_type text not null default 'article',
  position integer not null default 1,
  created_at timestamptz not null default now(),
  unique (lesson_id, url)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.phases(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  position integer not null,
  title text not null,
  description text not null default '',
  instructions text not null default '',
  expected_output text not null default '',
  est_minutes integer not null default 20,
  is_required boolean not null default true,
  resources jsonb not null default '[]'::jsonb,
  unique (phase_id, position)
);
alter table public.activities add column if not exists lesson_id uuid references public.lessons(id) on delete set null;
alter table public.activities add column if not exists instructions text not null default '';
alter table public.activities add column if not exists expected_output text not null default '';
alter table public.activities add column if not exists is_required boolean not null default true;

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  quiz_type text not null check (quiz_type in ('knowledge_check', 'phase', 'skill_check', 'course_exam')),
  title text not null,
  description text not null default '',
  pass_percent integer not null default 70,
  time_limit_minutes integer,
  max_attempts integer,
  shuffle_questions boolean not null default false,
  requires_manual_review boolean not null default false
);
alter table public.quizzes add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.quizzes add column if not exists lesson_id uuid references public.lessons(id) on delete set null;
alter table public.quizzes add column if not exists time_limit_minutes integer;
alter table public.quizzes add column if not exists max_attempts integer;
alter table public.quizzes add column if not exists shuffle_questions boolean not null default false;
alter table public.quizzes add column if not exists requires_manual_review boolean not null default false;

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position integer not null default 1,
  question_type text not null default 'multiple_choice' check (
    question_type in (
      'multiple_choice', 'multiple_select', 'true_false', 'fill_blank',
      'short_answer', 'scenario', 'case_study', 'ordering',
      'practical_submission', 'long_form'
    )
  ),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  marks integer not null default 1 check (marks > 0),
  prompt text not null,
  context_text text not null default '',
  options jsonb not null default '[]'::jsonb,
  correct_index integer not null default 0 check (correct_index >= 0),
  answer_config jsonb not null default '{}'::jsonb,
  explanation text not null default ''
);
alter table public.questions add column if not exists question_type text not null default 'multiple_choice';
alter table public.questions add column if not exists difficulty text not null default 'medium';
alter table public.questions add column if not exists marks integer not null default 1;
alter table public.questions add column if not exists context_text text not null default '';
alter table public.questions add column if not exists answer_config jsonb not null default '{}'::jsonb;

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  title text not null,
  brief text not null,
  instructions text not null default '',
  expected_deliverables jsonb not null default '[]'::jsonb,
  submission_format text not null default 'URL, file upload, or structured written response',
  deliverable_hint text not null default '',
  max_score integer not null default 20,
  passing_score integer not null default 14,
  deadline_days integer,
  allowed_evidence_types jsonb not null default '["written","file","project_url","repo_url","screenshot","audio","video"]'::jsonb,
  allowed_mime_types jsonb not null default '[]'::jsonb,
  max_file_size_mb integer not null default 25,
  is_required boolean not null default true,
  rubric jsonb not null default '[]'::jsonb
);
alter table public.challenges add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.challenges add column if not exists instructions text not null default '';
alter table public.challenges add column if not exists expected_deliverables jsonb not null default '[]'::jsonb;
alter table public.challenges add column if not exists submission_format text not null default 'URL, file upload, or structured written response';
alter table public.challenges add column if not exists max_score integer not null default 20;
alter table public.challenges add column if not exists passing_score integer not null default 14;
alter table public.challenges add column if not exists deadline_days integer;
alter table public.challenges add column if not exists allowed_evidence_types jsonb not null default '["written","file","project_url","repo_url","screenshot","audio","video"]'::jsonb;
alter table public.challenges add column if not exists allowed_mime_types jsonb not null default '[]'::jsonb;
alter table public.challenges add column if not exists max_file_size_mb integer not null default 25;
alter table public.challenges add column if not exists is_required boolean not null default true;

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  completion_state text not null default 'in_progress' check (completion_state in ('in_progress', 'awaiting_practical_assessment', 'completed', 'completed_verified')),
  enrolled_at timestamptz not null default now(),
  projected_completion_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, course_id)
);
alter table public.course_enrollments add column if not exists completion_state text not null default 'in_progress';

create table if not exists public.course_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  completion_state text not null check (completion_state in ('in_progress', 'awaiting_practical_assessment', 'completed', 'completed_verified')),
  practical_approved boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  notes text not null default '',
  completed boolean not null default false,
  minutes_spent integer,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, skill_id)
);

create table if not exists public.activity_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  notes text not null default '',
  completed boolean not null default false,
  minutes_spent integer,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, activity_id)
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  attempt_number integer not null default 1,
  answers jsonb not null default '{}'::jsonb,
  score integer not null,
  total integer not null,
  percentage integer not null,
  passed boolean not null,
  review_status text not null default 'auto_graded' check (review_status in ('auto_graded', 'pending_review', 'reviewed', 'graded')),
  manual_scores jsonb not null default '{}'::jsonb,
  manual_feedback text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
alter table public.quiz_attempts add column if not exists course_id uuid references public.courses(id) on delete set null;
alter table public.quiz_attempts add column if not exists attempt_number integer not null default 1;
alter table public.quiz_attempts add column if not exists review_status text not null default 'auto_graded';
alter table public.quiz_attempts add column if not exists manual_scores jsonb not null default '{}'::jsonb;
alter table public.quiz_attempts add column if not exists manual_feedback text not null default '';
alter table public.quiz_attempts add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.quiz_attempts add column if not exists reviewed_at timestamptz;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  evidence_url text,
  repo_url text,
  file_path text,
  file_name text,
  submission_text text not null default '',
  explanation text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'needs_revision')),
  rubric_scores jsonb not null default '{}'::jsonb,
  rubric_total integer,
  rubric_max integer,
  feedback text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
alter table public.submissions add column if not exists course_id uuid references public.courses(id) on delete set null;
alter table public.submissions add column if not exists submission_text text not null default '';
alter table public.submissions add column if not exists repo_url text;

create table if not exists public.user_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  level text not null default 'declared' check (level in ('declared', 'practising', 'demonstrated', 'verified')),
  updated_at timestamptz not null default now(),
  unique (user_id, skill_id)
);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  organization text not null,
  opportunity_type text not null,
  work_mode text not null check (work_mode in ('Remote', 'Hybrid', 'On-site')),
  location text not null default 'Remote',
  summary text not null,
  about_role text not null default '',
  responsibilities jsonb not null default '[]'::jsonb,
  requirements jsonb not null default '[]'::jsonb,
  required_skills jsonb not null default '[]'::jsonb,
  required_skill_slugs jsonb not null default '[]'::jsonb,
  other_info jsonb not null default '{}'::jsonb,
  org_tips jsonb not null default '{}'::jsonb,
  is_sample boolean not null default true,
  apply_url text not null default '',
  created_at timestamptz not null default now(),
  unique (title, organization)
);

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

-- 20261121000002_constraints_and_indexes.sql
-- Hardened check constraints and query performance indexes (idempotent, non-destructive).

do $$
begin
  alter table public.quizzes drop constraint if exists quizzes_pass_percent_check;
  alter table public.quizzes add constraint quizzes_pass_percent_check
    check (pass_percent between 1 and 100);

  alter table public.quiz_attempts drop constraint if exists quiz_attempts_review_status_check;
  alter table public.quiz_attempts add constraint quiz_attempts_review_status_check
    check (review_status in ('auto_graded', 'pending_review', 'reviewed', 'graded'));

  alter table public.quiz_attempts drop constraint if exists quiz_attempts_score_bounds_check;
  alter table public.quiz_attempts add constraint quiz_attempts_score_bounds_check
    check (
      attempt_number >= 1
      and score >= 0
      and total >= 0
      and percentage between 0 and 100
    );

  alter table public.challenges drop constraint if exists challenges_scores_check;
  alter table public.challenges add constraint challenges_scores_check
    check (
      max_score >= 1
      and passing_score >= 0
      and passing_score <= max_score
      and max_file_size_mb between 1 and 100
    );

  alter table public.lessons drop constraint if exists lessons_est_minutes_check;
  alter table public.lessons add constraint lessons_est_minutes_check
    check (est_minutes >= 1);

  alter table public.activities drop constraint if exists activities_est_minutes_check;
  alter table public.activities add constraint activities_est_minutes_check
    check (est_minutes >= 1);

  alter table public.phases drop constraint if exists phases_publication_status_check;
  alter table public.phases add constraint phases_publication_status_check
    check (publication_status in ('published', 'draft', 'archived'));

  alter table public.submissions drop constraint if exists submissions_score_bounds_check;
  alter table public.submissions add constraint submissions_score_bounds_check
    check (
      (rubric_total is null or rubric_total >= 0)
      and (rubric_max is null or rubric_max >= 1)
    );
end $$;

create index if not exists idx_skills_category on public.skills(category_id);
create index if not exists idx_skills_pub_status on public.skills(publication_status);
create index if not exists idx_courses_skill on public.courses(skill_id, position);
create index if not exists idx_courses_pub_status on public.courses(publication_status);
create index if not exists idx_course_skills_skill on public.course_skills(skill_id, course_id);
create index if not exists idx_phases_course on public.phases(course_id, position);
create index if not exists idx_lessons_phase on public.lessons(phase_id, position);
create index if not exists idx_lesson_resources_lesson on public.lesson_resources(lesson_id, position);
create index if not exists idx_activities_phase on public.activities(phase_id, position);
create index if not exists idx_quizzes_course on public.quizzes(course_id);
create index if not exists idx_quizzes_skill on public.quizzes(skill_id);
create index if not exists idx_questions_quiz on public.questions(quiz_id, position);
create index if not exists idx_challenges_course on public.challenges(course_id);
create index if not exists idx_challenges_skill on public.challenges(skill_id);
create index if not exists idx_course_enrollments_user on public.course_enrollments(user_id, status);
create index if not exists idx_course_completions_user on public.course_completions(user_id, completion_state);
create index if not exists idx_lesson_progress_user on public.lesson_progress(user_id, course_id, completed);
create index if not exists idx_activity_progress_user on public.activity_progress(user_id, activity_id, completed);
create index if not exists idx_quiz_attempts_user_quiz on public.quiz_attempts(user_id, quiz_id);
create index if not exists idx_submissions_status on public.submissions(status, created_at desc);
create index if not exists idx_submissions_user_challenge on public.submissions(user_id, challenge_id);
create index if not exists idx_submissions_file_path on public.submissions(file_path) where file_path is not null;
create index if not exists idx_user_skills_user on public.user_skills(user_id);

-- Foreign-key and operational query indexes (20261123000011)
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
create index if not exists idx_quiz_sessions_user_quiz on public.quiz_sessions(user_id, quiz_id, started_at desc);
create index if not exists idx_quiz_sessions_attempt on public.quiz_sessions(completed_attempt_id);
create index if not exists idx_admin_audit_logs_created on public.admin_audit_logs(created_at desc);
create index if not exists idx_admin_audit_logs_actor on public.admin_audit_logs(actor_id, created_at desc);
create index if not exists idx_admin_audit_logs_target on public.admin_audit_logs(target_table, target_id, created_at desc);
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
