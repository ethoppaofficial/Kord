-- 01_schema.sql
-- Kord expanded skills & multi-course engine schema (Idempotent DDL)

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text not null default '',
  full_name text not null default '',
  role text not null default 'learner' check (role in ('learner', 'admin')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists first_name text not null default '';

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

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text not null default '',
  outcomes jsonb not null default '[]'::jsonb,
  difficulty text not null default 'Beginner' check (difficulty in ('Beginner', 'Intermediate', 'Advanced')),
  estimated_duration_weeks integer not null default 4,
  recommended_weekly_hours numeric(4,1) not null default 4.0,
  recommended_schedule text not null default 'Self-paced weekly milestones',
  prerequisites jsonb not null default '[]'::jsonb,
  completion_rules jsonb not null default '{"requireAllRequiredLessons":true,"requireAllAssessments":true,"requireChallengeApproval":true}'::jsonb,
  publication_status text not null default 'published' check (publication_status in ('published', 'draft', 'archived')),
  position integer not null default 1,
  created_at timestamptz not null default now()
);

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
  completion_requirements jsonb not null default '[]'::jsonb
);
alter table public.phases add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.phases add column if not exists objectives jsonb not null default '[]'::jsonb;
alter table public.phases add column if not exists difficulty text not null default 'Beginner';
alter table public.phases add column if not exists est_hours numeric(5,1) not null default 2.0;
alter table public.phases add column if not exists completion_requirements jsonb not null default '[]'::jsonb;

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
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (phase_id, position)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.phases(id) on delete cascade,
  position integer not null,
  title text not null,
  description text not null default '',
  est_minutes integer not null default 20,
  resources jsonb not null default '[]'::jsonb,
  unique (phase_id, position)
);

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
  rubric jsonb not null default '[]'::jsonb
);
alter table public.challenges add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.challenges add column if not exists instructions text not null default '';
alter table public.challenges add column if not exists expected_deliverables jsonb not null default '[]'::jsonb;
alter table public.challenges add column if not exists submission_format text not null default 'URL, file upload, or structured written response';
alter table public.challenges add column if not exists max_score integer not null default 20;
alter table public.challenges add column if not exists passing_score integer not null default 14;
alter table public.challenges add column if not exists deadline_days integer;

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  enrolled_at timestamptz not null default now(),
  projected_completion_at timestamptz,
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
  review_status text not null default 'auto_graded' check (review_status in ('auto_graded', 'pending_review', 'graded')),
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

create index if not exists idx_skills_category on public.skills(category_id);
create index if not exists idx_courses_skill on public.courses(skill_id, position);
create index if not exists idx_phases_course on public.phases(course_id, position);
create index if not exists idx_lessons_phase on public.lessons(phase_id, position);
create index if not exists idx_quizzes_course on public.quizzes(course_id);
create index if not exists idx_questions_quiz on public.questions(quiz_id, position);
create index if not exists idx_challenges_course on public.challenges(course_id);
create index if not exists idx_course_enrollments_user on public.course_enrollments(user_id, status);
create index if not exists idx_lesson_progress_user on public.lesson_progress(user_id, course_id, completed);
create index if not exists idx_quiz_attempts_user_quiz on public.quiz_attempts(user_id, quiz_id);
create index if not exists idx_submissions_status on public.submissions(status, created_at desc);
create index if not exists idx_user_skills_user on public.user_skills(user_id);
