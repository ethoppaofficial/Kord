-- 06_dashboard.sql
-- Unified dashboard RPC matching src/dashboard/dashboardData.js

create or replace function public.get_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_completed_lessons integer := 0;
  v_completed_activities integer := 0;
  v_total_minutes integer := 0;
  v_active_courses integer := 0;
  v_completed_courses integer := 0;
  v_passed_quizzes integer := 0;
  v_total_attempts integer := 0;
  v_approved_subs integer := 0;
  v_pending_subs integer := 0;
  v_revision_subs integer := 0;
  v_skills jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select count(*), coalesce(sum(coalesce(lp.minutes_spent, l.est_minutes)), 0)
  into v_completed_lessons, v_total_minutes
  from public.lesson_progress lp
  join public.lessons l on l.id = lp.lesson_id
  where lp.user_id = v_uid and lp.completed = true;

  select count(*) into v_completed_activities
  from public.activity_progress ap
  where ap.user_id = v_uid and ap.completed = true;

  select
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'completed')
  into v_active_courses, v_completed_courses
  from public.course_enrollments where user_id = v_uid;

  select count(*) filter (where passed), count(*)
  into v_passed_quizzes, v_total_attempts
  from public.quiz_attempts where user_id = v_uid;

  select
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'needs_revision')
  into v_approved_subs, v_pending_subs, v_revision_subs
  from public.submissions where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'skillId', s.id,
    'slug', s.slug,
    'title', s.title,
    'category', s.category,
    'level', us.level,
    'updatedAt', us.updated_at
  )), '[]'::jsonb)
  into v_skills
  from public.user_skills us
  join public.skills s on s.id = us.skill_id
  where us.user_id = v_uid;

  return jsonb_build_object(
    'learning', jsonb_build_object(
      'activeCourses', v_active_courses,
      'completedCourses', v_completed_courses,
      'completedLessons', v_completed_lessons,
      'completedActivities', v_completed_activities,
      'minutesLearned', v_total_minutes
    ),
    'understanding', jsonb_build_object(
      'passedQuizzes', v_passed_quizzes,
      'totalAttempts', v_total_attempts
    ),
    'demonstrating', jsonb_build_object(
      'approvedSubmissions', v_approved_subs,
      'pendingSubmissions', v_pending_subs,
      'needsRevisionSubmissions', v_revision_subs
    ),
    'skillLevels', v_skills,
    'weeklyMinutes', '[]'::jsonb,
    'hourlyDistribution', '[]'::jsonb
  );
end;
$$;
