-- 03_functions.sql (Synchronized with migrations 000005-000006, 20261122000010, and 20261123000011)

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

-- INTERNAL ONLY: recomputes current level cleanly (supports both upward and downward recalculation)
create or replace function public.recompute_user_skill_level(
  p_user_id uuid,
  p_skill_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pub_courses integer := 0;
  v_verified_courses integer := 0;
  v_any_practical_course boolean := false;
  v_any_standalone_approved boolean := false;
  v_any_practising boolean := false;
  v_any_declared boolean := false;
  v_target_level text := null;
begin
  if p_user_id is null or p_skill_id is null then
    return;
  end if;

  if not exists (select 1 from public.skills where id = p_skill_id) then
    return;
  end if;

  select count(distinct c.id) into v_pub_courses
  from public.courses c
  left join public.course_skills cs on cs.course_id = c.id
  where c.publication_status = 'published'
    and (c.skill_id = p_skill_id or cs.skill_id = p_skill_id);

  select count(distinct c.id) into v_verified_courses
  from public.courses c
  left join public.course_skills cs on cs.course_id = c.id
  join public.course_completions cc on cc.course_id = c.id and cc.user_id = p_user_id
  where c.publication_status = 'published'
    and (c.skill_id = p_skill_id or cs.skill_id = p_skill_id)
    and cc.completion_state = 'completed_verified'
    and cc.practical_approved = true;

  select exists (
    select 1
    from public.courses c
    left join public.course_skills cs on cs.course_id = c.id
    join public.course_completions cc on cc.course_id = c.id and cc.user_id = p_user_id
    where c.publication_status = 'published'
      and (c.skill_id = p_skill_id or cs.skill_id = p_skill_id)
      and cc.practical_approved = true
  ) into v_any_practical_course;

  select exists (
    select 1
    from public.submissions s
    join public.challenges ch on ch.id = s.challenge_id
    where s.user_id = p_user_id
      and s.status = 'approved'
      and ch.skill_id = p_skill_id
      and ch.course_id is null
  ) into v_any_standalone_approved;

  select (
    exists (
      select 1
      from public.lesson_progress lp
      join public.lessons l on l.id = lp.lesson_id
      join public.phases p on p.id = l.phase_id
      join public.courses c on c.id = p.course_id
      left join public.course_skills cs on cs.course_id = c.id
      where lp.user_id = p_user_id
        and lp.completed = true
        and l.publication_status = 'published'
        and p.publication_status = 'published'
        and c.publication_status = 'published'
        and (c.skill_id = p_skill_id or cs.skill_id = p_skill_id)
    )
    or exists (
      select 1
      from public.activity_progress ap
      join public.activities a on a.id = ap.activity_id
      join public.phases p on p.id = a.phase_id
      join public.courses c on c.id = p.course_id
      left join public.course_skills cs on cs.course_id = c.id
      where ap.user_id = p_user_id
        and ap.completed = true
        and p.publication_status = 'published'
        and c.publication_status = 'published'
        and (c.skill_id = p_skill_id or cs.skill_id = p_skill_id)
    )
    or exists (
      select 1
      from public.quiz_attempts qa
      join public.quizzes q on q.id = qa.quiz_id
      where qa.user_id = p_user_id
        and q.skill_id = p_skill_id
        and qa.passed = true
        and qa.review_status in ('auto_graded', 'reviewed', 'graded')
    )
  ) into v_any_practising;

  select (
    exists (select 1 from public.user_skills us where us.user_id = p_user_id and us.skill_id = p_skill_id)
    or exists (select 1 from public.enrollments e where e.user_id = p_user_id and e.skill_id = p_skill_id)
    or exists (
      select 1
      from public.course_enrollments ce
      join public.courses c on c.id = ce.course_id
      left join public.course_skills cs on cs.course_id = c.id
      where ce.user_id = p_user_id
        and (c.skill_id = p_skill_id or cs.skill_id = p_skill_id)
    )
  ) into v_any_declared;

  if (v_pub_courses > 0 and v_verified_courses >= v_pub_courses)
     or (v_pub_courses = 0 and v_any_standalone_approved) then
    v_target_level := 'verified';
  elsif v_any_practical_course or v_any_standalone_approved then
    v_target_level := 'demonstrated';
  elsif v_any_practising then
    v_target_level := 'practising';
  elsif v_any_declared then
    v_target_level := 'declared';
  end if;

  if v_target_level is not null then
    insert into public.user_skills (user_id, skill_id, level, updated_at)
    values (p_user_id, p_skill_id, v_target_level, now())
    on conflict (user_id, skill_id) do update
      set level = excluded.level,
          updated_at = now()
      where public.user_skills.level is distinct from excluded.level;
  end if;
end;
$$;

revoke all on function public.recompute_user_skill_level(uuid, uuid) from public, anon, authenticated;

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
  v_practical_approved boolean := false;
  v_instructional_done boolean := false;
  v_require_approval boolean := true;
  v_completion_state text := 'in_progress';
  v_course_done boolean := false;
  v_has_content boolean := false;
  v_skill_rec record;
begin
  select skill_id, coalesce(completion_rules, '{}'::jsonb), publication_status
  into v_primary_skill_id, v_rules, v_course_pub
  from public.courses
  where id = p_course_id;

  if v_primary_skill_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.course_enrollments
    where user_id = p_user_id and course_id = p_course_id
  ) then
    return;
  end if;

  if v_course_pub = 'published' then
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
    v_practical_approved := v_req_challenges > 0 and v_approved_challenges >= v_req_challenges;
    v_instructional_done := v_has_content and v_lessons_ok and v_activities_ok and v_quizzes_ok;

    if v_instructional_done then
      if v_req_challenges > 0 and v_require_approval then
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
    perform public.recompute_user_skill_level(p_user_id, v_skill_rec.skill_id);
  end loop;
end;
$$;

revoke all on function public.evaluate_course_and_skill_progression(uuid, uuid) from public, anon, authenticated;

