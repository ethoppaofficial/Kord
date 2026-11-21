-- 20261121000005_progression_functions.sql
-- Internal progression engine and authenticated learner progression RPCs.

-- INTERNAL ONLY: never callable directly by clients or learners
create or replace function public.upgrade_user_skill_level(
  p_user_id uuid,
  p_skill_id uuid,
  p_target_level text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rank_map jsonb := '{"declared": 1, "practising": 2, "demonstrated": 3, "verified": 4}'::jsonb;
  current_level text;
begin
  if p_target_level not in ('declared', 'practising', 'demonstrated', 'verified') then
    raise exception 'Invalid skill level: %', p_target_level;
  end if;

  if not exists (select 1 from public.skills where id = p_skill_id) then
    raise exception 'Skill not found: %', p_skill_id;
  end if;

  select level into current_level
  from public.user_skills
  where user_id = p_user_id and skill_id = p_skill_id;

  if current_level is null then
    insert into public.user_skills (user_id, skill_id, level)
    values (p_user_id, p_skill_id, p_target_level)
    on conflict (user_id, skill_id) do nothing;
  elsif (rank_map ->> p_target_level)::int > (rank_map ->> current_level)::int then
    update public.user_skills
    set level = p_target_level, updated_at = now()
    where user_id = p_user_id and skill_id = p_skill_id;
  end if;
end;
$$;

revoke all on function public.upgrade_user_skill_level(uuid, uuid, text) from public, anon, authenticated;

-- INTERNAL ONLY: evaluates published course requirements & skill progression
create or replace function public.evaluate_course_and_skill_progression(
  p_user_id uuid,
  p_course_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_skill_id uuid;
  v_rules jsonb := '{}'::jsonb;
  v_course_pub text;
  v_req_lessons integer := 0;
  v_done_lessons integer := 0;
  v_req_activities integer := 0;
  v_done_activities integer := 0;
  v_req_quizzes integer := 0;
  v_passed_quizzes integer := 0;
  v_req_challenges integer := 0;
  v_submitted_challenges integer := 0;
  v_approved_challenges integer := 0;
  v_lessons_ok boolean := false;
  v_activities_ok boolean := true;
  v_quizzes_ok boolean := false;
  v_challenges_sub_ok boolean := true;
  v_challenges_app_ok boolean := false;
  v_practical_approved boolean := false;
  v_instructional_done boolean := false;
  v_require_approval boolean := true;
  v_completion_state text := 'in_progress';
  v_course_done boolean := false;
  v_has_content boolean := false;
  v_skill_rec record;
  v_pub_courses integer := 0;
  v_done_verified_courses integer := 0;
begin
  select skill_id, coalesce(completion_rules, '{}'::jsonb), publication_status
  into v_primary_skill_id, v_rules, v_course_pub
  from public.courses
  where id = p_course_id;

  if v_primary_skill_id is null or v_course_pub <> 'published' then
    return;
  end if;

  if not exists (
    select 1 from public.course_enrollments
    where user_id = p_user_id and course_id = p_course_id
  ) then
    return;
  end if;

  select count(*) into v_req_lessons
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  where p.course_id = p_course_id
    and p.publication_status = 'published'
    and l.publication_status = 'published'
    and l.is_required = true;

  select count(*) into v_done_lessons
  from public.lesson_progress lp
  join public.lessons l on l.id = lp.lesson_id
  join public.phases p on p.id = l.phase_id
  where p.course_id = p_course_id
    and p.publication_status = 'published'
    and l.publication_status = 'published'
    and l.is_required = true
    and lp.user_id = p_user_id
    and lp.completed = true;

  select count(*) into v_req_activities
  from public.activities a
  join public.phases p on p.id = a.phase_id
  where p.course_id = p_course_id
    and p.publication_status = 'published'
    and a.is_required = true;

  select count(*) into v_done_activities
  from public.activity_progress ap
  join public.activities a on a.id = ap.activity_id
  join public.phases p on p.id = a.phase_id
  where p.course_id = p_course_id
    and p.publication_status = 'published'
    and a.is_required = true
    and ap.user_id = p_user_id
    and ap.completed = true;

  select count(*) into v_req_quizzes
  from public.quizzes q
  where q.course_id = p_course_id
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
    );

  select count(distinct qa.quiz_id) into v_passed_quizzes
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where q.course_id = p_course_id
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
    and qa.user_id = p_user_id
    and qa.passed = true
    and qa.review_status in ('auto_graded', 'reviewed', 'graded');

  select count(*) into v_req_challenges
  from public.challenges c
  where c.course_id = p_course_id
    and c.is_required = true
    and (
      c.phase_id is null
      or exists (
        select 1 from public.phases p
        where p.id = c.phase_id and p.publication_status = 'published'
      )
    );

  select count(distinct s.challenge_id) into v_submitted_challenges
  from public.submissions s
  join public.challenges c on c.id = s.challenge_id
  where c.course_id = p_course_id
    and c.is_required = true
    and (
      c.phase_id is null
      or exists (
        select 1 from public.phases p
        where p.id = c.phase_id and p.publication_status = 'published'
      )
    )
    and s.user_id = p_user_id;

  select count(distinct s.challenge_id) into v_approved_challenges
  from public.submissions s
  join public.challenges c on c.id = s.challenge_id
  where c.course_id = p_course_id
    and c.is_required = true
    and (
      c.phase_id is null
      or exists (
        select 1 from public.phases p
        where p.id = c.phase_id and p.publication_status = 'published'
      )
    )
    and s.user_id = p_user_id
    and s.status = 'approved';

  v_has_content := (v_req_lessons + v_req_activities + v_req_quizzes + v_req_challenges) > 0;
  v_lessons_ok := coalesce((v_rules ->> 'requireAllRequiredLessons')::boolean, true) = false or v_done_lessons >= v_req_lessons;
  v_activities_ok := coalesce((v_rules ->> 'requireAllActivities')::boolean, true) = false or v_done_activities >= v_req_activities;
  v_quizzes_ok := coalesce((v_rules ->> 'requireAllAssessments')::boolean, true) = false or v_passed_quizzes >= v_req_quizzes;
  v_challenges_sub_ok := coalesce((v_rules ->> 'requireChallengeSubmission')::boolean, true) = false or v_submitted_challenges >= v_req_challenges;
  v_require_approval := coalesce((v_rules ->> 'requireChallengeApproval')::boolean, true);
  v_challenges_app_ok := (not v_require_approval) or v_approved_challenges >= v_req_challenges;
  v_practical_approved := v_req_challenges > 0 and v_approved_challenges >= v_req_challenges;
  v_instructional_done := v_has_content and v_lessons_ok and v_activities_ok and v_quizzes_ok;

  if v_instructional_done then
    if v_require_approval and v_req_challenges > 0 then
      if v_practical_approved then
        v_completion_state := 'completed_verified';
      else
        v_completion_state := 'awaiting_practical_assessment';
      end if;
    elsif v_challenges_sub_ok then
      if v_practical_approved then
        v_completion_state := 'completed_verified';
      else
        v_completion_state := 'completed';
      end if;
    end if;
  end if;

  v_course_done := v_completion_state in ('completed', 'completed_verified');

  update public.course_enrollments
  set status = case
        when v_course_done then 'completed'
        when status = 'completed' then 'active'
        else status
      end,
      completion_state = v_completion_state,
      completed_at = case when v_course_done then coalesce(completed_at, now()) else null end,
      updated_at = now()
  where user_id = p_user_id and course_id = p_course_id;

  insert into public.course_completions (user_id, course_id, completion_state, practical_approved, completed_at, updated_at)
  values (
    p_user_id,
    p_course_id,
    v_completion_state,
    v_practical_approved,
    case when v_course_done then now() else null end,
    now()
  )
  on conflict (user_id, course_id) do update set
    completion_state = excluded.completion_state,
    practical_approved = excluded.practical_approved,
    completed_at = case when v_course_done then coalesce(public.course_completions.completed_at, excluded.completed_at) else null end,
    updated_at = now();

  for v_skill_rec in
    select distinct skill_id from (
      select v_primary_skill_id as skill_id
      union
      select cs.skill_id from public.course_skills cs where cs.course_id = p_course_id
    ) s
  loop
    if v_done_lessons > 0 or v_done_activities > 0 then
      perform public.upgrade_user_skill_level(p_user_id, v_skill_rec.skill_id, 'practising');
    end if;

    if v_course_done then
      perform public.upgrade_user_skill_level(p_user_id, v_skill_rec.skill_id, 'demonstrated');
    end if;

    select count(distinct c.id) into v_pub_courses
    from public.courses c
    left join public.course_skills cs on cs.course_id = c.id
    where c.publication_status = 'published'
      and (c.skill_id = v_skill_rec.skill_id or cs.skill_id = v_skill_rec.skill_id);

    select count(distinct c.id) into v_done_verified_courses
    from public.courses c
    left join public.course_skills cs on cs.course_id = c.id
    join public.course_completions cc on cc.course_id = c.id and cc.user_id = p_user_id
    where c.publication_status = 'published'
      and (c.skill_id = v_skill_rec.skill_id or cs.skill_id = v_skill_rec.skill_id)
      and cc.completion_state = 'completed_verified';

    if v_pub_courses > 0 and v_done_verified_courses >= v_pub_courses then
      perform public.upgrade_user_skill_level(p_user_id, v_skill_rec.skill_id, 'verified');
    end if;
  end loop;
end;
$$;

revoke all on function public.evaluate_course_and_skill_progression(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Learner-facing authenticated progression RPCs (derive user strictly from auth.uid())
-- ---------------------------------------------------------------------------

create or replace function public.declare_user_skill(p_skill_id uuid)
returns public.user_skills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skill public.skills;
  row_out public.user_skills;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  select * into v_skill from public.skills where id = p_skill_id;
  if not found or v_skill.publication_status <> 'published' then
    raise exception 'Published skill not found';
  end if;

  perform public.upgrade_user_skill_level(auth.uid(), p_skill_id, 'declared');
  select * into row_out
  from public.user_skills
  where user_id = auth.uid() and skill_id = p_skill_id;
  return row_out;
end;
$$;

revoke all on function public.declare_user_skill(uuid) from public, anon;
grant execute on function public.declare_user_skill(uuid) to authenticated;

create or replace function public.enroll_in_course(p_course_id uuid)
returns public.course_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_projected timestamptz;
  v_enrollment public.course_enrollments;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  select * into v_course
  from public.courses
  where id = p_course_id and publication_status = 'published';
  if not found then
    raise exception 'Published course not found';
  end if;

  v_projected := now() + make_interval(days => greatest(7, coalesce(v_course.estimated_duration_weeks, 4) * 7));

  insert into public.course_enrollments (
    user_id, course_id, skill_id, status, completion_state, enrolled_at, projected_completion_at, updated_at
  )
  values (
    auth.uid(), p_course_id, v_course.skill_id, 'active', 'in_progress', now(), v_projected, now()
  )
  on conflict (user_id, course_id) do update set
    status = case
      when public.course_enrollments.status = 'completed' then 'completed'
      else 'active'
    end,
    projected_completion_at = coalesce(public.course_enrollments.projected_completion_at, excluded.projected_completion_at),
    updated_at = now()
  returning * into v_enrollment;

  insert into public.enrollments (user_id, skill_id, status, enrolled_at, updated_at)
  values (auth.uid(), v_course.skill_id, 'active', now(), now())
  on conflict (user_id, skill_id) do update set
    status = case
      when public.enrollments.status = 'completed' then 'completed'
      else 'active'
    end,
    updated_at = now();

  perform public.upgrade_user_skill_level(auth.uid(), v_course.skill_id, 'declared');
  perform public.evaluate_course_and_skill_progression(auth.uid(), p_course_id);

  select * into v_enrollment
  from public.course_enrollments
  where user_id = auth.uid() and course_id = p_course_id;
  return v_enrollment;
end;
$$;

revoke all on function public.enroll_in_course(uuid) from public, anon;
grant execute on function public.enroll_in_course(uuid) to authenticated;

create or replace function public.set_course_enrollment_status(
  p_course_id uuid,
  p_status text
)
returns public.course_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.course_enrollments;
  v_updated public.course_enrollments;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  if p_status not in ('active', 'paused') then
    raise exception 'Status must be active or paused';
  end if;

  select * into v_existing
  from public.course_enrollments
  where user_id = auth.uid() and course_id = p_course_id;

  if not found then
    raise exception 'Course enrollment not found';
  end if;

  if v_existing.status = 'completed' then
    raise exception 'Completed courses cannot be paused or reverted directly';
  end if;

  update public.course_enrollments
  set status = p_status,
      updated_at = now()
  where id = v_existing.id
  returning * into v_updated;

  update public.enrollments
  set status = case
        when exists (
          select 1 from public.course_enrollments ce
          where ce.user_id = auth.uid() and ce.skill_id = v_existing.skill_id and ce.status = 'active'
        ) then 'active'
        when exists (
          select 1 from public.course_enrollments ce
          where ce.user_id = auth.uid() and ce.skill_id = v_existing.skill_id and ce.status = 'completed'
        ) then 'completed'
        else 'paused'
      end,
      updated_at = now()
  where user_id = auth.uid() and skill_id = v_existing.skill_id;

  return v_updated;
end;
$$;

revoke all on function public.set_course_enrollment_status(uuid, text) from public, anon;
grant execute on function public.set_course_enrollment_status(uuid, text) to authenticated;

create or replace function public.save_lesson_notes(
  p_lesson_id uuid,
  p_notes text
)
returns public.lesson_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_clean_notes text := coalesce(p_notes, '');
  v_row public.lesson_progress;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  if length(v_clean_notes) > 20000 then
    raise exception 'Lesson notes cannot exceed 20,000 characters';
  end if;

  select c.id into v_course_id
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  join public.courses c on c.id = p.course_id
  where l.id = p_lesson_id
    and l.publication_status = 'published'
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  if v_course_id is null then
    raise exception 'Published lesson not found';
  end if;

  if not exists (
    select 1 from public.course_enrollments ce
    where ce.user_id = auth.uid()
      and ce.course_id = v_course_id
      and ce.status in ('active', 'completed')
  ) then
    raise exception 'Active course enrollment required to save lesson notes';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, course_id, notes, completed, updated_at)
  values (auth.uid(), p_lesson_id, v_course_id, v_clean_notes, false, now())
  on conflict (user_id, lesson_id) do update set
    notes = excluded.notes,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.save_lesson_notes(uuid, text) from public, anon;
grant execute on function public.save_lesson_notes(uuid, text) to authenticated;

create or replace function public.set_lesson_completion(
  p_lesson_id uuid,
  p_completed boolean
)
returns public.lesson_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_est_minutes integer := 25;
  v_completed boolean := coalesce(p_completed, true);
  v_row public.lesson_progress;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  select c.id, greatest(1, coalesce(l.est_minutes, 25))
  into v_course_id, v_est_minutes
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  join public.courses c on c.id = p.course_id
  where l.id = p_lesson_id
    and l.publication_status = 'published'
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  if v_course_id is null then
    raise exception 'Published lesson not found';
  end if;

  if not exists (
    select 1 from public.course_enrollments ce
    where ce.user_id = auth.uid()
      and ce.course_id = v_course_id
      and ce.status in ('active', 'completed')
  ) then
    raise exception 'Active course enrollment required to complete lessons';
  end if;

  insert into public.lesson_progress (
    user_id, lesson_id, course_id, completed, minutes_spent, completed_at, updated_at
  )
  values (
    auth.uid(),
    p_lesson_id,
    v_course_id,
    v_completed,
    case when v_completed then v_est_minutes else null end,
    case when v_completed then now() else null end,
    now()
  )
  on conflict (user_id, lesson_id) do update set
    completed = excluded.completed,
    minutes_spent = case when excluded.completed then v_est_minutes else null end,
    completed_at = case when excluded.completed then coalesce(public.lesson_progress.completed_at, now()) else null end,
    updated_at = now()
  returning * into v_row;

  perform public.evaluate_course_and_skill_progression(auth.uid(), v_course_id);
  return v_row;
end;
$$;

revoke all on function public.set_lesson_completion(uuid, boolean) from public, anon;
grant execute on function public.set_lesson_completion(uuid, boolean) to authenticated;

create or replace function public.set_activity_completion(
  p_activity_id uuid,
  p_completed boolean,
  p_notes text default null
)
returns public.activity_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_est_minutes integer := 20;
  v_completed boolean := coalesce(p_completed, true);
  v_row public.activity_progress;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  if p_notes is not null and length(p_notes) > 20000 then
    raise exception 'Activity notes cannot exceed 20,000 characters';
  end if;

  select c.id, greatest(1, coalesce(a.est_minutes, 20))
  into v_course_id, v_est_minutes
  from public.activities a
  join public.phases p on p.id = a.phase_id
  join public.courses c on c.id = p.course_id
  where a.id = p_activity_id
    and p.publication_status = 'published'
    and c.publication_status = 'published';

  if v_course_id is null then
    raise exception 'Published phase activity not found';
  end if;

  if not exists (
    select 1 from public.course_enrollments ce
    where ce.user_id = auth.uid()
      and ce.course_id = v_course_id
      and ce.status in ('active', 'completed')
  ) then
    raise exception 'Active course enrollment required to track activities';
  end if;

  insert into public.activity_progress (
    user_id, activity_id, notes, completed, minutes_spent, completed_at, updated_at
  )
  values (
    auth.uid(),
    p_activity_id,
    coalesce(p_notes, ''),
    v_completed,
    case when v_completed then v_est_minutes else null end,
    case when v_completed then now() else null end,
    now()
  )
  on conflict (user_id, activity_id) do update set
    notes = case when p_notes is not null then p_notes else public.activity_progress.notes end,
    completed = excluded.completed,
    minutes_spent = case when excluded.completed then v_est_minutes else null end,
    completed_at = case when excluded.completed then coalesce(public.activity_progress.completed_at, now()) else null end,
    updated_at = now()
  returning * into v_row;

  perform public.evaluate_course_and_skill_progression(auth.uid(), v_course_id);
  return v_row;
end;
$$;

revoke all on function public.set_activity_completion(uuid, boolean, text) from public, anon;
grant execute on function public.set_activity_completion(uuid, boolean, text) to authenticated;
