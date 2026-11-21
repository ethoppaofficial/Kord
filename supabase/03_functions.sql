-- 03_functions.sql (Synchronized with migrations 000005-000006)

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

-- 20261121000006_assessment_and_submission_functions.sql
-- Hardened quiz grading, answer-key protection, practical submissions, admin grading, and curriculum management RPCs.

create or replace function public.submit_quiz(
  p_quiz_id uuid,
  p_answers jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz public.quizzes;
  v_q record;
  v_raw jsonb;
  v_raw_text text;
  v_selected integer;
  v_opt_len integer;
  v_score integer := 0;
  v_total integer := 0;
  v_pct integer := 0;
  v_passed boolean := false;
  v_has_manual boolean := false;
  v_review_status text := 'auto_graded';
  v_solutions_released boolean := false;
  v_results jsonb := '[]'::jsonb;
  v_existing public.quiz_attempts;
  v_attempt_id uuid;
  v_attempt_num integer := 1;
  v_is_correct boolean;
  v_sel_sorted jsonb;
  v_exp_sorted jsonb;
  v_clean_answers jsonb := '{}'::jsonb;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers payload must be a JSON object';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Assessment not found';
  end if;

  if v_idem is not null then
    select * into v_existing
    from public.quiz_attempts
    where user_id = auth.uid() and idempotency_key = v_idem;
    if found then
      v_solutions_released := (v_existing.review_status <> 'pending_review')
        and (v_existing.passed or (v_quiz.max_attempts is not null and v_existing.attempt_number >= v_quiz.max_attempts));
      return jsonb_build_object(
        'attemptId', v_existing.id,
        'quizId', v_existing.quiz_id,
        'attemptNumber', v_existing.attempt_number,
        'score', v_existing.score,
        'total', v_existing.total,
        'percentage', v_existing.percentage,
        'passed', v_existing.passed,
        'reviewStatus', v_existing.review_status,
        'solutionsReleased', v_solutions_released,
        'results', '[]'::jsonb
      );
    end if;
  end if;

  if v_quiz.course_id is not null then
    if not exists (
      select 1 from public.courses
      where id = v_quiz.course_id and publication_status = 'published'
    ) then
      raise exception 'Course assessment is not currently published';
    end if;

    if v_quiz.phase_id is not null and not exists (
      select 1 from public.phases
      where id = v_quiz.phase_id and publication_status = 'published'
    ) then
      raise exception 'Module assessment is not currently published';
    end if;

    if v_quiz.lesson_id is not null and not exists (
      select 1 from public.lessons
      where id = v_quiz.lesson_id and publication_status = 'published'
    ) then
      raise exception 'Lesson assessment is not currently published';
    end if;

    if not exists (
      select 1 from public.course_enrollments
      where user_id = auth.uid()
        and course_id = v_quiz.course_id
        and status in ('active', 'completed')
    ) then
      raise exception 'Active course enrollment required to submit this assessment';
    end if;
  else
    if not exists (
      select 1 from public.skills
      where id = v_quiz.skill_id and publication_status = 'published'
    ) then
      raise exception 'Assessment skill is not currently published';
    end if;
  end if;

  select count(*) + 1 into v_attempt_num
  from public.quiz_attempts
  where user_id = auth.uid() and quiz_id = p_quiz_id;

  if v_quiz.max_attempts is not null and (v_attempt_num - 1) >= v_quiz.max_attempts then
    raise exception 'Maximum number of attempts reached for this assessment';
  end if;

  for v_q in
    select id, position, question_type, marks, prompt, options, correct_index, answer_config, explanation
    from public.questions
    where quiz_id = p_quiz_id
    order by position asc
  loop
    v_total := v_total + greatest(1, coalesce(v_q.marks, 1));
    v_raw := p_answers -> (v_q.id::text);
    v_is_correct := false;
    v_opt_len := coalesce(jsonb_array_length(v_q.options), 0);

    if v_raw is not null then
      v_clean_answers := v_clean_answers || jsonb_build_object(v_q.id::text, v_raw);
    end if;

    if v_q.question_type in ('short_answer', 'long_form', 'practical_submission') then
      v_has_manual := true;
    elsif v_q.question_type = 'multiple_select' then
      if v_raw is not null and jsonb_typeof(v_raw) = 'array' then
        select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_sel_sorted
        from jsonb_array_elements_text(v_raw) val
        where val ~ '^\d+$' and val::int >= 0 and val::int < v_opt_len;

        select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_exp_sorted
        from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'correctIndices', '[]'::jsonb)) val
        where val ~ '^\d+$';

        v_is_correct := jsonb_array_length(v_exp_sorted) > 0 and v_sel_sorted = v_exp_sorted;
      end if;
    elsif v_q.question_type = 'fill_blank' then
      v_is_correct := exists (
        select 1
        from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'acceptedAnswers', '[]'::jsonb)) acc
        where lower(trim(acc)) = lower(trim(coalesce(v_raw #>> '{}', '')))
          and trim(coalesce(v_raw #>> '{}', '')) <> ''
      );
    elsif v_q.question_type = 'ordering' then
      if v_raw is not null and jsonb_typeof(v_raw) = 'array' then
        v_is_correct := v_raw = coalesce(v_q.answer_config -> 'correctOrder', '[]'::jsonb);
      end if;
    else
      v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
      if v_raw_text ~ '^\d+$' then
        v_selected := v_raw_text::integer;
        if v_selected >= 0 and (v_opt_len = 0 or v_selected < v_opt_len) then
          v_is_correct := (v_selected = v_q.correct_index);
        end if;
      end if;
    end if;

    if v_is_correct then
      v_score := v_score + greatest(1, coalesce(v_q.marks, 1));
    end if;

    v_results := v_results || jsonb_build_object(
      'questionId', v_q.id,
      'questionType', v_q.question_type,
      'marks', greatest(1, coalesce(v_q.marks, 1)),
      'earnedMarks', case when v_is_correct then greatest(1, coalesce(v_q.marks, 1)) else 0 end,
      'isCorrect', v_is_correct,
      'pendingReview', v_q.question_type in ('short_answer', 'long_form', 'practical_submission'),
      'correctIndex', v_q.correct_index,
      'answerConfig', v_q.answer_config,
      'explanation', v_q.explanation
    );
  end loop;

  if v_total <= 0 then
    raise exception 'Assessment has no configured questions';
  end if;

  v_pct := round((v_score::numeric / v_total::numeric) * 100);

  if v_has_manual or v_quiz.requires_manual_review then
    v_review_status := 'pending_review';
    v_passed := false;
  else
    v_passed := v_pct >= v_quiz.pass_percent;
  end if;

  v_solutions_released := (v_review_status <> 'pending_review')
    and (v_passed or (v_quiz.max_attempts is not null and v_attempt_num >= v_quiz.max_attempts));

  if not v_solutions_released then
    select coalesce(jsonb_agg(
      (elem - 'correctIndex' - 'answerConfig' - 'explanation')
      || jsonb_build_object('correctIndex', null, 'answerConfig', '{}'::jsonb, 'explanation', null)
    ), '[]'::jsonb)
    into v_results
    from jsonb_array_elements(v_results) elem;
  end if;

  insert into public.quiz_attempts (
    user_id, quiz_id, course_id, attempt_number, answers, score, total, percentage, passed, review_status, idempotency_key
  )
  values (
    auth.uid(), p_quiz_id, v_quiz.course_id, v_attempt_num, v_clean_answers, v_score, v_total, v_pct, v_passed, v_review_status, v_idem
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null and v_idem is not null then
    select id into v_attempt_id
    from public.quiz_attempts
    where user_id = auth.uid() and idempotency_key = v_idem;
  end if;

  -- Knowledge assessments advance to practising; demonstrated/verified require practical course/challenge completion
  if v_passed then
    perform public.upgrade_user_skill_level(auth.uid(), v_quiz.skill_id, 'practising');
    if v_quiz.course_id is not null then
      perform public.evaluate_course_and_skill_progression(auth.uid(), v_quiz.course_id);
    end if;
  end if;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'quizId', p_quiz_id,
    'attemptNumber', v_attempt_num,
    'score', v_score,
    'total', v_total,
    'percentage', v_pct,
    'passed', v_passed,
    'reviewStatus', v_review_status,
    'solutionsReleased', v_solutions_released,
    'results', v_results
  );
end;
$$;

revoke all on function public.submit_quiz(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_quiz(uuid, jsonb, text) to authenticated;

create or replace function public.submit_challenge_evidence(
  p_challenge_id uuid,
  p_evidence_url text default null,
  p_repo_url text default null,
  p_file_path text default null,
  p_file_name text default null,
  p_submission_text text default '',
  p_explanation text default '',
  p_idempotency_key text default null
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.challenges;
  v_existing public.submissions;
  v_row public.submissions;
  v_evidence_url text := nullif(trim(coalesce(p_evidence_url, '')), '');
  v_repo_url text := nullif(trim(coalesce(p_repo_url, '')), '');
  v_file_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_file_name text := nullif(trim(coalesce(p_file_name, '')), '');
  v_sub_text text := trim(coalesce(p_submission_text, ''));
  v_explanation text := trim(coalesce(p_explanation, ''));
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_rubric_max integer := 0;
  v_crit jsonb;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id;
  if not found then
    raise exception 'Challenge not found';
  end if;

  if v_idem is not null then
    select * into v_existing
    from public.submissions
    where user_id = auth.uid() and idempotency_key = v_idem;
    if found then
      return v_existing;
    end if;
  end if;

  if v_challenge.course_id is not null then
    if not exists (
      select 1 from public.courses
      where id = v_challenge.course_id and publication_status = 'published'
    ) then
      raise exception 'Course challenge is not currently published';
    end if;

    if v_challenge.phase_id is not null and not exists (
      select 1 from public.phases
      where id = v_challenge.phase_id and publication_status = 'published'
    ) then
      raise exception 'Module challenge is not currently published';
    end if;

    if not exists (
      select 1 from public.course_enrollments
      where user_id = auth.uid()
        and course_id = v_challenge.course_id
        and status in ('active', 'completed')
    ) then
      raise exception 'Active course enrollment required before submitting evidence';
    end if;
  else
    if not exists (
      select 1 from public.skills
      where id = v_challenge.skill_id and publication_status = 'published'
    ) then
      raise exception 'Skill is not currently published';
    end if;
  end if;

  if length(v_explanation) < 20 then
    raise exception 'Submission explanation must be at least 20 characters';
  end if;

  if v_evidence_url is not null and (length(v_evidence_url) > 1000 or v_evidence_url !~* '^https?://') then
    raise exception 'Evidence URL must begin with https:// or http://';
  end if;

  if v_repo_url is not null and (length(v_repo_url) > 1000 or v_repo_url !~* '^https?://') then
    raise exception 'Repository URL must begin with https:// or http://';
  end if;

  if v_file_path is not null then
    if position('..' in v_file_path) > 0
       or split_part(v_file_path, '/', 1) <> auth.uid()::text
       or coalesce(array_length(string_to_array(v_file_path, '/'), 1), 0) < 2 then
      raise exception 'Invalid evidence file ownership path';
    end if;

    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'evidence' and o.name = v_file_path
    ) then
      raise exception 'Uploaded evidence file not found in private storage';
    end if;
  end if;

  if v_evidence_url is null and v_repo_url is null and v_file_path is null and length(v_sub_text) < 20 then
    raise exception 'Provide a valid project URL, repository URL, uploaded file, or written deliverable (20+ chars)';
  end if;

  if jsonb_typeof(v_challenge.rubric) = 'array' and jsonb_array_length(v_challenge.rubric) > 0 then
    for v_crit in select value from jsonb_array_elements(v_challenge.rubric) loop
      v_rubric_max := v_rubric_max + greatest(1, coalesce((v_crit ->> 'maxPoints')::integer, 5));
    end loop;
  end if;
  if v_rubric_max <= 0 then
    v_rubric_max := greatest(1, coalesce(v_challenge.max_score, 20));
  end if;

  insert into public.submissions (
    user_id, challenge_id, course_id, evidence_url, repo_url, file_path, file_name,
    submission_text, explanation, status, rubric_scores, rubric_total, rubric_max,
    feedback, reviewed_by, reviewed_at, idempotency_key
  )
  values (
    auth.uid(),
    p_challenge_id,
    v_challenge.course_id,
    v_evidence_url,
    v_repo_url,
    v_file_path,
    v_file_name,
    v_sub_text,
    v_explanation,
    'pending',
    '{}'::jsonb,
    null,
    v_rubric_max,
    '',
    null,
    null,
    v_idem
  )
  on conflict (user_id, idempotency_key) do nothing
  returning * into v_row;

  if v_row.id is null and v_idem is not null then
    select * into v_row
    from public.submissions
    where user_id = auth.uid() and idempotency_key = v_idem;
  end if;

  if v_challenge.course_id is not null then
    perform public.evaluate_course_and_skill_progression(auth.uid(), v_challenge.course_id);
  end if;

  return v_row;
end;
$$;

revoke all on function public.submit_challenge_evidence(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_challenge_evidence(uuid, text, text, text, text, text, text, text) to authenticated;

create or replace function public.review_submission(
  p_submission_id uuid,
  p_status text,
  p_rubric_scores jsonb,
  p_rubric_total integer,
  p_rubric_max integer,
  p_feedback text
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.submissions;
  v_challenge public.challenges;
  v_crit jsonb;
  v_crit_id text;
  v_crit_max integer;
  v_crit_score integer;
  v_calc_total integer := 0;
  v_calc_max integer := 0;
  v_clean_scores jsonb := '{}'::jsonb;
  v_clean_feedback text := trim(coalesce(p_feedback, ''));
  v_pub_courses integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_status not in ('approved', 'needs_revision') then
    raise exception 'Invalid status';
  end if;

  if length(v_clean_feedback) = 0 then
    raise exception 'Reviewer feedback is required';
  end if;

  select * into v_sub from public.submissions where id = p_submission_id;
  if not found then
    raise exception 'Submission not found';
  end if;

  if v_sub.user_id = auth.uid() then
    raise exception 'Reviewers cannot approve or evaluate their own submissions';
  end if;

  select * into v_challenge from public.challenges where id = v_sub.challenge_id;
  if found and jsonb_typeof(v_challenge.rubric) = 'array' and jsonb_array_length(v_challenge.rubric) > 0 then
    for v_crit in select value from jsonb_array_elements(v_challenge.rubric) loop
      v_crit_id := v_crit ->> 'id';
      v_crit_max := greatest(1, coalesce((v_crit ->> 'maxPoints')::integer, 5));
      if coalesce(p_rubric_scores ->> v_crit_id, '') ~ '^-?\d+$' then
        v_crit_score := (p_rubric_scores ->> v_crit_id)::integer;
      else
        v_crit_score := 0;
      end if;
      if v_crit_score < 0 or v_crit_score > v_crit_max then
        raise exception 'Rubric score for % must be between 0 and %', v_crit_id, v_crit_max;
      end if;
      v_calc_total := v_calc_total + v_crit_score;
      v_calc_max := v_calc_max + v_crit_max;
      v_clean_scores := v_clean_scores || jsonb_build_object(v_crit_id, v_crit_score);
    end loop;
  else
    v_calc_total := greatest(0, coalesce(p_rubric_total, 0));
    v_calc_max := greatest(1, coalesce(p_rubric_max, v_challenge.max_score, 20));
    if v_calc_total > v_calc_max then
      raise exception 'Rubric total cannot exceed maximum score';
    end if;
    v_clean_scores := coalesce(p_rubric_scores, '{}'::jsonb);
  end if;

  if p_status = 'approved' and v_calc_total < coalesce(v_challenge.passing_score, 0) then
    raise exception 'Approved submissions must meet or exceed the passing score (%)', coalesce(v_challenge.passing_score, 0);
  end if;

  update public.submissions
  set status = p_status,
      rubric_scores = v_clean_scores,
      rubric_total = v_calc_total,
      rubric_max = v_calc_max,
      feedback = v_clean_feedback,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_submission_id
  returning * into v_sub;

  if v_sub.status = 'approved' then
    if v_challenge.course_id is not null then
      perform public.evaluate_course_and_skill_progression(v_sub.user_id, v_challenge.course_id);
    elsif v_challenge.skill_id is not null then
      select count(distinct c.id) into v_pub_courses
      from public.courses c
      left join public.course_skills cs on cs.course_id = c.id
      where c.publication_status = 'published'
        and (c.skill_id = v_challenge.skill_id or cs.skill_id = v_challenge.skill_id);

      if v_pub_courses = 0 then
        perform public.upgrade_user_skill_level(v_sub.user_id, v_challenge.skill_id, 'verified');
      else
        perform public.upgrade_user_skill_level(v_sub.user_id, v_challenge.skill_id, 'demonstrated');
      end if;
    end if;
  elsif v_challenge.course_id is not null then
    perform public.evaluate_course_and_skill_progression(v_sub.user_id, v_challenge.course_id);
  end if;

  return v_sub;
end;
$$;

revoke all on function public.review_submission(uuid, text, jsonb, integer, integer, text) from public, anon;
grant execute on function public.review_submission(uuid, text, jsonb, integer, integer, text) to authenticated;

create or replace function public.admin_grade_attempt(
  p_attempt_id uuid,
  p_manual_scores jsonb,
  p_feedback text
)
returns public.quiz_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_att public.quiz_attempts;
  v_quiz public.quizzes;
  v_q record;
  v_raw jsonb;
  v_raw_text text;
  v_selected integer;
  v_opt_len integer;
  v_is_correct boolean;
  v_sel_sorted jsonb;
  v_exp_sorted jsonb;
  v_total integer := 0;
  v_score integer := 0;
  v_pct integer := 0;
  v_passed boolean := false;
  v_manual_val integer := 0;
  v_clean_manual jsonb := '{}'::jsonb;
  v_clean_feedback text := trim(coalesce(p_feedback, ''));
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_manual_scores is null or jsonb_typeof(p_manual_scores) <> 'object' then
    raise exception 'Manual scores payload must be a JSON object';
  end if;

  if length(v_clean_feedback) = 0 then
    raise exception 'Grading feedback is required';
  end if;

  select * into v_att from public.quiz_attempts where id = p_attempt_id;
  if not found then
    raise exception 'Quiz attempt not found';
  end if;

  if v_att.user_id = auth.uid() then
    raise exception 'Administrators cannot grade their own quiz attempts';
  end if;

  select * into v_quiz from public.quizzes where id = v_att.quiz_id;
  if not found then
    raise exception 'Assessment not found';
  end if;

  for v_q in
    select id, position, question_type, marks, options, correct_index, answer_config
    from public.questions
    where quiz_id = v_att.quiz_id
    order by position asc
  loop
    v_total := v_total + greatest(1, coalesce(v_q.marks, 1));
    v_raw := v_att.answers -> (v_q.id::text);
    v_opt_len := coalesce(jsonb_array_length(v_q.options), 0);

    if v_q.question_type in ('short_answer', 'long_form', 'practical_submission') then
      if coalesce(p_manual_scores ->> (v_q.id::text), '') ~ '^-?\d+$' then
        v_manual_val := (p_manual_scores ->> (v_q.id::text))::integer;
      else
        v_manual_val := 0;
      end if;
      if v_manual_val < 0 or v_manual_val > greatest(1, coalesce(v_q.marks, 1)) then
        raise exception 'Manual score for question % must be between 0 and %', v_q.id, greatest(1, coalesce(v_q.marks, 1));
      end if;
      v_score := v_score + v_manual_val;
      v_clean_manual := v_clean_manual || jsonb_build_object(v_q.id::text, v_manual_val);
    else
      v_is_correct := false;
      if v_q.question_type = 'multiple_select' then
        if v_raw is not null and jsonb_typeof(v_raw) = 'array' then
          select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_sel_sorted
          from jsonb_array_elements_text(v_raw) val
          where val ~ '^\d+$' and val::int >= 0 and val::int < v_opt_len;

          select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_exp_sorted
          from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'correctIndices', '[]'::jsonb)) val
          where val ~ '^\d+$';

          v_is_correct := jsonb_array_length(v_exp_sorted) > 0 and v_sel_sorted = v_exp_sorted;
        end if;
      elsif v_q.question_type = 'fill_blank' then
        v_is_correct := exists (
          select 1
          from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'acceptedAnswers', '[]'::jsonb)) acc
          where lower(trim(acc)) = lower(trim(coalesce(v_raw #>> '{}', '')))
            and trim(coalesce(v_raw #>> '{}', '')) <> ''
        );
      elsif v_q.question_type = 'ordering' then
        if v_raw is not null and jsonb_typeof(v_raw) = 'array' then
          v_is_correct := v_raw = coalesce(v_q.answer_config -> 'correctOrder', '[]'::jsonb);
        end if;
      else
        v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
        if v_raw_text ~ '^\d+$' then
          v_selected := v_raw_text::integer;
          if v_selected >= 0 and (v_opt_len = 0 or v_selected < v_opt_len) then
            v_is_correct := (v_selected = v_q.correct_index);
          end if;
        end if;
      end if;

      if v_is_correct then
        v_score := v_score + greatest(1, coalesce(v_q.marks, 1));
      end if;
    end if;
  end loop;

  if v_total > 0 then
    v_pct := round((v_score::numeric / v_total::numeric) * 100);
  end if;
  v_passed := v_pct >= v_quiz.pass_percent;

  update public.quiz_attempts
  set score = v_score,
      total = v_total,
      percentage = v_pct,
      passed = v_passed,
      review_status = 'reviewed',
      manual_scores = v_clean_manual,
      manual_feedback = v_clean_feedback,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_attempt_id
  returning * into v_att;

  if v_passed then
    perform public.upgrade_user_skill_level(v_att.user_id, v_quiz.skill_id, 'practising');
    if v_quiz.course_id is not null then
      perform public.evaluate_course_and_skill_progression(v_att.user_id, v_quiz.course_id);
    end if;
  end if;

  return v_att;
end;
$$;

revoke all on function public.admin_grade_attempt(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_grade_attempt(uuid, jsonb, text) to authenticated;

create or replace function public.admin_get_quiz_questions(p_quiz_id uuid)
returns setof public.questions
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  return query select * from public.questions where quiz_id = p_quiz_id order by position asc;
end;
$$;

revoke all on function public.admin_get_quiz_questions(uuid) from public, anon;
grant execute on function public.admin_get_quiz_questions(uuid) to authenticated;

create or replace function public.admin_upsert_question(
  p_id uuid,
  p_quiz_id uuid,
  p_position integer,
  p_prompt text,
  p_options jsonb,
  p_correct_index integer,
  p_explanation text,
  p_question_type text default 'multiple_choice',
  p_difficulty text default 'medium',
  p_marks integer default 1,
  p_context_text text default '',
  p_answer_config jsonb default '{}'::jsonb
)
returns public.questions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.questions;
  v_qtype text := coalesce(p_question_type, 'multiple_choice');
  v_diff text := coalesce(p_difficulty, 'medium');
  v_marks integer := coalesce(p_marks, 1);
  v_opts jsonb := coalesce(p_options, '[]'::jsonb);
  v_cfg jsonb := coalesce(p_answer_config, '{}'::jsonb);
  v_opt_len integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if not exists (select 1 from public.quizzes where id = p_quiz_id) then
    raise exception 'Target quiz does not exist';
  end if;

  if v_qtype not in (
    'multiple_choice', 'multiple_select', 'true_false', 'fill_blank',
    'short_answer', 'scenario', 'case_study', 'ordering',
    'practical_submission', 'long_form'
  ) then
    raise exception 'Invalid question type: %', v_qtype;
  end if;

  if v_diff not in ('easy', 'medium', 'hard') then
    raise exception 'Invalid difficulty: %', v_diff;
  end if;

  if v_marks < 1 or v_marks > 100 then
    raise exception 'Question marks must be between 1 and 100';
  end if;

  if length(trim(coalesce(p_prompt, ''))) < 3 then
    raise exception 'Question prompt must be at least 3 characters';
  end if;

  if jsonb_typeof(v_opts) <> 'array' then
    raise exception 'Question options must be a JSON array';
  end if;
  v_opt_len := jsonb_array_length(v_opts);

  if v_qtype in ('multiple_choice', 'true_false', 'scenario', 'case_study') then
    if v_opt_len < 2 then
      raise exception 'Choice questions require at least 2 options';
    end if;
    if coalesce(p_correct_index, 0) < 0 or coalesce(p_correct_index, 0) >= v_opt_len then
      raise exception 'correct_index out of bounds for configured options';
    end if;
  elsif v_qtype = 'multiple_select' then
    if v_opt_len < 2 or jsonb_typeof(v_cfg -> 'correctIndices') <> 'array' or jsonb_array_length(v_cfg -> 'correctIndices') = 0 then
      raise exception 'Multiple-select questions require at least 2 options and non-empty correctIndices';
    end if;
  elsif v_qtype = 'fill_blank' then
    if jsonb_typeof(v_cfg -> 'acceptedAnswers') <> 'array' or jsonb_array_length(v_cfg -> 'acceptedAnswers') = 0 then
      raise exception 'Fill-blank questions require non-empty acceptedAnswers';
    end if;
  elsif v_qtype = 'ordering' then
    if jsonb_typeof(v_cfg -> 'correctOrder') <> 'array' or jsonb_array_length(v_cfg -> 'correctOrder') < 2 then
      raise exception 'Ordering questions require at least 2 items in correctOrder';
    end if;
  end if;

  if p_id is not null then
    update public.questions
    set position = coalesce(p_position, position),
        question_type = v_qtype,
        difficulty = v_diff,
        marks = v_marks,
        prompt = trim(p_prompt),
        context_text = coalesce(p_context_text, ''),
        options = v_opts,
        correct_index = greatest(0, coalesce(p_correct_index, 0)),
        answer_config = v_cfg,
        explanation = coalesce(p_explanation, '')
    where id = p_id and quiz_id = p_quiz_id
    returning * into v_row;

    if not found then
      raise exception 'Question not found for quiz %', p_quiz_id;
    end if;
    return v_row;
  end if;

  insert into public.questions (
    quiz_id, position, question_type, difficulty, marks, prompt, context_text, options, correct_index, answer_config, explanation
  )
  values (
    p_quiz_id,
    coalesce(p_position, 1),
    v_qtype,
    v_diff,
    v_marks,
    trim(p_prompt),
    coalesce(p_context_text, ''),
    v_opts,
    greatest(0, coalesce(p_correct_index, 0)),
    v_cfg,
    coalesce(p_explanation, '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.admin_upsert_question(uuid, uuid, integer, text, jsonb, integer, text, text, text, integer, text, jsonb) from public, anon;
grant execute on function public.admin_upsert_question(uuid, uuid, integer, text, jsonb, integer, text, text, text, integer, text, jsonb) to authenticated;

create or replace function public.admin_reorder_phases(
  p_course_id uuid,
  p_phase_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx integer := 1;
  v_pid uuid;
  v_expected_count integer;
  v_distinct_count integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_phase_ids is null or coalesce(array_length(p_phase_ids, 1), 0) = 0 then
    raise exception 'Phase order array cannot be empty';
  end if;

  select count(*) into v_expected_count
  from public.phases
  where course_id = p_course_id;

  select count(distinct x) into v_distinct_count
  from unnest(p_phase_ids) as x;

  if v_distinct_count <> array_length(p_phase_ids, 1) then
    raise exception 'Duplicate phase IDs supplied';
  end if;

  if v_distinct_count <> v_expected_count or exists (
    select 1 from unnest(p_phase_ids) as x
    where not exists (
      select 1 from public.phases p where p.id = x and p.course_id = p_course_id
    )
  ) then
    raise exception 'Phase list must match all phases belonging to course %', p_course_id;
  end if;

  -- Two-pass update prevents temporary unique constraint collisions
  update public.phases
  set position = -position - 1000
  where course_id = p_course_id;

  foreach v_pid in array p_phase_ids loop
    update public.phases
    set position = v_idx
    where id = v_pid and course_id = p_course_id;
    v_idx := v_idx + 1;
  end loop;

  update public.courses set updated_at = now() where id = p_course_id;
end;
$$;

revoke all on function public.admin_reorder_phases(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_phases(uuid, uuid[]) to authenticated;

create or replace function public.admin_reorder_lessons(
  p_phase_id uuid,
  p_lesson_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx integer := 1;
  v_lid uuid;
  v_expected_count integer;
  v_distinct_count integer;
  v_course_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_lesson_ids is null or coalesce(array_length(p_lesson_ids, 1), 0) = 0 then
    raise exception 'Lesson order array cannot be empty';
  end if;

  select course_id into v_course_id from public.phases where id = p_phase_id;
  if not found then
    raise exception 'Phase not found';
  end if;

  select count(*) into v_expected_count
  from public.lessons
  where phase_id = p_phase_id;

  select count(distinct x) into v_distinct_count
  from unnest(p_lesson_ids) as x;

  if v_distinct_count <> array_length(p_lesson_ids, 1) then
    raise exception 'Duplicate lesson IDs supplied';
  end if;

  if v_distinct_count <> v_expected_count or exists (
    select 1 from unnest(p_lesson_ids) as x
    where not exists (
      select 1 from public.lessons l where l.id = x and l.phase_id = p_phase_id
    )
  ) then
    raise exception 'Lesson list must match all lessons belonging to phase %', p_phase_id;
  end if;

  update public.lessons
  set position = -position - 1000
  where phase_id = p_phase_id;

  foreach v_lid in array p_lesson_ids loop
    update public.lessons
    set position = v_idx
    where id = v_lid and phase_id = p_phase_id;
    v_idx := v_idx + 1;
  end loop;

  if v_course_id is not null then
    update public.courses set updated_at = now() where id = v_course_id;
  end if;
end;
$$;

revoke all on function public.admin_reorder_lessons(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_lessons(uuid, uuid[]) to authenticated;

create or replace function public.admin_create_course_version(
  p_course_id uuid,
  p_change_notes text default ''
)
returns public.course_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_next_ver integer;
  v_phase_cnt integer := 0;
  v_lesson_cnt integer := 0;
  v_quiz_cnt integer := 0;
  v_challenge_cnt integer := 0;
  v_notes text := trim(coalesce(p_change_notes, ''));
  v_ver_row public.course_versions;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if length(v_notes) > 2000 then
    raise exception 'Change notes cannot exceed 2,000 characters';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Course not found';
  end if;

  v_next_ver := coalesce(v_course.version, 1) + 1;
  select count(*) into v_phase_cnt from public.phases where course_id = p_course_id;
  select count(*) into v_lesson_cnt
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  where p.course_id = p_course_id;
  select count(*) into v_quiz_cnt from public.quizzes where course_id = p_course_id;
  select count(*) into v_challenge_cnt from public.challenges where course_id = p_course_id;

  update public.courses
  set version = v_next_ver, updated_at = now()
  where id = p_course_id;

  insert into public.course_versions (course_id, version_number, change_notes, snapshot, created_by)
  values (
    p_course_id,
    v_next_ver,
    v_notes,
    jsonb_build_object(
      'title', v_course.title,
      'publicationStatus', v_course.publication_status,
      'difficulty', v_course.difficulty,
      'phaseCount', v_phase_cnt,
      'lessonCount', v_lesson_cnt,
      'quizCount', v_quiz_cnt,
      'challengeCount', v_challenge_cnt
    ),
    auth.uid()
  )
  on conflict (course_id, version_number) do update set change_notes = excluded.change_notes
  returning * into v_ver_row;

  return v_ver_row;
end;
$$;

revoke all on function public.admin_create_course_version(uuid, text) from public, anon;
grant execute on function public.admin_create_course_version(uuid, text) to authenticated;
