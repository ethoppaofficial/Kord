import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';

/**
 * Learner-safe quiz loader.
 * NEVER returns correctIndex or explanation before submission.
 */
export async function getQuizForLearner(quizId) {
  if (!isDemoMode && supabase) {
    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('id, skill_id, phase_id, quiz_type, title, description, pass_percent')
      .eq('id', quizId)
      .single();
    if (error || !quiz) return null;

    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('id, quiz_id, position, prompt, options')
      .eq('quiz_id', quizId)
      .order('position');
    if (qErr) throw qErr;

    return {
      id: quiz.id,
      skillId: quiz.skill_id,
      phaseId: quiz.phase_id,
      quizType: quiz.quiz_type,
      title: quiz.title,
      description: quiz.description,
      passPercent: quiz.pass_percent,
      questions: questions || [],
    };
  }

  const state = getDemoState();
  const quiz = state.quizzes.find((q) => q.id === quizId);
  if (!quiz) return null;
  const skill = state.skills.find((s) => s.id === quiz.skillId) || null;

  return {
    id: quiz.id,
    skillId: quiz.skillId,
    skill,
    phaseId: quiz.phaseId,
    quizType: quiz.quizType,
    title: quiz.title,
    description: quiz.description,
    passPercent: quiz.passPercent,
    questions: (quiz.questions || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((q) => ({
        id: q.id,
        position: q.position,
        prompt: q.prompt,
        options: q.options,
      })),
  };
}

export async function getQuizAttempts(userId, quizId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', userId)
      .eq('quiz_id', quizId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map((a) => ({
      id: a.id,
      userId: a.user_id,
      quizId: a.quiz_id,
      score: a.score,
      total: a.total,
      percentage: a.percentage,
      passed: a.passed,
      createdAt: a.created_at,
    }));
  }

  return getDemoState()
    .quizAttempts.filter((a) => a.userId === userId && a.quizId === quizId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function submitQuiz(userId, quizId, answersMap, idempotencyKey = null) {
  const effectiveKey =
    idempotencyKey || buildIdempotencyKey('quiz-submit', userId, quizId, JSON.stringify(answersMap));

  return runIdempotent(
    effectiveKey,
    async () => {
      if (!isDemoMode && supabase) {
        const { data, error } = await supabase.rpc('submit_quiz', {
          p_quiz_id: quizId,
          p_answers: answersMap,
          p_idempotency_key: effectiveKey,
        });
        if (error) throw error;
        return data;
      }

      const state = getDemoState();
      const quiz = state.quizzes.find((q) => q.id === quizId);
      if (!quiz) throw new Error('Quiz not found');

      let score = 0;
      const results = (quiz.questions || []).map((q) => {
        const answerKey = state.privateQuizAnswers[q.id];
        const selectedIndex = Number.isInteger(answersMap[q.id]) ? answersMap[q.id] : -1;
        const correctIndex = answerKey ? answerKey.correctIndex : 0;
        const isCorrect = selectedIndex === correctIndex;
        if (isCorrect) score += 1;
        return {
          questionId: q.id,
          selectedIndex,
          correctIndex,
          isCorrect,
          explanation: answerKey ? answerKey.explanation : '',
        };
      });

      const total = quiz.questions.length;
      const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
      const passed = percentage >= quiz.passPercent;

      // Deduplicate if an identical idempotencyKey already exists
      const existing = state.quizAttempts.find(
        (a) => a.userId === userId && a.idempotencyKey === effectiveKey
      );
      if (existing) {
        return {
          attemptId: existing.id,
          quizId,
          score: existing.score,
          total: existing.total,
          percentage: existing.percentage,
          passed: existing.passed,
          results,
        };
      }

      const attemptId = `qa-${Date.now()}`;
      updateDemoState((draft) => {
        draft.quizAttempts.push({
          id: attemptId,
          userId,
          quizId,
          answers: answersMap,
          score,
          total,
          percentage,
          passed,
          idempotencyKey: effectiveKey,
          createdAt: new Date().toISOString(),
        });
        return draft;
      });

      if (passed) {
        const targetLevel = quiz.quizType === 'skill_check' ? 'demonstrated' : 'practising';
        await upgradeSkillLevel(userId, quiz.skillId, targetLevel);
      }

      return {
        attemptId,
        quizId,
        score,
        total,
        percentage,
        passed,
        results,
      };
    },
    { cacheResult: true }
  );
}

// Protected admin quiz question APIs
export async function adminListAllQuizzes() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*, skills(title, slug)')
      .order('title');
    if (error) throw error;
    return data;
  }

  const state = getDemoState();
  return state.quizzes.map((q) => ({
    ...q,
    skillTitle: state.skills.find((s) => s.id === q.skillId)?.title || 'Skill',
  }));
}

export async function adminGetQuizQuestions(quizId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('admin_get_quiz_questions', { p_quiz_id: quizId });
    if (error) throw error;
    return data.map((q) => ({
      id: q.id,
      quizId: q.quiz_id,
      position: q.position,
      prompt: q.prompt,
      options: q.options,
      correctIndex: q.correct_index,
      explanation: q.explanation,
    }));
  }

  const state = getDemoState();
  const quiz = state.quizzes.find((q) => q.id === quizId);
  if (!quiz) return [];
  return (quiz.questions || []).map((q) => ({
    ...q,
    correctIndex: state.privateQuizAnswers[q.id]?.correctIndex ?? 0,
    explanation: state.privateQuizAnswers[q.id]?.explanation ?? '',
  }));
}

export async function adminUpsertQuestion({ id, quizId, prompt, options, correctIndex, explanation }) {
  const key = buildIdempotencyKey('admin-question', id || quizId, prompt);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('admin_upsert_question', {
        p_id: id || null,
        p_quiz_id: quizId,
        p_position: Date.now() % 1000,
        p_prompt: prompt,
        p_options: options,
        p_correct_index: Number(correctIndex),
        p_explanation: explanation,
      });
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const quiz = draft.quizzes.find((q) => q.id === quizId);
      if (!quiz) throw new Error('Quiz not found');

      const existing = id
        ? quiz.questions.find((q) => q.id === id)
        : quiz.questions.find((q) => q.prompt.trim().toLowerCase() === prompt.trim().toLowerCase());

      const questionId = existing ? existing.id : id || `q-${Date.now()}`;
      if (existing) {
        existing.prompt = prompt.trim();
        existing.options = options;
      } else {
        quiz.questions.push({
          id: questionId,
          position: quiz.questions.length + 1,
          prompt: prompt.trim(),
          options,
        });
      }

      draft.privateQuizAnswers[questionId] = {
        correctIndex: Number(correctIndex),
        explanation: explanation || '',
      };
      return draft;
    });
  });
}

export async function adminDeleteQuestion(quizId, questionId) {
  const key = buildIdempotencyKey('admin-q-del', quizId, questionId);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.from('questions').delete().eq('id', questionId);
      if (error) throw error;
      return;
    }

    updateDemoState((draft) => {
      const quiz = draft.quizzes.find((q) => q.id === quizId);
      if (!quiz) return draft;
      quiz.questions = quiz.questions.filter((q) => q.id !== questionId);
      delete draft.privateQuizAnswers[questionId];
      return draft;
    });
  });
}
