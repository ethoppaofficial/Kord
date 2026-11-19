-- 01_schema.sql
-- Kord core relational schema (Idempotent DDL)

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

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  category text not null,
  level text not null check (level in ('Beginner', 'Intermediate', 'Advanced')),
  summary text not null,
  roadmap_status text not null default 'full' check (roadmap_status in ('full', 'coming_soon')),
  est_hours numeric(4,1) not null default 2.0,
  outcomes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.phases (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  position integer not null,
  title text not null,
  summary text not null default '',
  unique (skill_id, position)
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
  phase_id uuid references public.phases(id) on delete cascade,
  quiz_type text not null check (quiz_type in ('phase', 'skill_check')),
  title text not null,
  description text not null default '',
  pass_percent integer not null default 70
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position integer not null default 1,
  prompt text not null,
  options jsonb not null,
  correct_index integer not null check (correct_index >= 0),
  explanation text not null default ''
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  title text not null,
  brief text not null,
  deliverable_hint text not null default '',
  rubric jsonb not null default '[]'::jsonb
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
  answers jsonb not null default '[]'::jsonb,
  score integer not null,
  total integer not null,
  percentage integer not null,
  passed boolean not null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  evidence_url text,
  file_path text,
  file_name text,
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

create index if not exists idx_phases_skill on public.phases(skill_id);
create index if not exists idx_activities_phase on public.activities(phase_id);
create index if not exists idx_quizzes_skill on public.quizzes(skill_id);
create index if not exists idx_questions_quiz on public.questions(quiz_id);
create index if not exists idx_enrollments_user on public.enrollments(user_id, status);
create index if not exists idx_activity_progress_user on public.activity_progress(user_id, completed);
create index if not exists idx_quiz_attempts_user_quiz on public.quiz_attempts(user_id, quiz_id);
create index if not exists idx_submissions_status on public.submissions(status, created_at desc);
create index if not exists idx_submissions_user on public.submissions(user_id, challenge_id);
create index if not exists idx_user_skills_user on public.user_skills(user_id);
