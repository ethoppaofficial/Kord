-- 03_functions.sql
-- Idempotent triggers, multi-format assessment grading, course completion, and skill verification RPCs

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text;
begin
  if lower(new.email) = 'ethoppaofficial@gmail.com' then
    assigned_role := 'admin';
  else
    assigned_role := 'learner';
  end if;

  insert into public.profiles (id, email, first_name, full_name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      split_part(coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), ' ', 1)
    ),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    assigned_role
  )
  on conflict (id) do update
    set email = excluded.email,
        first_name = coalesce(nullif(excluded.first_name, ''), public.profiles.first_name),
        role = case
          when lower(excluded.email) = 'ethoppaofficial@gmail.com' then 'admin'
          else public.profiles.role
        end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
  select level into current_level from public.user_skills
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

create or replace function public.declare_user_skill(p_skill_id uuid)
returns public.user_skills
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.user_skills;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  perform public.upgrade_user_skill_level(auth.uid(), p_skill_id, 'declared');
  select * into row_out from public.user_skills
  where user_id = auth.uid() and skill_id = p_skill_id;
  return row_out;
end;
$$;

-- Evaluate whether a course's completion rules are met and whether ALL published courses under parent skill are complete
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
  v_completion_state text := 'in_progress';
  v_course_done boolean := false;
  v_has_content boolean := false;
  v_skill_rec record;
  v_pub_courses integer := 0;
  v_done_verified_courses integer := 0;
begin
  select skill_id, coalesce(completion_rules, '{}'::jsonb)
  into v_primary_skill_id, v_rules
  from public.courses
  where id = p_course_id;

  if v_primary_skill_id is null then
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
    and a.is_required = true
    and ap.user_id = p_user_id
    and ap.completed = true;

  select count(*) into v_req_quizzes
  from public.quizzes where course_id = p_course_id;

  select count(distinct qa.quiz_id) into v_passed_quizzes
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where q.course_id = p_course_id
    and qa.user_id = p_user_id
    and qa.passed = true
    and qa.review_status <> 'pending_review';

  select count(*) into v_req_challenges
  from public.challenges where course_id = p_course_id and is_required = true;

  select count(distinct s.challenge_id) into v_submitted_challenges
  from public.submissions s
  join public.challenges c on c.id = s.challenge_id
  where c.course_id = p_course_id and s.user_id = p_user_id;

  select count(distinct s.challenge_id) into v_approved_challenges
  from public.submissions s
  join public.challenges c on c.id = s.challenge_id
  where c.course_id = p_course_id and s.user_id = p_user_id and s.status = 'approved';

  v_has_content := (v_req_lessons + v_req_activities + v_req_quizzes + v_req_challenges) > 0;
  v_lessons_ok := coalesce((v_rules ->> 'requireAllRequiredLessons')::boolean, true) = false or v_done_lessons >= v_req_lessons;
  v_activities_ok := coalesce((v_rules ->> 'requireAllActivities')::boolean, true) = false or v_done_activities >= v_req_activities;
  v_quizzes_ok := coalesce((v_rules ->> 'requireAllAssessments')::boolean, true) = false or v_passed_quizzes >= v_req_quizzes;
  v_challenges_sub_ok := coalesce((v_rules ->> 'requireChallengeSubmission')::boolean, true) = false or v_submitted_challenges >= v_req_challenges;
  v_challenges_app_ok := coalesce((v_rules ->> 'requireChallengeApproval')::boolean, true) = false or v_approved_challenges >= v_req_challenges;
  v_practical_approved := v_req_challenges > 0 and v_approved_challenges >= v_req_challenges;
  v_instructional_done := v_has_content and v_lessons_ok and v_activities_ok and v_quizzes_ok;

  if v_instructional_done then
    if coalesce((v_rules ->> 'requireChallengeApproval')::boolean, true) and v_req_challenges > 0 then
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
  set status = case when v_course_done then 'completed' else status end,
      completion_state = v_completion_state,
      completed_at = case when v_course_done then coalesce(completed_at, now()) else completed_at end,
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
    completed_at = coalesce(public.course_completions.completed_at, excluded.completed_at),
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
  v_results jsonb := '[]'::jsonb;
  v_existing public.quiz_attempts;
  v_attempt_id uuid;
  v_attempt_num integer := 1;
  v_is_correct boolean;
  v_sel_sorted jsonb;
  v_exp_sorted jsonb;
  v_clean_answers jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Learner authentication required';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.quiz_attempts
    where user_id = auth.uid() and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'attemptId', v_existing.id,
        'quizId', v_existing.quiz_id,
        'attemptNumber', v_existing.attempt_number,
        'score', v_existing.score,
        'total', v_existing.total,
        'percentage', v_existing.percentage,
        'passed', v_existing.passed,
        'reviewStatus', v_existing.review_status,
        'results', '[]'::jsonb
      );
    end if;
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

    if not exists (
      select 1 from public.course_enrollments
      where user_id = auth.uid()
        and course_id = v_quiz.course_id
        and status in ('active', 'completed')
    ) then
      raise exception 'Active course enrollment required to submit this assessment';
    end if;
  end if;

  select count(*) + 1 into v_attempt_num
  from public.quiz_attempts where user_id = auth.uid() and quiz_id = p_quiz_id;

  if v_quiz.max_attempts is not null and (v_attempt_num - 1) >= v_quiz.max_attempts then
    raise exception 'Maximum number of attempts reached for this assessment';
  end if;

  for v_q in
    select id, position, question_type, marks, prompt, options, correct_index, answer_config, explanation
    from public.questions
    where quiz_id = p_quiz_id
    order by position asc
  loop
    v_total := v_total + coalesce(v_q.marks, 1);
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
      v_score := v_score + coalesce(v_q.marks, 1);
    end if;

    v_results := v_results || jsonb_build_object(
      'questionId', v_q.id,
      'questionType', v_q.question_type,
      'marks', coalesce(v_q.marks, 1),
      'earnedMarks', case when v_is_correct then coalesce(v_q.marks, 1) else 0 end,
      'isCorrect', v_is_correct,
      'pendingReview', v_q.question_type in ('short_answer', 'long_form', 'practical_submission'),
      'correctIndex', v_q.correct_index,
      'answerConfig', v_q.answer_config,
      'explanation', v_q.explanation
    );
  end loop;

  if v_total > 0 then
    v_pct := round((v_score::numeric / v_total::numeric) * 100);
  end if;

  if v_has_manual or v_quiz.requires_manual_review then
    v_review_status := 'pending_review';
    v_passed := false;
  else
    v_passed := v_pct >= v_quiz.pass_percent;
  end if;

  insert into public.quiz_attempts (
    user_id, quiz_id, course_id, attempt_number, answers, score, total, percentage, passed, review_status, idempotency_key
  )
  values (
    auth.uid(), p_quiz_id, v_quiz.course_id, v_attempt_num, v_clean_answers, v_score, v_total, v_pct, v_passed, v_review_status, p_idempotency_key
  )
  on conflict (user_id, idempotency_key) do update set score = excluded.score
  returning id into v_attempt_id;

  if v_passed then
    perform public.upgrade_user_skill_level(auth.uid(), v_quiz.skill_id, 'practising');
    if v_quiz.course_id is not null then
      perform public.evaluate_course_and_skill_progression(auth.uid(), v_quiz.course_id);
    elsif v_quiz.quiz_type in ('skill_check', 'course_exam') then
      perform public.upgrade_user_skill_level(auth.uid(), v_quiz.skill_id, 'demonstrated');
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
    'results', v_results
  );
