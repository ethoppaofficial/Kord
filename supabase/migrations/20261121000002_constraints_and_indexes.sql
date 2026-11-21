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
