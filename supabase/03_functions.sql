-- 03_functions.sql
-- Idempotent triggers, idempotent quiz grading RPC, and actor-separated skill progression

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
  v_selected integer;
  v_score integer := 0;
  v_total integer := 0;
  v_pct integer := 0;
  v_passed boolean := false;
  v_results jsonb := '[]'::jsonb;
  v_existing public.quiz_attempts;
  v_attempt_id uuid;
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
        'results', '[]'::jsonb
      );
    end if;
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Quiz not found';
  end if;

  for v_q in
    select id, position, prompt, options, correct_index, explanation
    from public.questions
    where quiz_id = p_quiz_id
    order by position asc
  loop
    v_total := v_total + 1;
    v_selected := coalesce((p_answers ->> (v_q.id::text))::integer, -1);
    if v_selected = v_q.correct_index then
      v_score := v_score + 1;
    end if;

    v_results := v_results || jsonb_build_object(
      'questionId', v_q.id,
      'selectedIndex', v_selected,
      'correctIndex', v_q.correct_index,
      'isCorrect', (v_selected = v_q.correct_index),
      'explanation', v_q.explanation
    );
  end loop;

  if v_total > 0 then
    v_pct := round((v_score::numeric / v_total::numeric) * 100);
  end if;
  v_passed := v_pct >= v_quiz.pass_percent;

  insert into public.quiz_attempts (user_id, quiz_id, answers, score, total, percentage, passed, idempotency_key)
  values (auth.uid(), p_quiz_id, p_answers, v_score, v_total, v_pct, v_passed, p_idempotency_key)
  on conflict (user_id, idempotency_key) do update set score = excluded.score
  returning id into v_attempt_id;

  if v_passed then
    if v_quiz.quiz_type = 'skill_check' then
      perform public.upgrade_user_skill_level(auth.uid(), v_quiz.skill_id, 'demonstrated');
    else
      perform public.upgrade_user_skill_level(auth.uid(), v_quiz.skill_id, 'practising');
    end if;
  end if;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'quizId', p_quiz_id,
    'score', v_score,
    'total', v_total,
    'percentage', v_pct,
    'passed', v_passed,
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
    select skill_id into v_skill_id from public.challenges where id = v_sub.challenge_id;
    if v_skill_id is not null then
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

create or replace function public.admin_upsert_question(
  p_id uuid,
  p_quiz_id uuid,
  p_position integer,
  p_prompt text,
  p_options jsonb,
  p_correct_index integer,
  p_explanation text
)
returns public.questions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.questions;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_id is null then
    insert into public.questions (quiz_id, position, prompt, options, correct_index, explanation)
    values (p_quiz_id, p_position, p_prompt, p_options, p_correct_index, p_explanation)
    returning * into v_q;
  else
    update public.questions
    set position = p_position,
        prompt = p_prompt,
        options = p_options,
        correct_index = p_correct_index,
        explanation = p_explanation
    where id = p_id
    returning * into v_q;
  end if;

  return v_q;
end;
$$;