end;
$$;

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
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_status not in ('approved', 'needs_revision') then
    raise exception 'Invalid status';
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

  update public.submissions
  set status = p_status,
      rubric_scores = v_clean_scores,
      rubric_total = v_calc_total,
      rubric_max = v_calc_max,
      feedback = trim(coalesce(p_feedback, '')),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_submission_id
  returning * into v_sub;

  if v_sub.status = 'approved' then
    if v_challenge.course_id is not null then
      perform public.evaluate_course_and_skill_progression(v_sub.user_id, v_challenge.course_id);
    elsif v_challenge.skill_id is not null then
      perform public.upgrade_user_skill_level(v_sub.user_id, v_challenge.skill_id, 'verified');
    end if;
  end if;

  return v_sub;
end;
$$;

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
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_id is not null then
    update public.questions
    set position = coalesce(p_position, position),
        question_type = coalesce(p_question_type, question_type),
        difficulty = coalesce(p_difficulty, difficulty),
        marks = greatest(1, coalesce(p_marks, marks)),
        prompt = p_prompt,
        context_text = coalesce(p_context_text, ''),
        options = coalesce(p_options, '[]'::jsonb),
        correct_index = greatest(0, coalesce(p_correct_index, 0)),
        answer_config = coalesce(p_answer_config, '{}'::jsonb),
        explanation = coalesce(p_explanation, '')
    where id = p_id
    returning * into v_row;
    if found then return v_row; end if;
  end if;

  insert into public.questions (
    quiz_id, position, question_type, difficulty, marks, prompt, context_text, options, correct_index, answer_config, explanation
  )
  values (
    p_quiz_id, coalesce(p_position, 1), coalesce(p_question_type, 'multiple_choice'), coalesce(p_difficulty, 'medium'),
    greatest(1, coalesce(p_marks, 1)), p_prompt, coalesce(p_context_text, ''), coalesce(p_options, '[]'::jsonb),
    greatest(0, coalesce(p_correct_index, 0)), coalesce(p_answer_config, '{}'::jsonb), coalesce(p_explanation, '')
  )
  returning * into v_row;
  return v_row;
end;
$$;

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
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  foreach v_pid in array p_phase_ids loop
    update public.phases
    set position = v_idx
    where id = v_pid and course_id = p_course_id;
    v_idx := v_idx + 1;
  end loop;

  update public.courses set updated_at = now() where id = p_course_id;
end;
$$;

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
  v_ver_row public.course_versions;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
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

  update public.courses
  set version = v_next_ver, updated_at = now()
  where id = p_course_id;

  insert into public.course_versions (course_id, version_number, change_notes, snapshot, created_by)
  values (
    p_course_id,
    v_next_ver,
    coalesce(p_change_notes, ''),
    jsonb_build_object(
      'title', v_course.title,
      'difficulty', v_course.difficulty,
      'phaseCount', v_phase_cnt,
      'lessonCount', v_lesson_cnt
    ),
    auth.uid()
  )
  on conflict (course_id, version_number) do update set change_notes = excluded.change_notes
  returning * into v_ver_row;

  return v_ver_row;
end;
$$;