create or replace function public.recompute_course_progression_for_course(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enr record;
begin
  if p_course_id is null then
    return;
  end if;
  for v_enr in
    select user_id from public.course_enrollments where course_id = p_course_id
  loop
    perform public.evaluate_course_and_skill_progression(v_enr.user_id, p_course_id);
  end loop;
end;
$$;

revoke all on function public.recompute_course_progression_for_course(uuid) from public, anon, authenticated;

create or replace function public.trg_recompute_on_curriculum_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_phase_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_table_name = 'courses' then
    if tg_op = 'UPDATE' then
      if old.publication_status is not distinct from new.publication_status
         and old.completion_rules is not distinct from new.completion_rules
         and old.skill_id is not distinct from new.skill_id then
        return null;
      end if;
    end if;
    v_course_id := coalesce(new.id, old.id);
  elsif tg_table_name in ('phases', 'quizzes', 'challenges', 'course_skills') then
    v_course_id := coalesce(new.course_id, old.course_id);
  elsif tg_table_name in ('lessons', 'activities') then
    v_phase_id := coalesce(new.phase_id, old.phase_id);
    if v_phase_id is not null then
      select course_id into v_course_id from public.phases where id = v_phase_id;
    end if;
  end if;

  if v_course_id is not null and exists (
    select 1 from public.course_enrollments where course_id = v_course_id
  ) then
    perform public.recompute_course_progression_for_course(v_course_id);
  end if;

  return null;
end;
$$;

revoke all on function public.trg_recompute_on_curriculum_change() from public, anon, authenticated;

drop trigger if exists trg_recompute_courses on public.courses;
create trigger trg_recompute_courses
  after update on public.courses
  for each row execute function public.trg_recompute_on_curriculum_change();

drop trigger if exists trg_recompute_phases on public.phases;
create trigger trg_recompute_phases
  after insert or update or delete on public.phases
  for each row execute function public.trg_recompute_on_curriculum_change();

drop trigger if exists trg_recompute_lessons on public.lessons;
create trigger trg_recompute_lessons
  after insert or update or delete on public.lessons
  for each row execute function public.trg_recompute_on_curriculum_change();

drop trigger if exists trg_recompute_activities on public.activities;
create trigger trg_recompute_activities
  after insert or update or delete on public.activities
  for each row execute function public.trg_recompute_on_curriculum_change();

drop trigger if exists trg_recompute_quizzes on public.quizzes;
create trigger trg_recompute_quizzes
  after insert or update or delete on public.quizzes
  for each row execute function public.trg_recompute_on_curriculum_change();

drop trigger if exists trg_recompute_challenges on public.challenges;
create trigger trg_recompute_challenges
  after insert or update or delete on public.challenges
  for each row execute function public.trg_recompute_on_curriculum_change();

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
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
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
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
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
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
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
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
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
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
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
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
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

-- Server-side course publish readiness validation trigger
create or replace function public.trg_validate_course_publish_readiness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_phase boolean := false;
  v_has_lesson boolean := false;
  v_empty_lesson text;
  v_require_quiz boolean := false;
  v_require_challenge boolean := false;
  v_has_quiz boolean := false;
  v_has_challenge boolean := false;
begin
  if new.publication_status <> 'published' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.courses c
      where c.id = new.id or c.slug = new.slug
    ) then
      raise exception 'New courses must be saved as draft with published modules and lessons before publishing';
    end if;
    return new;
  end if;

  if length(trim(coalesce(new.title, ''))) < 3 then
    raise exception 'Course title must be at least 3 characters before publishing';
  end if;

  if length(trim(coalesce(new.description, ''))) < 15 then
    raise exception 'Course description must be at least 15 characters before publishing';
  end if;

  if new.skill_id is null then
    raise exception 'Course must have a primary skill before publishing';
  end if;

  if jsonb_typeof(coalesce(new.outcomes, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.outcomes, '[]'::jsonb)) < 1 then
    raise exception 'Course must have at least 1 learning objective before publishing';
  end if;

  select exists (
    select 1 from public.phases p
    where p.course_id = new.id
      and p.publication_status = 'published'
  ) into v_has_phase;

  if not v_has_phase then
    raise exception 'Course must contain at least 1 published module before publishing';
  end if;

  select exists (
    select 1
    from public.lessons l
    join public.phases p on p.id = l.phase_id
    where p.course_id = new.id
      and p.publication_status = 'published'
      and l.publication_status = 'published'
  ) into v_has_lesson;

  if not v_has_lesson then
    raise exception 'Course must contain at least 1 published lesson before publishing';
  end if;

  select l.title into v_empty_lesson
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  where p.course_id = new.id
    and p.publication_status = 'published'
    and l.publication_status = 'published'
    and (
      length(trim(coalesce(l.title, ''))) = 0
      or jsonb_typeof(coalesce(l.blocks, '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(l.blocks, '[]'::jsonb)) < 1
    )
  limit 1;

  if v_empty_lesson is not null then
    raise exception 'Published lesson "%" must contain structured content blocks before publishing course', v_empty_lesson;
  end if;

  v_require_quiz := coalesce((new.completion_rules ->> 'requireAllAssessments')::boolean, false);
  if v_require_quiz then
    select exists (
      select 1
      from public.quizzes q
      where q.course_id = new.id
        and exists (select 1 from public.questions qs where qs.quiz_id = q.id)
    ) into v_has_quiz;
    if not v_has_quiz then
      raise exception 'Course requires at least 1 configured assessment with questions before publishing';
    end if;
  end if;

  v_require_challenge := coalesce((new.completion_rules ->> 'requireChallengeSubmission')::boolean, false)
    or coalesce((new.completion_rules ->> 'requireChallengeApproval')::boolean, false);
  if v_require_challenge then
    select exists (
      select 1
      from public.challenges ch
      where ch.course_id = new.id
        and jsonb_typeof(coalesce(ch.rubric, '[]'::jsonb)) = 'array'
        and jsonb_array_length(coalesce(ch.rubric, '[]'::jsonb)) >= 1
    ) into v_has_challenge;
    if not v_has_challenge then
      raise exception 'Course requires a practical challenge with a valid rubric before publishing';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_validate_course_publish_readiness() from public, anon, authenticated;

drop trigger if exists trg_validate_course_publish_readiness on public.courses;
create trigger trg_validate_course_publish_readiness
  before insert or update on public.courses
  for each row execute function public.trg_validate_course_publish_readiness();

create or replace function public.start_quiz_session(
  p_quiz_id uuid,
  p_restart_expired boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_quiz public.quizzes;
  v_session public.quiz_sessions;
  v_attempts_used integer := 0;
  v_now timestamptz := now();
  v_expires timestamptz := null;
begin
  if auth.uid() is null then
    raise exception 'Learner authentication required';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.account_status <> 'active' then
    raise exception 'Account is suspended or inactive';
  end if;
  if v_profile.role = 'admin' then
    raise exception 'Learner authentication required';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Assessment not found';
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
      raise exception 'Active course enrollment required to start this assessment';
    end if;
  else
    if not exists (
      select 1 from public.skills
      where id = v_quiz.skill_id and publication_status = 'published'
    ) then
      raise exception 'Assessment skill is not currently published';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('quiz_session:' || auth.uid()::text || ':' || p_quiz_id::text));

  select count(*) into v_attempts_used
  from public.quiz_attempts
  where user_id = auth.uid() and quiz_id = p_quiz_id;

  if v_quiz.max_attempts is not null and v_attempts_used >= v_quiz.max_attempts then
    raise exception 'Maximum number of attempts reached for this assessment';
  end if;

  select * into v_session
  from public.quiz_sessions
  where user_id = auth.uid()
    and quiz_id = p_quiz_id
    and status = 'active'
    and completed_attempt_id is null
  order by started_at desc
  limit 1;

  if found then
    if v_session.expires_at is null or v_session.expires_at >= v_now then
      return jsonb_build_object(
        'sessionId', v_session.id,
        'quizId', v_session.quiz_id,
        'startedAt', v_session.started_at,
        'expiresAt', v_session.expires_at,
        'serverNow', v_now,
        'expired', false
      );
    elsif not coalesce(p_restart_expired, false) then
      return jsonb_build_object(
        'sessionId', v_session.id,
        'quizId', v_session.quiz_id,
        'startedAt', v_session.started_at,
        'expiresAt', v_session.expires_at,
        'serverNow', v_now,
        'expired', true
      );
    else
      update public.quiz_sessions
      set status = 'expired'
      where id = v_session.id;
    end if;
  end if;

  if v_quiz.time_limit_minutes is not null and v_quiz.time_limit_minutes > 0 then
    v_expires := v_now + make_interval(mins => v_quiz.time_limit_minutes);
  end if;

  insert into public.quiz_sessions (user_id, quiz_id, status, started_at, expires_at)
  values (auth.uid(), p_quiz_id, 'active', v_now, v_expires)
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'quizId', v_session.quiz_id,
    'startedAt', v_session.started_at,
    'expiresAt', v_session.expires_at,
    'serverNow', v_now,
    'expired', false
  );
end;
$$;

revoke all on function public.start_quiz_session(uuid, boolean) from public, anon;
grant execute on function public.start_quiz_session(uuid, boolean) to authenticated;

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
  v_profile public.profiles;
  v_quiz public.quizzes;
  v_session public.quiz_sessions;
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
  v_exp_order jsonb;
  v_clean_answers jsonb := '{}'::jsonb;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_replay boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Learner authentication required';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.account_status <> 'active' then
    raise exception 'Account is suspended or inactive';
  end if;
  if v_profile.role = 'admin' then
    raise exception 'Learner authentication required';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers payload must be a JSON object';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Assessment not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('submit_quiz:' || auth.uid()::text || ':' || p_quiz_id::text));

  if v_idem is not null then
    select * into v_existing
    from public.quiz_attempts
    where user_id = auth.uid() and idempotency_key = v_idem;
    if found then
      if v_existing.quiz_id <> p_quiz_id then
        raise exception 'Idempotency key already used for a different assessment';
      end if;
      v_replay := true;
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

  if not v_replay then
    select count(*) + 1 into v_attempt_num
    from public.quiz_attempts
    where user_id = auth.uid() and quiz_id = p_quiz_id;

    if v_quiz.max_attempts is not null and (v_attempt_num - 1) >= v_quiz.max_attempts then
      raise exception 'Maximum number of attempts reached for this assessment';
    end if;

    if v_quiz.time_limit_minutes is not null and v_quiz.time_limit_minutes > 0 then
      select * into v_session
      from public.quiz_sessions
      where user_id = auth.uid()
        and quiz_id = p_quiz_id
        and status = 'active'
        and completed_attempt_id is null
      order by started_at desc
      limit 1;

      if not found then
        raise exception 'Active assessment session required before submitting a timed assessment';
      end if;

      if v_session.expires_at is not null and now() > (v_session.expires_at + interval '30 seconds') then
        raise exception 'Assessment time limit exceeded for this session';
      end if;
    end if;
  end if;

  for v_q in
    select id, position, question_type, marks, prompt, options, correct_index, answer_config, explanation
    from public.questions
    where quiz_id = p_quiz_id
    order by position asc
  loop
    v_total := v_total + greatest(1, coalesce(v_q.marks, 1));
    if v_replay then
      v_raw := v_existing.answers -> (v_q.id::text);
    else
      v_raw := p_answers -> (v_q.id::text);
    end if;
    v_is_correct := false;
    v_opt_len := coalesce(jsonb_array_length(v_q.options), 0);

    if v_raw is not null then
      v_clean_answers := v_clean_answers || jsonb_build_object(v_q.id::text, v_raw);
    end if;

    if v_q.question_type in ('short_answer', 'long_form', 'practical_submission') then
      v_has_manual := true;
    elsif v_q.question_type = 'multiple_select' then
      if v_raw is not null and jsonb_typeof(v_raw) = 'array' then
        if not exists (
          select 1 from jsonb_array_elements_text(v_raw) val
          where val !~ '^\d+$' or val::int < 0 or val::int >= v_opt_len
        ) then
          select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_sel_sorted
          from jsonb_array_elements_text(v_raw) val;

          select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_exp_sorted
          from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'correctIndices', '[]'::jsonb)) val
          where val ~ '^\d+$';

          v_is_correct := jsonb_array_length(v_exp_sorted) > 0 and v_sel_sorted = v_exp_sorted;
        end if;
      end if;
    elsif v_q.question_type = 'fill_blank' then
      v_is_correct := exists (
        select 1
        from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'acceptedAnswers', '[]'::jsonb)) acc
        where lower(regexp_replace(trim(acc), '\s+', ' ', 'g')) =
              lower(regexp_replace(trim(coalesce(v_raw #>> '{}', '')), '\s+', ' ', 'g'))
          and trim(coalesce(v_raw #>> '{}', '')) <> ''
      );
    elsif v_q.question_type = 'ordering' then
      v_exp_order := coalesce(v_q.answer_config -> 'correctOrder', '[]'::jsonb);
      if v_raw is not null
         and jsonb_typeof(v_raw) = 'array'
         and jsonb_array_length(v_raw) = jsonb_array_length(v_exp_order)
         and jsonb_array_length(v_exp_order) >= 2 then
        v_is_correct := not exists (
          select 1
          from generate_series(0, jsonb_array_length(v_exp_order) - 1) idx
          where (v_raw ->> idx) !~ '^\d+$'
             or (v_exp_order ->> idx) !~ '^\d+$'
             or (v_raw ->> idx)::int <> (v_exp_order ->> idx)::int
        );
      end if;
    elsif v_q.question_type = 'true_false' then
      v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
      if v_raw_text ~ '^\d+$' then
        v_selected := v_raw_text::integer;
        if v_selected >= 0 and v_selected < coalesce(nullif(v_opt_len, 0), 2) then
          v_is_correct := (v_selected = v_q.correct_index);
        end if;
      end if;
    else
      v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
      if v_raw_text ~ '^\d+$' then
        v_selected := v_raw_text::integer;
        if v_selected >= 0 and v_selected < v_opt_len then
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

  if v_replay then
    v_solutions_released := (v_existing.review_status <> 'pending_review')
      and (v_existing.passed or (v_quiz.max_attempts is not null and v_existing.attempt_number >= v_quiz.max_attempts));
    if not v_solutions_released then
      select coalesce(jsonb_agg(
        (elem - 'correctIndex' - 'answerConfig' - 'explanation')
        || jsonb_build_object('correctIndex', null, 'answerConfig', '{}'::jsonb, 'explanation', null)
      ), '[]'::jsonb)
      into v_results
      from jsonb_array_elements(v_results) elem;
    end if;
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
      'results', v_results
    );
  end if;

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

  if v_session.id is not null and v_attempt_id is not null then
    update public.quiz_sessions
    set status = 'completed',
        completed_attempt_id = v_attempt_id
    where id = v_session.id;
  end if;

  if v_passed then
    perform public.recompute_user_skill_level(auth.uid(), v_quiz.skill_id);
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
  v_obj record;
  v_evidence_url text := nullif(trim(coalesce(p_evidence_url, '')), '');
  v_repo_url text := nullif(trim(coalesce(p_repo_url, '')), '');
  v_file_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_file_name text := nullif(trim(coalesce(p_file_name, '')), '');
  v_sub_text text := trim(coalesce(p_submission_text, ''));
  v_explanation text := trim(coalesce(p_explanation, ''));
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_allowed_types jsonb;
  v_allowed_mimes jsonb;
  v_max_bytes bigint;
  v_obj_size bigint;
  v_obj_mime text;
  v_file_ext text;
  v_rubric_max integer := 0;
  v_crit jsonb;
  v_has_file_evidence boolean := false;
begin
  if auth.uid() is null or not public.is_active_learner() then
    raise exception 'Active learner authentication required';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id;
  if not found then
    raise exception 'Challenge not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('submit_challenge:' || auth.uid()::text || ':' || p_challenge_id::text));

  if v_idem is not null then
    select * into v_existing
    from public.submissions
    where user_id = auth.uid() and idempotency_key = v_idem;
    if found then
      if v_existing.challenge_id <> p_challenge_id then
        raise exception 'Idempotency key already used for a different challenge';
      end if;
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

  v_allowed_types := coalesce(
    v_challenge.allowed_evidence_types,
    '["written","file","project_url","repo_url","screenshot","audio","video"]'::jsonb
  );
  v_allowed_mimes := coalesce(v_challenge.allowed_mime_types, '[]'::jsonb);
  v_max_bytes := greatest(1, coalesce(v_challenge.max_file_size_mb, 25))::bigint * 1024 * 1024;

  if v_evidence_url is not null then
    if not (v_allowed_types ? 'project_url') then
      raise exception 'Project URL submissions are not permitted for this challenge';
    end if;
    if length(v_evidence_url) > 1000 or v_evidence_url !~* '^https?://' then
      raise exception 'Evidence URL must begin with https:// or http://';
    end if;
  end if;

  if v_repo_url is not null then
    if not (v_allowed_types ? 'repo_url') then
      raise exception 'Repository URL submissions are not permitted for this challenge';
    end if;
    if length(v_repo_url) > 1000 or v_repo_url !~* '^https?://' then
      raise exception 'Repository URL must begin with https:// or http://';
    end if;
  end if;

  if length(v_sub_text) > 0 then
    if length(v_sub_text) < 20 and v_evidence_url is null and v_repo_url is null and v_file_path is null then
      raise exception 'Written deliverable must be at least 20 characters';
    end if;
    if not (v_allowed_types ? 'written') then
      raise exception 'Written text deliverables are not permitted for this challenge';
    end if;
  end if;

  if v_file_path is not null then
    v_has_file_evidence := (
      (v_allowed_types ? 'file')
      or (v_allowed_types ? 'screenshot')
      or (v_allowed_types ? 'audio')
      or (v_allowed_types ? 'video')
    );
    if not v_has_file_evidence then
      raise exception 'File uploads are not permitted for this challenge';
    end if;

    if position('..' in v_file_path) > 0
       or left(v_file_path, 1) = '/'
       or split_part(v_file_path, '/', 1) <> auth.uid()::text
       or coalesce(array_length(string_to_array(v_file_path, '/'), 1), 0) < 2 then
      raise exception 'Invalid evidence file ownership path';
    end if;

    select o.id, o.owner, o.owner_id, o.metadata
    into v_obj
    from storage.objects o
    where o.bucket_id = 'evidence' and o.name = v_file_path;

    if not found then
      raise exception 'Uploaded evidence file not found in private storage';
    end if;

    if (v_obj.owner is not null and v_obj.owner <> auth.uid())
       or (nullif(v_obj.owner_id, '') is not null and v_obj.owner_id <> auth.uid()::text) then
      raise exception 'Uploaded evidence file is not owned by the submitting learner';
    end if;

    if exists (
      select 1 from public.submissions s
      where s.file_path = v_file_path
        and (s.user_id <> auth.uid() or s.challenge_id <> p_challenge_id)
    ) then
      raise exception 'Uploaded evidence file cannot be reused across submissions';
    end if;

    v_file_ext := lower(coalesce(nullif(regexp_replace(v_file_path, '^.*\.', ''), v_file_path), ''));
    if v_file_ext = '' or not (v_file_ext = any(array[
      'pdf','png','jpg','jpeg','webp','txt','md','csv','zip','docx',
      'mp3','wav','m4a','webm','ogg','mp4','mov'
    ])) then
      raise exception 'Evidence file extension ".%" is not permitted', v_file_ext;
    end if;

    if coalesce(v_obj.metadata ->> 'size', '') ~ '^\d+$' then
      v_obj_size := (v_obj.metadata ->> 'size')::bigint;
      if v_obj_size <= 0 or v_obj_size > v_max_bytes then
        raise exception 'Uploaded evidence file exceeds the % MB limit for this challenge', greatest(1, coalesce(v_challenge.max_file_size_mb, 25));
      end if;
    end if;

    v_obj_mime := lower(nullif(trim(coalesce(v_obj.metadata ->> 'mimetype', '')), ''));
    if v_obj_mime is not null then
      if jsonb_typeof(v_allowed_mimes) = 'array' and jsonb_array_length(v_allowed_mimes) > 0 then
        if not exists (
          select 1 from jsonb_array_elements_text(v_allowed_mimes) m where lower(m) = v_obj_mime
        ) then
          raise exception 'File MIME type "%" is not permitted for this challenge', v_obj_mime;
        end if;
      end if;

      if not (v_allowed_types ? 'file') then
        if (v_allowed_types ? 'screenshot') and not (v_allowed_types ? 'audio') and not (v_allowed_types ? 'video')
           and v_obj_mime not like 'image/%' then
          raise exception 'Challenge only accepts image screenshot uploads';
        elsif not (v_allowed_types ? 'screenshot') and ((v_allowed_types ? 'audio') or (v_allowed_types ? 'video'))
           and v_obj_mime not like 'audio/%' and v_obj_mime not like 'video/%' then
          raise exception 'Challenge only accepts audio or video media uploads';
        end if;
      end if;
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
  v_crit_raw text;
  v_crit_score integer;
  v_calc_total integer := 0;
  v_calc_max integer := 0;
  v_clean_scores jsonb := '{}'::jsonb;
  v_clean_feedback text := trim(coalesce(p_feedback, ''));
  v_target_course_id uuid;
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

  if p_rubric_scores is not null and jsonb_typeof(p_rubric_scores) <> 'object' then
    raise exception 'Rubric scores payload must be a JSON object';
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
    if p_rubric_scores is null then
      raise exception 'Rubric scores are required for rubric-evaluated challenges';
    end if;
    for v_crit in select value from jsonb_array_elements(v_challenge.rubric) loop
      v_crit_id := v_crit ->> 'id';
      v_crit_max := greatest(1, coalesce((v_crit ->> 'maxPoints')::integer, 5));
      if not (p_rubric_scores ? v_crit_id) then
        raise exception 'Rubric score missing for criterion %', v_crit_id;
      end if;
      v_crit_raw := trim(coalesce(p_rubric_scores ->> v_crit_id, ''));
      if v_crit_raw !~ '^-?\d+$' then
        raise exception 'Rubric score for % must be an integer', v_crit_id;
      end if;
      v_crit_score := v_crit_raw::integer;
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

  v_target_course_id := coalesce(v_challenge.course_id, v_sub.course_id);
  if v_target_course_id is not null then
    perform public.evaluate_course_and_skill_progression(v_sub.user_id, v_target_course_id);
  end if;
  if v_challenge.skill_id is not null then
    perform public.recompute_user_skill_level(v_sub.user_id, v_challenge.skill_id);
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
  v_exp_order jsonb;
  v_total integer := 0;
  v_score integer := 0;
  v_pct integer := 0;
  v_passed boolean := false;
  v_manual_raw text;
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
      if not (p_manual_scores ? (v_q.id::text)) then
        raise exception 'Manual score missing for question %', v_q.id;
      end if;
      v_manual_raw := trim(coalesce(p_manual_scores ->> (v_q.id::text), ''));
      if v_manual_raw !~ '^\d+$' then
        raise exception 'Manual score for question % must be a non-negative integer', v_q.id;
      end if;
      v_manual_val := v_manual_raw::integer;
      if v_manual_val < 0 or v_manual_val > greatest(1, coalesce(v_q.marks, 1)) then
        raise exception 'Manual score for question % must be between 0 and %', v_q.id, greatest(1, coalesce(v_q.marks, 1));
      end if;
      v_score := v_score + v_manual_val;
      v_clean_manual := v_clean_manual || jsonb_build_object(v_q.id::text, v_manual_val);
    else
      v_is_correct := false;
      if v_q.question_type = 'multiple_select' then
        if v_raw is not null and jsonb_typeof(v_raw) = 'array' then
          if not exists (
            select 1 from jsonb_array_elements_text(v_raw) val
            where val !~ '^\d+$' or val::int < 0 or val::int >= v_opt_len
          ) then
            select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_sel_sorted
            from jsonb_array_elements_text(v_raw) val;

            select coalesce(jsonb_agg(distinct val::int order by val::int), '[]'::jsonb) into v_exp_sorted
            from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'correctIndices', '[]'::jsonb)) val
            where val ~ '^\d+$';

            v_is_correct := jsonb_array_length(v_exp_sorted) > 0 and v_sel_sorted = v_exp_sorted;
          end if;
        end if;
      elsif v_q.question_type = 'fill_blank' then
        v_is_correct := exists (
          select 1
          from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'acceptedAnswers', '[]'::jsonb)) acc
          where lower(regexp_replace(trim(acc), '\s+', ' ', 'g')) =
                lower(regexp_replace(trim(coalesce(v_raw #>> '{}', '')), '\s+', ' ', 'g'))
            and trim(coalesce(v_raw #>> '{}', '')) <> ''
        );
      elsif v_q.question_type = 'ordering' then
        v_exp_order := coalesce(v_q.answer_config -> 'correctOrder', '[]'::jsonb);
        if v_raw is not null
           and jsonb_typeof(v_raw) = 'array'
           and jsonb_array_length(v_raw) = jsonb_array_length(v_exp_order)
           and jsonb_array_length(v_exp_order) >= 2 then
          v_is_correct := not exists (
            select 1
            from generate_series(0, jsonb_array_length(v_exp_order) - 1) idx
            where (v_raw ->> idx) !~ '^\d+$'
               or (v_exp_order ->> idx) !~ '^\d+$'
               or (v_raw ->> idx)::int <> (v_exp_order ->> idx)::int
          );
        end if;
      elsif v_q.question_type = 'true_false' then
        v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
        if v_raw_text ~ '^\d+$' then
          v_selected := v_raw_text::integer;
          if v_selected >= 0 and v_selected < coalesce(nullif(v_opt_len, 0), 2) then
            v_is_correct := (v_selected = v_q.correct_index);
          end if;
        end if;
      else
        v_raw_text := trim(coalesce(v_raw #>> '{}', ''));
        if v_raw_text ~ '^\d+$' then
          v_selected := v_raw_text::integer;
          if v_selected >= 0 and v_selected < v_opt_len then
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

  if v_quiz.course_id is not null then
    perform public.evaluate_course_and_skill_progression(v_att.user_id, v_quiz.course_id);
  end if;
  perform public.recompute_user_skill_level(v_att.user_id, v_quiz.skill_id);

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
  v_bad_idx boolean;
  v_ord_len integer;
  v_ord_distinct integer;
  v_next_pos integer;
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

  if jsonb_typeof(v_cfg) <> 'object' then
    raise exception 'answer_config must be a JSON object';
  end if;

  if v_qtype = 'true_false' and jsonb_array_length(v_opts) = 0 then
    v_opts := '["True","False"]'::jsonb;
  end if;
  v_opt_len := jsonb_array_length(v_opts);

  if v_qtype = 'true_false' then
    if v_opt_len <> 2 then
      raise exception 'True/false questions require exactly 2 options';
    end if;
    if coalesce(p_correct_index, 0) not in (0, 1) then
      raise exception 'correct_index out of bounds for true_false options';
    end if;
  elsif v_qtype in ('multiple_choice', 'scenario', 'case_study') then
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
    select exists (
      select 1
      from jsonb_array_elements_text(v_cfg -> 'correctIndices') val
      where val !~ '^\d+$' or val::int < 0 or val::int >= v_opt_len
    ) into v_bad_idx;
    if v_bad_idx then
      raise exception 'correctIndices contains out-of-range or invalid index';
    end if;
  elsif v_qtype = 'fill_blank' then
    if jsonb_typeof(v_cfg -> 'acceptedAnswers') <> 'array'
       or not exists (
         select 1
         from jsonb_array_elements_text(v_cfg -> 'acceptedAnswers') acc
         where trim(acc) <> ''
       ) then
      raise exception 'Fill-blank questions require non-empty acceptedAnswers';
    end if;
  elsif v_qtype = 'ordering' then
    if v_opt_len < 2 or jsonb_typeof(v_cfg -> 'correctOrder') <> 'array' then
      raise exception 'Ordering questions require at least 2 options and correctOrder array';
    end if;
    v_ord_len := jsonb_array_length(v_cfg -> 'correctOrder');
    if v_ord_len <> v_opt_len then
      raise exception 'correctOrder length must equal options count';
    end if;
    select exists (
      select 1
      from jsonb_array_elements_text(v_cfg -> 'correctOrder') val
      where val !~ '^\d+$' or val::int < 0 or val::int >= v_opt_len
    ) into v_bad_idx;
    if v_bad_idx then
      raise exception 'correctOrder contains out-of-range or invalid index';
    end if;
    select count(distinct val::int) into v_ord_distinct
    from jsonb_array_elements_text(v_cfg -> 'correctOrder') val;
    if v_ord_distinct <> v_opt_len then
      raise exception 'correctOrder must contain distinct indices covering all options';
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

  if p_position is null then
    select coalesce(max(position), 0) + 1 into v_next_pos
    from public.questions
    where quiz_id = p_quiz_id;
  else
    v_next_pos := p_position;
  end if;

  insert into public.questions (
    quiz_id, position, question_type, difficulty, marks, prompt, context_text, options, correct_index, answer_config, explanation
  )
  values (
    p_quiz_id,
    v_next_pos,
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

create or replace function public.admin_delete_question(
  p_quiz_id uuid,
  p_question_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  delete from public.questions
  where id = p_question_id and quiz_id = p_quiz_id;

  if not found then
    raise exception 'Question not found for quiz %', p_quiz_id;
  end if;
  return true;
end;
$$;

revoke all on function public.admin_delete_question(uuid, uuid) from public, anon;
grant execute on function public.admin_delete_question(uuid, uuid) to authenticated;

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

create or replace function public.capture_course_curriculum_snapshot(
  p_course_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_phases jsonb := '[]'::jsonb;
begin
  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Course not found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'position', p.position,
        'title', p.title,
        'summary', p.summary,
        'objectives', p.objectives,
        'difficulty', p.difficulty,
        'estHours', p.est_hours,
        'publicationStatus', p.publication_status,
        'lessons', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'phaseId', l.phase_id,
                'position', l.position,
                'title', l.title,
                'introduction', l.introduction,
                'objectives', l.objectives,
                'estMinutes', l.est_minutes,
                'blocks', l.blocks,
                'videos', l.videos,
                'summary', l.summary,
                'takeaways', l.takeaways,
                'furtherReading', l.further_reading,
                'lessonResources', coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'title', lr.title,
                        'url', lr.url,
                        'resourceType', lr.resource_type,
                        'position', lr.position
                      )
                      order by lr.position asc
                    )
                    from public.lesson_resources lr
                    where lr.lesson_id = l.id
                  ),
                  '[]'::jsonb
                ),
                'completionCriteria', l.completion_criteria,
                'publicationStatus', l.publication_status,
                'isRequired', l.is_required
              )
              order by l.position asc
            )
            from public.lessons l
            where l.phase_id = p.id
          ),
          '[]'::jsonb
        )
      )
      order by p.position asc
    ),
    '[]'::jsonb
  )
  into v_phases
  from public.phases p
  where p.course_id = p_course_id;

  return jsonb_build_object(
    'schemaVersion', '1.0',
    'capturedAt', now(),
    'course', jsonb_build_object(
      'id', v_course.id,
      'slug', v_course.slug,
      'title', v_course.title,
      'description', v_course.description,
      'targetAudience', v_course.target_audience,
      'outcomes', v_course.outcomes,
      'difficulty', v_course.difficulty,
      'estimatedDurationWeeks', v_course.estimated_duration_weeks,
      'recommendedWeeklyHours', v_course.recommended_weekly_hours,
      'recommendedSchedule', v_course.recommended_schedule,
      'prerequisites', v_course.prerequisites,
      'thumbnailUrl', v_course.thumbnail_url,
      'authorName', v_course.author_name,
      'completionRules', v_course.completion_rules,
      'publicationStatus', v_course.publication_status,
      'version', v_course.version
    ),
    'phases', v_phases
  );
