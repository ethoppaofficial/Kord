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
  v_completed_activities integer := 0;
  v_total_minutes integer := 0;
  v_enrolled_count integer := 0;
  v_passed_quizzes integer := 0;
  v_total_attempts integer := 0;
  v_approved_subs integer := 0;
  v_pending_subs integer := 0;
  v_revision_subs integer := 0;
  v_skills jsonb := '[]'::jsonb;
  v_weekly jsonb := '[]'::jsonb;
  v_hourly jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select count(*), coalesce(sum(coalesce(ap.minutes_spent, a.est_minutes)), 0)
  into v_completed_activities, v_total_minutes
  from public.activity_progress ap
  join public.activities a on a.id = ap.activity_id
  where ap.user_id = v_uid and ap.completed = true;

  select count(*) into v_enrolled_count
  from public.enrollments where user_id = v_uid and status = 'active';

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
    'level', us.level,
    'updatedAt', us.updated_at
  )), '[]'::jsonb)
  into v_skills
  from public.user_skills us
  join public.skills s on s.id = us.skill_id
  where us.user_id = v_uid;

  return jsonb_build_object(
    'learning', jsonb_build_object(
      'activeRoadmaps', v_enrolled_count,
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
    'weeklyMinutes', v_weekly,
    'hourlyDistribution', v_hourly
  );
end;
$$;
