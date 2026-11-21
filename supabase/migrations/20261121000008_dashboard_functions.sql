-- 20261121000008_dashboard_functions.sql
-- Hardened unified dashboard RPC filtering completed content against published curriculum.

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
    count(*) filter (where ce.status = 'completed')
  into v_active_courses, v_completed_courses
  from public.course_enrollments ce
  join public.courses c on c.id = ce.course_id
  where ce.user_id = v_uid
    and c.publication_status = 'published';

  select
    count(*) filter (where passed and review_status in ('auto_graded', 'reviewed', 'graded')),
    count(*)
  into v_passed_quizzes, v_total_attempts
  from public.quiz_attempts
  where user_id = v_uid;

  select
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'needs_revision')
  into v_approved_subs, v_pending_subs, v_revision_subs
  from public.submissions
  where user_id = v_uid;

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
  where us.user_id = v_uid
    and s.publication_status = 'published';

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

revoke all on function public.get_dashboard() from public, anon;
grant execute on function public.get_dashboard() to authenticated;
