-- 06_dashboard.sql (Synchronized with migrations 000008 and 20261122000010)

-- Hardened unified dashboard RPC returning full learner metrics, enrolled courses, and real study time series.

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
  v_paused_courses integer := 0;
  v_completed_courses integer := 0;
  v_passed_quizzes integer := 0;
  v_total_attempts integer := 0;
  v_avg_score integer := 0;
  v_approved_subs integer := 0;
  v_pending_subs integer := 0;
  v_revision_subs integer := 0;
  v_total_subs integer := 0;
  v_skills jsonb := '[]'::jsonb;
  v_enrolled_courses jsonb := '[]'::jsonb;
  v_weekly_minutes jsonb := '[]'::jsonb;
  v_hourly_distribution jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select count(*), coalesce(sum(coalesce(lp.minutes_spent, l.est_minutes)), 0)::int
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
    count(*) filter (where ce.status = 'paused'),
    count(*) filter (where ce.status = 'completed')
  into v_active_courses, v_paused_courses, v_completed_courses
  from public.course_enrollments ce
  join public.courses c on c.id = ce.course_id
  where ce.user_id = v_uid
    and c.publication_status = 'published';

  select
    count(distinct qa.quiz_id) filter (where qa.passed and qa.review_status in ('auto_graded', 'reviewed', 'graded')),
    count(*),
    coalesce(round(avg(qa.percentage))::int, 0)
  into v_passed_quizzes, v_total_attempts, v_avg_score
  from public.quiz_attempts qa
  where qa.user_id = v_uid;

  select
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'needs_revision'),
    count(*)
  into v_approved_subs, v_pending_subs, v_revision_subs, v_total_subs
  from public.submissions
  where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'skillId', s.id,
    'slug', s.slug,
    'title', s.title,
    'category', s.category,
    'level', us.level,
    'updatedAt', us.updated_at
  ) order by us.updated_at desc), '[]'::jsonb)
  into v_skills
  from public.user_skills us
  join public.skills s on s.id = us.skill_id
  where us.user_id = v_uid
    and s.publication_status = 'published';

  -- Enrolled published courses with live progress calculation
  with course_stats as (
    select
      c.id as course_id,
      c.slug,
      c.title,
      coalesce(sk.title, '') as skill_title,
      coalesce(sk.slug, '') as skill_slug,
      c.difficulty,
      c.estimated_duration_weeks,
      ce.status,
      coalesce(cc.completion_state, ce.completion_state, 'in_progress') as completion_state,
      coalesce(cc.practical_approved, false) as practical_approved,
      ce.projected_completion_at,
      ce.updated_at,
      (
        select count(*)
        from public.lessons l
        join public.phases p on p.id = l.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and l.publication_status = 'published'
          and l.is_required = true
      )::int as req_lessons,
      (
        select count(*)
        from public.lesson_progress lp
        join public.lessons l on l.id = lp.lesson_id
        join public.phases p on p.id = l.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and l.publication_status = 'published'
          and l.is_required = true
          and lp.user_id = v_uid
          and lp.completed = true
      )::int as done_lessons,
      (
        select count(*)
        from public.activities a
        join public.phases p on p.id = a.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and a.is_required = true
      )::int as req_activities,
      (
        select count(*)
        from public.activity_progress ap
        join public.activities a on a.id = ap.activity_id
        join public.phases p on p.id = a.phase_id
        where p.course_id = c.id
          and p.publication_status = 'published'
          and a.is_required = true
          and ap.user_id = v_uid
          and ap.completed = true
      )::int as done_activities,
      (
        select count(*)
        from public.quizzes q
        where q.course_id = c.id
          and (q.phase_id is null or exists (select 1 from public.phases p where p.id = q.phase_id and p.publication_status = 'published'))
          and (q.lesson_id is null or exists (select 1 from public.lessons l where l.id = q.lesson_id and l.publication_status = 'published'))
      )::int as req_quizzes,
      (
        select count(distinct qa.quiz_id)
        from public.quiz_attempts qa
        join public.quizzes q on q.id = qa.quiz_id
        where q.course_id = c.id
          and (q.phase_id is null or exists (select 1 from public.phases p where p.id = q.phase_id and p.publication_status = 'published'))
          and (q.lesson_id is null or exists (select 1 from public.lessons l where l.id = q.lesson_id and l.publication_status = 'published'))
          and qa.user_id = v_uid
          and qa.passed = true
          and qa.review_status in ('auto_graded', 'reviewed', 'graded')
      )::int as passed_quizzes,
      (
        select count(*)
        from public.challenges ch
        where ch.course_id = c.id
          and ch.is_required = true
          and (ch.phase_id is null or exists (select 1 from public.phases p where p.id = ch.phase_id and p.publication_status = 'published'))
      )::int as req_challenges,
      (
        select count(distinct s.challenge_id)
        from public.submissions s
        join public.challenges ch on ch.id = s.challenge_id
        where ch.course_id = c.id
          and ch.is_required = true
          and (ch.phase_id is null or exists (select 1 from public.phases p where p.id = ch.phase_id and p.publication_status = 'published'))
          and s.user_id = v_uid
          and s.status = 'approved'
      )::int as approved_challenges
    from public.course_enrollments ce
    join public.courses c on c.id = ce.course_id
    left join public.skills sk on sk.id = c.skill_id
    left join public.course_completions cc on cc.user_id = ce.user_id and cc.course_id = ce.course_id
    where ce.user_id = v_uid
      and c.publication_status = 'published'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cs.course_id,
    'slug', cs.slug,
    'title', cs.title,
    'skillTitle', cs.skill_title,
    'skillSlug', cs.skill_slug,
    'difficulty', cs.difficulty,
    'estimatedDurationWeeks', cs.estimated_duration_weeks,
    'status', cs.status,
    'completionState', cs.completion_state,
    'progress', jsonb_build_object(
      'requiredLessonsCount', cs.req_lessons,
      'completedLessonsCount', cs.done_lessons,
      'requiredActivitiesCount', cs.req_activities,
      'completedActivitiesCount', cs.done_activities,
      'assessmentsCount', cs.req_quizzes,
      'passedAssessmentsCount', cs.passed_quizzes,
      'challengesCount', cs.req_challenges,
      'approvedChallengesCount', cs.approved_challenges,
      'practicalApproved', cs.practical_approved,
      'completionState', cs.completion_state,
      'isCompleted', (cs.status = 'completed' or cs.completion_state in ('completed', 'completed_verified')),
      'progressPercent', case
        when (cs.req_lessons + cs.req_activities + cs.req_quizzes + cs.req_challenges) > 0 then
          least(100, round(
            ((cs.done_lessons + cs.done_activities + cs.passed_quizzes + cs.approved_challenges)::numeric
              / (cs.req_lessons + cs.req_activities + cs.req_quizzes + cs.req_challenges)::numeric) * 100
          )::int)
        else 0
      end,
      'projectedCompletionAt', cs.projected_completion_at
    )
  ) order by cs.updated_at desc), '[]'::jsonb)
  into v_enrolled_courses
  from course_stats cs;

  -- Real 9-week study minutes series ending on the current ISO week
  with current_wk as (
    select date_trunc('week', timezone('UTC', now()))::date as wk_start
  ),
  weeks as (
    select (wk_start - (offset_w * 7))::date as wk
    from current_wk, generate_series(8, 0, -1) as offset_w
  ),
  lesson_mins as (
    select
      date_trunc('week', timezone('UTC', lp.completed_at))::date as wk,
      sum(coalesce(lp.minutes_spent, l.est_minutes))::int as mins
    from public.lesson_progress lp
    join public.lessons l on l.id = lp.lesson_id
    join public.phases p on p.id = l.phase_id
    join public.courses c on c.id = p.course_id
    where lp.user_id = v_uid
      and lp.completed = true
      and lp.completed_at is not null
      and l.publication_status = 'published'
      and p.publication_status = 'published'
      and c.publication_status = 'published'
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', to_char(w.wk, 'YYYY-MM-DD'),
    'label', to_char(w.wk, 'FMDD Mon'),
    'minutes', coalesce(lm.mins, 0)
  ) order by w.wk asc), '[]'::jsonb)
  into v_weekly_minutes
  from weeks w
  left join lesson_mins lm on lm.wk = w.wk;

  -- Real 6-bucket hourly distribution series from completed_at timestamps
  with buckets(label, start_hr, end_hr) as (
    values
      ('06–09', 6, 9),
      ('09–12', 9, 12),
      ('12–15', 12, 15),
      ('15–18', 15, 18),
      ('18–21', 18, 21),
      ('21–24', 21, 24)
  ),
  lesson_hours as (
    select
      extract(hour from timezone('UTC', lp.completed_at))::int as hr,
      coalesce(lp.minutes_spent, l.est_minutes)::int as mins
    from public.lesson_progress lp
    join public.lessons l on l.id = lp.lesson_id
    join public.phases p on p.id = l.phase_id
    join public.courses c on c.id = p.course_id
    where lp.user_id = v_uid
      and lp.completed = true
      and lp.completed_at is not null
      and l.publication_status = 'published'
      and p.publication_status = 'published'
      and c.publication_status = 'published'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'label', b.label,
    'start', b.start_hr,
    'end', b.end_hr,
    'minutes', coalesce((
      select sum(lh.mins)::int
      from lesson_hours lh
      where lh.hr >= b.start_hr and lh.hr < b.end_hr
    ), 0)
  ) order by b.start_hr asc), '[]'::jsonb)
  into v_hourly_distribution
  from buckets b;

  return jsonb_build_object(
    'learning', jsonb_build_object(
      'activeCourses', v_active_courses,
      'pausedCourses', v_paused_courses,
      'completedCourses', v_completed_courses,
      'completedLessons', v_completed_lessons,
      'completedActivities', v_completed_activities,
      'minutesLearned', v_total_minutes
    ),
    'understanding', jsonb_build_object(
      'passedQuizzes', v_passed_quizzes,
      'totalAttempts', v_total_attempts,
      'averageScore', v_avg_score
    ),
    'demonstrating', jsonb_build_object(
      'approvedSubmissions', v_approved_subs,
      'pendingSubmissions', v_pending_subs,
      'needsRevisionSubmissions', v_revision_subs,
      'totalSubmissions', v_total_subs
    ),
    'enrolledCourses', v_enrolled_courses,
    'skillLevels', v_skills,
    'weeklyMinutes', v_weekly_minutes,
    'hourlyDistribution', v_hourly_distribution
  );
end;
$$;

revoke all on function public.get_dashboard() from public, anon;
grant execute on function public.get_dashboard() to authenticated;
