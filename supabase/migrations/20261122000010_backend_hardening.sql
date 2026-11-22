-- 20261122000010_backend_hardening.sql
-- Forward-only backend hardening pass:
--   - Least-privilege table/column grants & admin RPC question mutations
--   - Explicit course progression & skill recomputation (quizzes never grant 'demonstrated')
--   - Curriculum change recalculation triggers
--   - Hardened quiz grading, concurrency lock, & question answer validation
--   - Challenge evidence-type, MIME-type, size, ownership, & storage metadata checks
--   - Complete real-data dashboard contract (enrolledCourses, averageScore, weeklyMinutes, hourlyDistribution)

-- ---------------------------------------------------------------------------
-- 1. Least-Privilege Grants & Defense-in-Depth Table Permissions
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.profiles,
  public.categories,
  public.skills,
  public.courses,
  public.course_skills,
  public.course_versions,
  public.phases,
  public.lessons,
  public.lesson_resources,
  public.activities,
  public.quizzes,
  public.questions,
  public.challenges,
  public.course_enrollments,
  public.course_completions,
  public.lesson_progress,
  public.enrollments,
  public.activity_progress,
  public.quiz_attempts,
  public.submissions,
  public.user_skills,
  public.opportunities
from public, anon;

revoke select on
  public.profiles,
  public.course_versions,
  public.quizzes,
  public.questions,
  public.challenges,
  public.course_enrollments,
  public.course_completions,
  public.lesson_progress,
  public.enrollments,
  public.activity_progress,
  public.quiz_attempts,
  public.submissions,
  public.user_skills
from anon;

grant select on
  public.categories,
  public.skills,
  public.courses,
  public.course_skills,
  public.phases,
  public.lessons,
  public.lesson_resources,
  public.activities,
  public.opportunities
to anon, authenticated;

grant select on
  public.course_versions,
  public.quizzes,
  public.challenges
to authenticated;

-- Admin CMS mutations on catalog tables run as authenticated and are gated strictly by catalog_admin_* RLS policies (public.is_admin())
grant insert, update, delete on
  public.categories,
  public.skills,
  public.courses,
  public.course_skills,
  public.course_versions,
  public.phases,
  public.lessons,
  public.lesson_resources,
  public.activities,
  public.quizzes,
  public.challenges,
  public.opportunities
to authenticated;

-- Questions must be mutated solely via validated SECURITY DEFINER RPCs (admin_upsert_question / admin_delete_question)
revoke all on public.questions from public, anon, authenticated;
grant select (id, quiz_id, position, question_type, difficulty, marks, prompt, context_text, options)
  on public.questions to authenticated;

-- Anon-accessible catalog SELECT policies must NOT invoke public.is_admin() because
-- execute on is_admin() is intentionally revoked from anon; admins already retain full
-- SELECT/write access via the companion catalog_admin_* policies.
drop policy if exists "catalog_read_skills" on public.skills;
create policy "catalog_read_skills" on public.skills
  for select to authenticated, anon
  using (publication_status = 'published');

drop policy if exists "catalog_read_courses" on public.courses;
create policy "catalog_read_courses" on public.courses
  for select to authenticated, anon
  using (publication_status = 'published');

drop policy if exists "catalog_read_course_skills" on public.course_skills;
create policy "catalog_read_course_skills" on public.course_skills
  for select to authenticated, anon
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_skills.course_id and c.publication_status = 'published'
    )
  );

drop policy if exists "catalog_read_phases" on public.phases;
create policy "catalog_read_phases" on public.phases
  for select to authenticated, anon
  using (
    publication_status = 'published'
    and exists (
      select 1 from public.courses c
      where c.id = phases.course_id and c.publication_status = 'published'
    )
  );

drop policy if exists "catalog_read_lessons" on public.lessons;
create policy "catalog_read_lessons" on public.lessons
  for select to authenticated, anon
  using (
    publication_status = 'published'
    and exists (
      select 1
      from public.phases p
      join public.courses c on c.id = p.course_id
      where p.id = lessons.phase_id
        and p.publication_status = 'published'
        and c.publication_status = 'published'
    )
  );

drop policy if exists "catalog_read_lesson_resources" on public.lesson_resources;
create policy "catalog_read_lesson_resources" on public.lesson_resources
  for select to authenticated, anon
  using (
    exists (
      select 1
      from public.lessons l
      join public.phases p on p.id = l.phase_id
      join public.courses c on c.id = p.course_id
      where l.id = lesson_resources.lesson_id
        and l.publication_status = 'published'
        and p.publication_status = 'published'
        and c.publication_status = 'published'
    )
  );

drop policy if exists "catalog_read_activities" on public.activities;
create policy "catalog_read_activities" on public.activities
  for select to authenticated, anon
  using (
    exists (
      select 1
      from public.phases p
      join public.courses c on c.id = p.course_id
      where p.id = activities.phase_id
        and p.publication_status = 'published'
        and c.publication_status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Skill Recomputation & Explicit Progression Engine
--    Rule: Quizzes and knowledge-only courses upgrade skills at most to 'practising'.
--          'demonstrated' / 'verified' strictly require practical approval.
-- ---------------------------------------------------------------------------
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
          -- Theory / non-practical completion ends at 'completed' (skill remains at 'practising', never 'demonstrated')
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
-- 3. Hardened Assessment Question & Attempt RPCs
-- ---------------------------------------------------------------------------
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
  v_exp_order jsonb;
  v_clean_answers jsonb := '{}'::jsonb;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_replay boolean := false;
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

  -- Prevent concurrent double-attempt races bypassing max_attempts
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

  -- Knowledge assessments advance to practising; demonstrated/verified strictly require practical course/challenge completion
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

  -- Always re-evaluate progression so both upgrades and downward grade adjustments propagate
  if v_quiz.course_id is not null then
    perform public.evaluate_course_and_skill_progression(v_att.user_id, v_quiz.course_id);
  end if;
  perform public.recompute_user_skill_level(v_att.user_id, v_quiz.skill_id);

  return v_att;
end;
$$;

revoke all on function public.admin_grade_attempt(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_grade_attempt(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Hardened Practical Submissions & Storage Validation
-- ---------------------------------------------------------------------------
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
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
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

-- Tighten storage object upload checks to disallow leading slashes and enforce path structure
drop policy if exists "evidence_upload_own_folder" on storage.objects;
create policy "evidence_upload_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'evidence'
  and not public.is_admin()
  and position('..' in name) = 0
  and left(name, 1) <> '/'
  and coalesce(array_length(string_to_array(name, '/'), 1), 0) >= 2
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) = any(array[
    'pdf','png','jpg','jpeg','webp','txt','md','csv','zip','docx',
    'mp3','wav','m4a','webm','ogg','mp4','mov'
  ])
);

-- ---------------------------------------------------------------------------
-- 5. Complete Real-Data Unified Dashboard Contract
-- ---------------------------------------------------------------------------
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
