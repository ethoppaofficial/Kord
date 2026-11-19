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
  v_skill_id uuid;
  v_req_lessons integer := 0;
  v_done_lessons integer := 0;
  v_req_quizzes integer := 0;
  v_passed_quizzes integer := 0;
  v_req_challenges integer := 0;
  v_approved_challenges integer := 0;
  v_course_done boolean := false;
  v_pub_courses integer := 0;
  v_done_courses integer := 0;
begin
  select skill_id into v_skill_id from public.courses where id = p_course_id;
  if v_skill_id is null then
    return;
  end if;

  select count(*) into v_req_lessons
  from public.lessons l
  join public.phases p on p.id = l.phase_id
  where p.course_id = p_course_id and l.is_required = true;

  select count(*) into v_done_lessons
  from public.lesson_progress lp
  join public.lessons l on l.id = lp.lesson_id
  join public.phases p on p.id = l.phase_id
  where p.course_id = p_course_id and l.is_required = true and lp.user_id = p_user_id and lp.completed = true;

  select count(*) into v_req_quizzes
  from public.quizzes where course_id = p_course_id;

  select count(distinct qa.quiz_id) into v_passed_quizzes
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where q.course_id = p_course_id and qa.user_id = p_user_id and qa.passed = true and qa.review_status <> 'pending_review';

  select count(*) into v_req_challenges
  from public.challenges where course_id = p_course_id;

  select count(distinct s.challenge_id) into v_approved_challenges
  from public.submissions s
  join public.challenges c on c.id = s.challenge_id
  where c.course_id = p_course_id and s.user_id = p_user_id and s.status = 'approved';

  v_course_done := (v_done_lessons >= v_req_lessons)
                   and (v_passed_quizzes >= v_req_quizzes)
                   and (v_approved_challenges >= v_req_challenges);

  if v_course_done then
    update public.course_enrollments
    set status = 'completed',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where user_id = p_user_id and course_id = p_course_id;

    perform public.upgrade_user_skill_level(p_user_id, v_skill_id, 'demonstrated');
  end if;

  select count(*) into v_pub_courses
  from public.courses
  where skill_id = v_skill_id and publication_status = 'published';

  select count(*) into v_done_courses
  from public.course_enrollments ce
  join public.courses c on c.id = ce.course_id
  where c.skill_id = v_skill_id and c.publication_status = 'published'
    and ce.user_id = p_user_id and ce.status = 'completed';

  if v_pub_courses > 0 and v_done_courses >= v_pub_courses then
    perform public.upgrade_user_skill_level(p_user_id, v_skill_id, 'verified');
  end if;
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
  v_selected integer;
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

    if v_q.question_type in ('short_answer', 'long_form', 'practical_submission') then
      v_has_manual := true;
    elsif v_q.question_type = 'multiple_select' then
      v_is_correct := coalesce(v_raw, '[]'::jsonb) = coalesce(v_q.answer_config -> 'correctIndices', '[]'::jsonb);
    elsif v_q.question_type = 'fill_blank' then
      v_is_correct := exists (
        select 1
        from jsonb_array_elements_text(coalesce(v_q.answer_config -> 'acceptedAnswers', '[]'::jsonb)) acc
        where lower(trim(acc)) = lower(trim(coalesce(v_raw #>> '{}', '')))
      );
    elsif v_q.question_type = 'ordering' then
      v_is_correct := coalesce(v_raw, '[]'::jsonb) = coalesce(v_q.answer_config -> 'correctOrder', '[]'::jsonb);
    else
      v_selected := coalesce((v_raw #>> '{}')::integer, -1);
      v_is_correct := (v_selected = v_q.correct_index);
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
    auth.uid(), p_quiz_id, v_quiz.course_id, v_attempt_num, p_answers, v_score, v_total, v_pct, v_passed, v_review_status, p_idempotency_key
  )
  on conflict (user_id, idempotency_key) do update set score = excluded.score
  returning id into v_attempt_id;

  if v_passed then
    if v_quiz.quiz_type in ('skill_check', 'course_exam') then
      perform public.upgrade_user_skill_level(auth.uid(), v_quiz.skill_id, 'demonstrated');
    else
      perform public.upgrade_user_skill_level(auth.uid(), v_quiz.skill_id, 'practising');
    end if;
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
  v_skill_id uuid;
  v_course_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_status not in ('approved', 'needs_revision') then
    raise exception 'Invalid status';
  end if;

  update public.submissions
  set status = p_status,
      rubric_scores = p_rubric_scores,
      rubric_total = p_rubric_total,
      rubric_max = p_rubric_max,
      feedback = p_feedback,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_submission_id
  returning * into v_sub;

  if v_sub.status = 'approved' then
    select skill_id, course_id into v_skill_id, v_course_id from public.challenges where id = v_sub.challenge_id;
    if v_course_id is not null then
      perform public.evaluate_course_and_skill_progression(v_sub.user_id, v_course_id);
    elsif v_skill_id is not null then
      perform public.upgrade_user_skill_level(v_sub.user_id, v_skill_id, 'verified');
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