end;
$$;

revoke all on function public.capture_course_curriculum_snapshot(uuid) from public, anon, authenticated;

create or replace function public.validate_imported_lesson_payload(
  p_lesson jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_est_minutes integer;
  v_blocks jsonb;
  v_blk jsonb;
  v_blk_type text;
  v_idx integer := 0;
  v_non_code_text text := '';
  v_opts jsonb;
  v_cidx integer;
  v_fr jsonb;
  v_vid jsonb;
  v_url text;
  v_has_substantive boolean := false;
begin
  if p_lesson is null or jsonb_typeof(p_lesson) <> 'object' then
    raise exception 'Each imported lesson must be a JSON object';
  end if;

  v_title := trim(coalesce(p_lesson ->> 'title', ''));
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'Lesson title must be between 3 and 200 characters';
  end if;

  if (p_lesson ? 'estMinutes') and (p_lesson -> 'estMinutes') is not null then
    begin
      v_est_minutes := (p_lesson ->> 'estMinutes')::integer;
    exception when others then
      raise exception 'Lesson "%" estMinutes must be an integer', v_title;
    end;
    if v_est_minutes < 1 or v_est_minutes > 600 then
      raise exception 'Lesson "%" estMinutes must be between 1 and 600', v_title;
    end if;
  end if;

  v_blocks := p_lesson -> 'blocks';
  if v_blocks is null or jsonb_typeof(v_blocks) <> 'array' or jsonb_array_length(v_blocks) = 0 then
    raise exception 'Lesson "%" must contain at least one structured content block', v_title;
  end if;

  v_non_code_text := coalesce(p_lesson ->> 'title', '') || ' '
    || coalesce(p_lesson ->> 'introduction', '') || ' '
    || coalesce(p_lesson ->> 'summary', '') || ' '
    || coalesce(p_lesson ->> 'completionCriteria', '');

  for v_blk in select value from jsonb_array_elements(v_blocks) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_blk) <> 'object' then
      raise exception 'Lesson "%" block % must be a JSON object', v_title, v_idx;
    end if;

    v_blk_type := trim(coalesce(v_blk ->> 'type', ''));
    if v_blk_type not in (
      'heading', 'paragraph', 'steps', 'bullets', 'definition',
      'example', 'case_study', 'table', 'callout', 'demonstration',
      'code', 'image', 'video', 'resource_download', 'knowledge_check'
    ) then
      raise exception 'Lesson "%" uses unsupported block type "%"', v_title, v_blk_type;
    end if;

    if v_blk_type <> 'code' then
      v_non_code_text := v_non_code_text || ' ' || v_blk::text;
    else
      v_non_code_text := v_non_code_text || ' ' || coalesce(v_blk ->> 'title', '');
    end if;

    if v_blk_type = 'heading' then
      if length(trim(coalesce(v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" heading block requires text', v_title;
      end if;
    elsif v_blk_type in ('paragraph', 'callout') then
      if length(trim(coalesce(v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" % block requires text', v_title, v_blk_type;
      end if;
      v_has_substantive := true;
    elsif v_blk_type in ('steps', 'bullets') then
      if jsonb_typeof(v_blk -> 'items') <> 'array' or jsonb_array_length(v_blk -> 'items') = 0 then
        raise exception 'Lesson "%" % block requires items', v_title, v_blk_type;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'definition' then
      if length(trim(coalesce(v_blk ->> 'term', ''))) = 0
         or length(trim(coalesce(v_blk ->> 'meaning', v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" definition block requires term and meaning', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'example' then
      if length(trim(coalesce(v_blk ->> 'body', ''))) = 0 then
        raise exception 'Lesson "%" example block requires body', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'case_study' then
      if length(trim(coalesce(v_blk ->> 'scenario', v_blk ->> 'text', ''))) = 0 then
        raise exception 'Lesson "%" case_study block requires scenario', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'table' then
      if jsonb_typeof(v_blk -> 'headers') <> 'array' or jsonb_array_length(v_blk -> 'headers') = 0
         or jsonb_typeof(v_blk -> 'rows') <> 'array' or jsonb_array_length(v_blk -> 'rows') = 0 then
        raise exception 'Lesson "%" table block requires headers and rows', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'demonstration' then
      if length(trim(coalesce(v_blk ->> 'instructions', ''))) = 0 then
        raise exception 'Lesson "%" demonstration block requires instructions', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'code' then
      if length(trim(coalesce(v_blk ->> 'code', ''))) = 0 then
        raise exception 'Lesson "%" code block requires code', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'image' then
      v_url := trim(coalesce(v_blk ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^(https?://|/[^/])' then
        raise exception 'Lesson "%" image block URL must be https://, http://, or root-relative', v_title;
      end if;
      if length(v_url) > 0 then
        v_has_substantive := true;
      end if;
    elsif v_blk_type = 'video' then
      v_url := trim(coalesce(v_blk ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^https?://' then
        raise exception 'Lesson "%" video block URL must be https:// or http://', v_title;
      end if;
      if length(trim(coalesce(v_blk ->> 'videoId', ''))) = 0 and length(v_url) = 0 then
        raise exception 'Lesson "%" video block requires valid videoId or url', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'resource_download' then
      if length(trim(coalesce(v_blk ->> 'title', ''))) = 0 then
        raise exception 'Lesson "%" resource_download block requires title', v_title;
      end if;
      v_url := trim(coalesce(v_blk ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^https?://' then
        raise exception 'Lesson "%" resource_download URL must be https:// or http://', v_title;
      end if;
      v_has_substantive := true;
    elsif v_blk_type = 'knowledge_check' then
      v_opts := v_blk -> 'options';
      if length(trim(coalesce(v_blk ->> 'prompt', ''))) = 0
         or jsonb_typeof(v_opts) <> 'array'
         or jsonb_array_length(v_opts) < 2 then
        raise exception 'Lesson "%" knowledge_check requires prompt and at least 2 options', v_title;
      end if;
      begin
        v_cidx := coalesce((v_blk ->> 'correctIndex')::integer, -1);
      exception when others then
        v_cidx := -1;
      end;
      if v_cidx < 0 or v_cidx >= jsonb_array_length(v_opts) then
        raise exception 'Lesson "%" knowledge_check correctIndex out of range', v_title;
      end if;
      v_has_substantive := true;
    end if;
  end loop;

  v_non_code_text := regexp_replace(v_non_code_text, '`[^`]*`', ' ', 'g');
  if v_non_code_text ~* '(<\s*script\y[^>]*>.*?<\s*/\s*script\s*>|<\s*script\y\s+(src|type|async|defer|nonce|crossorigin|on[a-z]+)\y|<\s*(iframe|object|embed|svg|style)\y|<\s*img\y[^>]*\y(src|on[a-z]+)\s*=|<\s*a\y[^>]*\yhref\s*=\s*["'']?\s*(javascript|vbscript|data):|\yon[a-z]{2,}\s*=\s*(?!\\?["'']\.\.\.\\?["''])|\ysrcdoc\s*=|\y(javascript|vbscript):(?![\s"''`<>]|$)|\ydata\s*:\s*text/html)' then
    raise exception 'Lesson "%" contains disallowed HTML, script, or executable URI constructs', v_title;
  end if;

  if jsonb_typeof(coalesce(p_lesson -> 'videos', '[]'::jsonb)) = 'array' then
    for v_vid in select value from jsonb_array_elements(coalesce(p_lesson -> 'videos', '[]'::jsonb)) loop
      v_url := trim(coalesce(v_vid ->> 'url', ''));
      if length(v_url) > 0 and v_url !~* '^https?://' then
        raise exception 'Lesson "%" contains invalid video URL', v_title;
      end if;
      v_has_substantive := true;
    end loop;
  end if;

  if jsonb_typeof(coalesce(p_lesson -> 'furtherReading', '[]'::jsonb)) = 'array' then
    for v_fr in select value from jsonb_array_elements(coalesce(p_lesson -> 'furtherReading', '[]'::jsonb)) loop
      v_url := trim(coalesce(v_fr ->> 'url', ''));
      if length(trim(coalesce(v_fr ->> 'title', ''))) = 0 or v_url !~* '^https?://' then
        raise exception 'Lesson "%" furtherReading entries require a title and https:// or http:// URL', v_title;
      end if;
    end loop;
  end if;

  if not v_has_substantive then
    raise exception 'Lesson "%" lacks substantive instructional blocks', v_title;
  end if;
end;
$$;

revoke all on function public.validate_imported_lesson_payload(jsonb) from public, anon, authenticated;

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
  v_snapshot_data jsonb;
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

  v_snapshot_data := public.capture_course_curriculum_snapshot(p_course_id);
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

  insert into public.course_versions (
    course_id, version_number, change_notes, snapshot_type, snapshot, snapshot_data, created_by
  )
  values (
    p_course_id,
    v_next_ver,
    v_notes,
    'manual',
    jsonb_build_object(
      'title', v_course.title,
      'publicationStatus', v_course.publication_status,
      'difficulty', v_course.difficulty,
      'phaseCount', v_phase_cnt,
      'lessonCount', v_lesson_cnt,
      'quizCount', v_quiz_cnt,
      'challengeCount', v_challenge_cnt
    ),
    v_snapshot_data,
    auth.uid()
  )
  on conflict (course_id, version_number) do update set
    change_notes = excluded.change_notes,
    snapshot_data = excluded.snapshot_data
  returning * into v_ver_row;

  perform public.record_admin_audit_log(
    'course_snapshot_created',
    'course_versions',
    v_ver_row.id::text,
    null,
    jsonb_build_object(
      'courseId', p_course_id,
      'versionNumber', v_next_ver,
      'snapshotType', 'manual',
      'changeNotes', left(v_notes, 300)
    )
  );

  return v_ver_row;
end;
$$;

revoke all on function public.admin_create_course_version(uuid, text) from public, anon;
grant execute on function public.admin_create_course_version(uuid, text) to authenticated;

create or replace function public.admin_bulk_import_course_content(
  p_course_id uuid,
  p_package_version text,
  p_lessons jsonb,
  p_change_notes text default '',
  p_idempotency_key text default null,
  p_unchanged_count integer default 0,
  p_rejected_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_actor_email text;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_existing_import public.content_imports;
  v_notes text := trim(coalesce(p_change_notes, ''));
  v_pre_snapshot jsonb;
  v_pre_version_id uuid;
  v_pre_version_num integer;
  v_import_id uuid;
  v_item jsonb;
  v_idx integer := 0;
  v_phase_id uuid;
  v_lesson_id uuid;
  v_existing_lesson public.lessons;
  v_is_new boolean;
  v_seen_ids uuid[] := array[]::uuid[];
  v_created_cnt integer := 0;
  v_updated_cnt integer := 0;
  v_unchanged_cnt integer := greatest(0, coalesce(p_unchanged_count, 0));
  v_rejected_cnt integer := greatest(0, coalesce(p_rejected_count, 0));
  v_processed_cnt integer := 0;
  v_target_pos integer;
  v_effective_status text;
  v_resources jsonb;
  v_res jsonb;
  v_res_idx integer;
  v_touched_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  perform pg_advisory_xact_lock(hashtext('bulk_import:' || coalesce(p_course_id::text, '')));

  if v_idem is not null then
    select * into v_existing_import
    from public.content_imports
    where course_id = p_course_id
      and idempotency_key = v_idem
      and status = 'committed'
    limit 1;

    if found then
      return jsonb_build_object(
        'importId', v_existing_import.id,
        'snapshotVersionId', v_existing_import.snapshot_version_id,
        'snapshotVersionNumber', (
          select version_number from public.course_versions where id = v_existing_import.snapshot_version_id
        ),
        'processedCount', v_existing_import.processed_count,
        'createdCount', v_existing_import.created_count,
        'updatedCount', v_existing_import.updated_count,
        'unchangedCount', v_existing_import.unchanged_count,
        'rejectedCount', v_existing_import.rejected_count,
        'idempotentReplay', true
      );
    end if;
  end if;

  if trim(coalesce(p_package_version, '')) <> '1.0' then
    raise exception 'Unsupported content package schema version "%"', p_package_version;
  end if;

  if length(v_notes) > 2000 then
    raise exception 'Change notes cannot exceed 2,000 characters';
  end if;

  if p_lessons is null or jsonb_typeof(p_lessons) <> 'array' or jsonb_array_length(p_lessons) = 0 then
    raise exception 'At least one validated lesson is required to commit a bulk import';
  end if;

  if jsonb_array_length(p_lessons) > 200 then
    raise exception 'Bulk import cannot exceed 200 lessons per batch';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Target course not found';
  end if;

  select email into v_actor_email from public.profiles where id = auth.uid();

  for v_item in select value from jsonb_array_elements(p_lessons) loop
    v_idx := v_idx + 1;
    perform public.validate_imported_lesson_payload(v_item);

    begin
      v_phase_id := nullif(trim(coalesce(v_item ->> 'phaseId', '')), '')::uuid;
    exception when others then
      raise exception 'Lesson item % has invalid phaseId "%"', v_idx, v_item ->> 'phaseId';
    end;

    if v_phase_id is null or not exists (
      select 1 from public.phases ph where ph.id = v_phase_id and ph.course_id = p_course_id
    ) then
      raise exception 'Phase "%" does not belong to target course "%"', v_item ->> 'phaseId', v_course.title;
    end if;

    v_is_new := (jsonb_typeof(v_item -> 'isNew') = 'boolean' and (v_item ->> 'isNew')::boolean)
      or lower(trim(coalesce(v_item ->> 'action', ''))) = 'create';

    if nullif(trim(coalesce(v_item ->> 'id', '')), '') is not null then
      if v_is_new then
        raise exception 'New lessons (isNew: true) cannot specify an existing id';
      end if;
      begin
        v_lesson_id := trim(v_item ->> 'id')::uuid;
      exception when others then
        raise exception 'Invalid lesson UUID "%"', v_item ->> 'id';
      end;

      if v_lesson_id = any(v_seen_ids) then
        raise exception 'Duplicate lesson id "%" in bulk import batch', v_lesson_id;
      end if;
      v_seen_ids := array_append(v_seen_ids, v_lesson_id);

      select l.* into v_existing_lesson
      from public.lessons l
      join public.phases ph on ph.id = l.phase_id
      where l.id = v_lesson_id and ph.course_id = p_course_id;

      if not found then
        raise exception 'Lesson id "%" was not found in course "%"', v_lesson_id, v_course.title;
      end if;
      if v_existing_lesson.phase_id <> v_phase_id then
        raise exception 'Lesson "%" belongs to another module and cannot be moved silently', v_lesson_id;
      end if;
    elsif not v_is_new then
      raise exception 'Lesson "%" is missing an existing id and is not marked isNew: true', v_item ->> 'title';
    end if;
  end loop;

  v_pre_snapshot := public.capture_course_curriculum_snapshot(p_course_id);
  v_pre_version_num := coalesce(v_course.version, 1) + 1;

  update public.courses
  set version = v_pre_version_num, updated_at = now()
  where id = p_course_id;

  insert into public.course_versions (
    course_id, version_number, change_notes, snapshot_type, snapshot, snapshot_data, created_by
  )
  values (
    p_course_id,
    v_pre_version_num,
    case when length(v_notes) > 0 then 'Pre-import snapshot: ' || v_notes else 'Pre-import automatic backup' end,
    'pre_import',
    jsonb_build_object(
      'title', v_course.title,
      'publicationStatus', v_course.publication_status,
      'difficulty', v_course.difficulty,
      'phaseCount', jsonb_array_length(coalesce(v_pre_snapshot -> 'phases', '[]'::jsonb)),
      'lessonCount', (
        select count(*)
        from public.lessons l
        join public.phases ph on ph.id = l.phase_id
        where ph.course_id = p_course_id
      )
    ),
    v_pre_snapshot,
    auth.uid()
  )
  returning id into v_pre_version_id;

  perform public.record_admin_audit_log(
    'course_snapshot_created',
    'course_versions',
    v_pre_version_id::text,
    null,
    jsonb_build_object(
      'courseId', p_course_id,
      'versionNumber', v_pre_version_num,
      'snapshotType', 'pre_import'
    )
  );

  if coalesce(array_length(v_seen_ids, 1), 0) > 0 then
    v_idx := 0;
    foreach v_touched_id in array v_seen_ids loop
      v_idx := v_idx + 1;
      update public.lessons
      set position = -1000000 - v_idx
      where id = v_touched_id;
    end loop;
  end if;

  for v_item in select value from jsonb_array_elements(p_lessons) loop
    v_phase_id := trim(v_item ->> 'phaseId')::uuid;
    v_resources := coalesce(v_item -> 'furtherReading', '[]'::jsonb);

    if nullif(trim(coalesce(v_item ->> 'id', '')), '') is not null then
      v_lesson_id := trim(v_item ->> 'id')::uuid;
      select * into v_existing_lesson from public.lessons where id = v_lesson_id;

      v_target_pos := coalesce((v_item ->> 'position')::integer, abs(v_existing_lesson.position));
      if v_target_pos < 1 then
        v_target_pos := 1;
      end if;

      v_effective_status := case
        when v_existing_lesson.publication_status = 'published' then 'published'
        else 'draft'
      end;

      update public.lessons
      set position = v_target_pos,
          title = trim(v_item ->> 'title'),
          introduction = coalesce(v_item ->> 'introduction', ''),
          objectives = coalesce(v_item -> 'objectives', '[]'::jsonb),
          est_minutes = coalesce((v_item ->> 'estMinutes')::integer, 25),
          blocks = coalesce(v_item -> 'blocks', '[]'::jsonb),
          videos = coalesce(v_item -> 'videos', '[]'::jsonb),
          summary = coalesce(v_item ->> 'summary', ''),
          takeaways = coalesce(v_item -> 'takeaways', '[]'::jsonb),
          further_reading = v_resources,
          completion_criteria = coalesce(v_item ->> 'completionCriteria', ''),
          publication_status = v_effective_status,
          is_required = case
            when jsonb_typeof(v_item -> 'isRequired') = 'boolean' then (v_item ->> 'isRequired')::boolean
            else true
          end
      where id = v_lesson_id;

      v_touched_id := v_lesson_id;
      v_updated_cnt := v_updated_cnt + 1;
    else
      if (v_item ? 'position') and (v_item -> 'position') is not null then
        v_target_pos := greatest(1, (v_item ->> 'position')::integer);
      else
        select coalesce(max(position), 0) + 1 into v_target_pos
        from public.lessons
        where phase_id = v_phase_id;
      end if;

      v_effective_status := 'draft';

      insert into public.lessons (
        phase_id, position, title, introduction, objectives, est_minutes,
        blocks, videos, summary, takeaways, further_reading, completion_criteria,
        publication_status, is_required
      )
      values (
        v_phase_id,
        v_target_pos,
        trim(v_item ->> 'title'),
        coalesce(v_item ->> 'introduction', ''),
        coalesce(v_item -> 'objectives', '[]'::jsonb),
        coalesce((v_item ->> 'estMinutes')::integer, 25),
        coalesce(v_item -> 'blocks', '[]'::jsonb),
        coalesce(v_item -> 'videos', '[]'::jsonb),
        coalesce(v_item ->> 'summary', ''),
        coalesce(v_item -> 'takeaways', '[]'::jsonb),
        v_resources,
        coalesce(v_item ->> 'completionCriteria', ''),
        v_effective_status,
        case
          when jsonb_typeof(v_item -> 'isRequired') = 'boolean' then (v_item ->> 'isRequired')::boolean
          else true
        end
      )
      returning id into v_touched_id;

      v_created_cnt := v_created_cnt + 1;
    end if;

    delete from public.lesson_resources where lesson_id = v_touched_id;
    if jsonb_typeof(v_resources) = 'array' and jsonb_array_length(v_resources) > 0 then
      v_res_idx := 0;
      for v_res in select value from jsonb_array_elements(v_resources) loop
        v_res_idx := v_res_idx + 1;
        insert into public.lesson_resources (lesson_id, title, url, resource_type, position)
        values (
          v_touched_id,
          trim(coalesce(nullif(v_res ->> 'title', ''), v_res ->> 'url')),
          trim(v_res ->> 'url'),
          coalesce(nullif(trim(v_res ->> 'resourceType'), ''), 'Guide'),
          v_res_idx
        )
        on conflict (lesson_id, url) do update set
          title = excluded.title,
          resource_type = excluded.resource_type,
          position = excluded.position;
      end loop;
    end if;
  end loop;

  v_processed_cnt := v_created_cnt + v_updated_cnt + v_unchanged_cnt + v_rejected_cnt;

  insert into public.content_imports (
    course_id, actor_id, actor_email, operation_type, package_version, status,
    processed_count, created_count, updated_count, unchanged_count, rejected_count,
    snapshot_version_id, idempotency_key, change_notes, details
  )
  values (
    p_course_id,
    auth.uid(),
    v_actor_email,
    'import',
    p_package_version,
    'committed',
    v_processed_cnt,
    v_created_cnt,
    v_updated_cnt,
    v_unchanged_cnt,
    v_rejected_cnt,
    v_pre_version_id,
    v_idem,
    v_notes,
    jsonb_build_object('touchedLessons', jsonb_array_length(p_lessons))
  )
  returning id into v_import_id;

  update public.course_versions
  set source_import_id = v_import_id
  where id = v_pre_version_id;

  perform public.record_admin_audit_log(
    'bulk_content_import_committed',
    'courses',
    p_course_id::text,
    null,
    jsonb_build_object(
      'importId', v_import_id,
      'snapshotVersionId', v_pre_version_id,
      'createdCount', v_created_cnt,
      'updatedCount', v_updated_cnt,
      'unchangedCount', v_unchanged_cnt,
      'changeNotes', left(v_notes, 300)
    )
  );

  return jsonb_build_object(
    'importId', v_import_id,
    'snapshotVersionId', v_pre_version_id,
    'snapshotVersionNumber', v_pre_version_num,
    'processedCount', v_processed_cnt,
    'createdCount', v_created_cnt,
    'updatedCount', v_updated_cnt,
    'unchangedCount', v_unchanged_cnt,
    'rejectedCount', v_rejected_cnt,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.admin_bulk_import_course_content(uuid, text, jsonb, text, text, integer, integer) from public, anon;
grant execute on function public.admin_bulk_import_course_content(uuid, text, jsonb, text, text, integer, integer) to authenticated;

create or replace function public.admin_log_content_import_event(
  p_course_id uuid,
  p_status text,
  p_package_version text default '1.0',
  p_processed_count integer default 0,
  p_rejected_count integer default 0,
  p_error_summary text default '',
  p_details jsonb default '{}'::jsonb
)
returns public.content_imports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text;
  v_row public.content_imports;
  v_audit_action text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_status not in ('rejected', 'failed') then
    raise exception 'Invalid import event status: must be rejected or failed';
  end if;

  if not exists (select 1 from public.courses where id = p_course_id) then
    raise exception 'Course not found';
  end if;

  select email into v_actor_email from public.profiles where id = auth.uid();

  insert into public.content_imports (
    course_id, actor_id, actor_email, operation_type, package_version, status,
    processed_count, created_count, updated_count, unchanged_count, rejected_count,
    error_summary, details
  )
  values (
    p_course_id,
    auth.uid(),
    v_actor_email,
    'import',
    coalesce(nullif(trim(p_package_version), ''), '1.0'),
    p_status,
    greatest(0, coalesce(p_processed_count, 0)),
    0,
    0,
    0,
    greatest(0, coalesce(p_rejected_count, 0)),
    left(trim(coalesce(p_error_summary, '')), 1000),
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_row;

  v_audit_action := case
    when p_status = 'rejected' then 'bulk_content_import_rejected'
    else 'bulk_content_import_failed'
  end;

  perform public.record_admin_audit_log(
    v_audit_action,
    'courses',
    p_course_id::text,
    null,
    jsonb_build_object(
      'importId', v_row.id,
      'status', p_status,
      'rejectedCount', v_row.rejected_count,
      'errorSummary', v_row.error_summary
    )
  );

  return v_row;
end;
$$;

revoke all on function public.admin_log_content_import_event(uuid, text, text, integer, integer, text, jsonb) from public, anon;
grant execute on function public.admin_log_content_import_event(uuid, text, text, integer, integer, text, jsonb) to authenticated;

create or replace function public.admin_restore_course_snapshot(
  p_course_id uuid,
  p_version_id uuid,
  p_restore_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_target_ver public.course_versions;
  v_actor_email text;
  v_notes text := trim(coalesce(p_restore_notes, ''));
  v_safety_snapshot jsonb;
  v_safety_ver_id uuid;
  v_safety_ver_num integer;
  v_snap jsonb;
  v_snap_course jsonb;
  v_phase jsonb;
  v_lesson jsonb;
  v_phase_id uuid;
  v_lesson_id uuid;
  v_restored_lesson_ids uuid[] := array[]::uuid[];
  v_restored_lessons_cnt integer := 0;
  v_archived_extra_cnt integer := 0;
  v_deleted_extra_cnt integer := 0;
  v_extra record;
  v_shift integer := 0;
  v_max_pos integer;
  v_resources jsonb;
  v_res jsonb;
  v_res_idx integer;
  v_restore_import_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if length(v_notes) > 2000 then
    raise exception 'Restore notes cannot exceed 2,000 characters';
  end if;

  perform pg_advisory_xact_lock(hashtext('bulk_import:' || coalesce(p_course_id::text, '')));

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'Course not found';
  end if;

  select * into v_target_ver
  from public.course_versions
  where id = p_version_id and course_id = p_course_id;

  if not found then
    raise exception 'Course version snapshot not found';
  end if;

  v_snap := v_target_ver.snapshot_data;
  if v_snap is null
     or jsonb_typeof(v_snap) <> 'object'
     or jsonb_typeof(v_snap -> 'phases') <> 'array' then
    raise exception 'Selected course version does not contain a restorable full curriculum snapshot';
  end if;

  select email into v_actor_email from public.profiles where id = auth.uid();

  v_safety_snapshot := public.capture_course_curriculum_snapshot(p_course_id);
  v_safety_ver_num := coalesce(v_course.version, 1) + 1;

  update public.courses
  set version = v_safety_ver_num, updated_at = now()
  where id = p_course_id;

  insert into public.course_versions (
    course_id, version_number, change_notes, snapshot_type, snapshot, snapshot_data, created_by
  )
  values (
    p_course_id,
    v_safety_ver_num,
    'Pre-restore automatic backup before reverting to v' || v_target_ver.version_number,
    'pre_restore',
    jsonb_build_object(
      'title', v_course.title,
      'publicationStatus', v_course.publication_status,
      'difficulty', v_course.difficulty,
      'phaseCount', jsonb_array_length(coalesce(v_safety_snapshot -> 'phases', '[]'::jsonb))
    ),
    v_safety_snapshot,
    auth.uid()
  )
  returning id into v_safety_ver_id;

  perform public.record_admin_audit_log(
    'course_snapshot_created',
    'course_versions',
    v_safety_ver_id::text,
    null,
    jsonb_build_object(
      'courseId', p_course_id,
      'versionNumber', v_safety_ver_num,
      'snapshotType', 'pre_restore'
    )
  );

  for v_extra in
    select l.id
    from public.lessons l
    join public.phases ph on ph.id = l.phase_id
    where ph.course_id = p_course_id
  loop
    v_shift := v_shift + 1;
    update public.lessons set position = -2000000 - v_shift where id = v_extra.id;
  end loop;

  for v_phase in select value from jsonb_array_elements(v_snap -> 'phases') loop
    v_phase_id := (v_phase ->> 'id')::uuid;

    insert into public.phases (
      id, course_id, position, title, summary, objectives, difficulty, est_hours, publication_status
    )
    values (
      v_phase_id,
      p_course_id,
      greatest(1, coalesce((v_phase ->> 'position')::integer, 1)),
      coalesce(v_phase ->> 'title', 'Module'),
      coalesce(v_phase ->> 'summary', ''),
      coalesce(v_phase -> 'objectives', '[]'::jsonb),
      coalesce(v_phase ->> 'difficulty', 'Beginner'),
      coalesce((v_phase ->> 'estHours')::numeric, 2.0),
      coalesce(v_phase ->> 'publicationStatus', 'published')
    )
    on conflict (id) do update set
      course_id = excluded.course_id,
      position = excluded.position,
      title = excluded.title,
      summary = excluded.summary,
      objectives = excluded.objectives,
      difficulty = excluded.difficulty,
      est_hours = excluded.est_hours,
      publication_status = excluded.publication_status;

    for v_lesson in select value from jsonb_array_elements(coalesce(v_phase -> 'lessons', '[]'::jsonb)) loop
      v_lesson_id := (v_lesson ->> 'id')::uuid;
      v_restored_lesson_ids := array_append(v_restored_lesson_ids, v_lesson_id);

      insert into public.lessons (
        id, phase_id, position, title, introduction, objectives, est_minutes,
        blocks, videos, summary, takeaways, further_reading, completion_criteria,
        publication_status, is_required
      )
      values (
        v_lesson_id,
        v_phase_id,
        greatest(1, coalesce((v_lesson ->> 'position')::integer, 1)),
        coalesce(v_lesson ->> 'title', 'Lesson'),
        coalesce(v_lesson ->> 'introduction', ''),
        coalesce(v_lesson -> 'objectives', '[]'::jsonb),
        greatest(1, coalesce((v_lesson ->> 'estMinutes')::integer, 25)),
        coalesce(v_lesson -> 'blocks', '[]'::jsonb),
        coalesce(v_lesson -> 'videos', '[]'::jsonb),
        coalesce(v_lesson ->> 'summary', ''),
        coalesce(v_lesson -> 'takeaways', '[]'::jsonb),
        coalesce(v_lesson -> 'furtherReading', '[]'::jsonb),
        coalesce(v_lesson ->> 'completionCriteria', ''),
        coalesce(v_lesson ->> 'publicationStatus', 'draft'),
        coalesce((v_lesson ->> 'isRequired')::boolean, true)
      )
      on conflict (id) do update set
        phase_id = excluded.phase_id,
        position = excluded.position,
        title = excluded.title,
        introduction = excluded.introduction,
        objectives = excluded.objectives,
        est_minutes = excluded.est_minutes,
        blocks = excluded.blocks,
        videos = excluded.videos,
        summary = excluded.summary,
        takeaways = excluded.takeaways,
        further_reading = excluded.further_reading,
        completion_criteria = excluded.completion_criteria,
        publication_status = excluded.publication_status,
        is_required = excluded.is_required;

      v_resources := coalesce(v_lesson -> 'lessonResources', v_lesson -> 'furtherReading', '[]'::jsonb);
      delete from public.lesson_resources where lesson_id = v_lesson_id;
      if jsonb_typeof(v_resources) = 'array' and jsonb_array_length(v_resources) > 0 then
        v_res_idx := 0;
        for v_res in select value from jsonb_array_elements(v_resources) loop
          if trim(coalesce(v_res ->> 'url', '')) ~* '^https?://' then
            v_res_idx := v_res_idx + 1;
            insert into public.lesson_resources (lesson_id, title, url, resource_type, position)
            values (
              v_lesson_id,
              trim(coalesce(nullif(v_res ->> 'title', ''), v_res ->> 'url')),
              trim(v_res ->> 'url'),
              coalesce(nullif(trim(v_res ->> 'resourceType'), ''), 'Guide'),
              v_res_idx
            )
            on conflict (lesson_id, url) do update set
              title = excluded.title,
              resource_type = excluded.resource_type,
              position = excluded.position;
          end if;
        end loop;
      end if;

      v_restored_lessons_cnt := v_restored_lessons_cnt + 1;
    end loop;
  end loop;

  for v_extra in
    select l.id, l.phase_id
    from public.lessons l
    join public.phases ph on ph.id = l.phase_id
    where ph.course_id = p_course_id
      and not (l.id = any(v_restored_lesson_ids))
  loop
    if exists (select 1 from public.lesson_progress lp where lp.lesson_id = v_extra.id)
       or exists (select 1 from public.quizzes q where q.lesson_id = v_extra.id)
       or exists (select 1 from public.activities a where a.lesson_id = v_extra.id) then
      select coalesce(max(position), 0) + 1 into v_max_pos
      from public.lessons
      where phase_id = v_extra.phase_id and position > 0;

      update public.lessons
      set publication_status = 'archived',
          position = greatest(1, v_max_pos)
      where id = v_extra.id;
      v_archived_extra_cnt := v_archived_extra_cnt + 1;
    else
      delete from public.lessons where id = v_extra.id;
      v_deleted_extra_cnt := v_deleted_extra_cnt + 1;
    end if;
  end loop;

  v_snap_course := coalesce(v_snap -> 'course', '{}'::jsonb);
  if jsonb_typeof(v_snap_course) = 'object' and (v_snap_course ? 'title') then
    update public.courses
    set title = coalesce(nullif(trim(v_snap_course ->> 'title'), ''), title),
        description = coalesce(v_snap_course ->> 'description', description),
        target_audience = coalesce(v_snap_course ->> 'targetAudience', target_audience),
        outcomes = coalesce(v_snap_course -> 'outcomes', outcomes),
        difficulty = coalesce(v_snap_course ->> 'difficulty', difficulty),
        estimated_duration_weeks = coalesce((v_snap_course ->> 'estimatedDurationWeeks')::integer, estimated_duration_weeks),
        recommended_weekly_hours = coalesce((v_snap_course ->> 'recommendedWeeklyHours')::numeric, recommended_weekly_hours),
        recommended_schedule = coalesce(v_snap_course ->> 'recommendedSchedule', recommended_schedule),
        prerequisites = coalesce(v_snap_course -> 'prerequisites', prerequisites),
        thumbnail_url = coalesce(v_snap_course ->> 'thumbnailUrl', thumbnail_url),
        author_name = coalesce(v_snap_course ->> 'authorName', author_name),
        completion_rules = coalesce(v_snap_course -> 'completionRules', completion_rules),
        publication_status = coalesce(v_snap_course ->> 'publicationStatus', publication_status),
        updated_at = now()
    where id = p_course_id;
  end if;

  insert into public.content_imports (
    course_id, actor_id, actor_email, operation_type, package_version, status,
    processed_count, created_count, updated_count, unchanged_count, rejected_count,
    snapshot_version_id, change_notes, details
  )
  values (
    p_course_id,
    auth.uid(),
    v_actor_email,
    'restore',
    '1.0',
    'restored',
    v_restored_lessons_cnt,
    0,
    v_restored_lessons_cnt,
    0,
    0,
    v_safety_ver_id,
    case when length(v_notes) > 0 then v_notes else 'Restored snapshot v' || v_target_ver.version_number end,
    jsonb_build_object(
      'restoredFromVersionId', p_version_id,
      'restoredFromVersionNumber', v_target_ver.version_number,
      'archivedExtraLessons', v_archived_extra_cnt,
      'deletedExtraLessons', v_deleted_extra_cnt
    )
  )
  returning id into v_restore_import_id;

  update public.course_versions
  set source_import_id = v_restore_import_id
  where id = v_safety_ver_id;

  perform public.record_admin_audit_log(
    'course_snapshot_restored',
    'courses',
    p_course_id::text,
    null,
    jsonb_build_object(
      'restoreImportId', v_restore_import_id,
      'restoredFromVersionId', p_version_id,
      'restoredFromVersionNumber', v_target_ver.version_number,
      'safetySnapshotVersionId', v_safety_ver_id,
      'restoredLessonsCount', v_restored_lessons_cnt,
      'archivedExtraLessonsCount', v_archived_extra_cnt,
      'deletedExtraLessonsCount', v_deleted_extra_cnt
    )
  );

  return jsonb_build_object(
    'restoreImportId', v_restore_import_id,
    'restoredFromVersionId', p_version_id,
    'restoredVersionNumber', v_target_ver.version_number,
    'safetySnapshotVersionId', v_safety_ver_id,
    'safetySnapshotVersionNumber', v_safety_ver_num,
    'restoredLessonsCount', v_restored_lessons_cnt,
    'archivedExtraLessonsCount', v_archived_extra_cnt,
    'deletedExtraLessonsCount', v_deleted_extra_cnt
  );
end;
$$;

revoke all on function public.admin_restore_course_snapshot(uuid, uuid, text) from public, anon;
grant execute on function public.admin_restore_course_snapshot(uuid, uuid, text) to authenticated;

