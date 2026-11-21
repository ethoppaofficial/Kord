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
