import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { recomputeCourseAndSkillStatus } from './progressRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import { gradeAssessmentAttempt } from '../assessmentEngine.js';

export async function listAssessmentsForCourse(courseId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quizzes')
      .select('id, skill_id, course_id, phase_id, lesson_id, quiz_type, title, description, pass_percent, time_limit_minutes, max_attempts')
      .eq('course_id', courseId);
    if (error) throw error;
    return (data || []).map((q) => ({
      id: q.id,
      skillId: q.skill_id,
      courseId: q.course_id,
      phaseId: q.phase_id,
      lessonId: q.lesson_id,
      quizType: q.quiz_type,
      title: q.title,
      description: q.description,
      passPercent: q.pass_percent,
      timeLimitMinutes: q.time_limit_minutes,
      maxAttempts: q.max_attempts,
    }));
  }
  return (getDemoState().quizzes || []).filter((q) => q.courseId === courseId);
}

/**
 * Learner-safe assessment loader.
 * NEVER returns correctIndex, answerConfig, or explanation before submission.
 */
export async function getQuizForLearner(quizId) {
  if (!isDemoMode && supabase) {
    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('id, skill_id, course_id, phase_id, lesson_id, quiz_type, title, description, pass_percent, time_limit_minutes, max_attempts, shuffle_questions, requires_manual_review, skills(id, slug, title), courses(id, slug, title)')
      .eq('id', quizId)
      .single();
    if (error || !quiz) return null;

    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('id, quiz_id, position, question_type, difficulty, marks, prompt, context_text, options')
      .eq('quiz_id', quizId)
      .order('position');
    if (qErr) throw qErr;

    return {
      id: quiz.id,
      skillId: quiz.skill_id,
      skill: quiz.skills || null,
      courseId: quiz.course_id,
      course: quiz.courses || null,
      phaseId: quiz.phase_id,
      lessonId: quiz.lesson_id,
      quizType: quiz.quiz_type,
      title: quiz.title,
      description: quiz.description,
      passPercent: quiz.pass_percent,
      timeLimitMinutes: quiz.time_limit_minutes,
      maxAttempts: quiz.max_attempts,
      shuffleQuestions: Boolean(quiz.shuffle_questions),
      requiresManualReview: Boolean(quiz.requires_manual_review),
      questions: (questions || []).map((q) => ({
        id: q.id,
        position: q.position,
        questionType: q.question_type || 'multiple_choice',
        difficulty: q.difficulty || 'medium',
        marks: Number(q.marks || 1),
        prompt: q.prompt,
        contextText: q.context_text || '',
        options: q.options || [],
      })),
    };
  }

  const state = getDemoState();
  const quiz = (state.quizzes || []).find((q) => q.id === quizId);
  if (!quiz) return null;
  const skill = (state.skills || []).find((s) => s.id === quiz.skillId) || null;
  const course = quiz.courseId ? (state.courses || []).find((c) => c.id === quiz.courseId) || null : null;

  return {
    id: quiz.id,
    skillId: quiz.skillId,
    skill,
    courseId: quiz.courseId || null,
    course,
    phaseId: quiz.phaseId || null,
    lessonId: quiz.lessonId || null,
    quizType: quiz.quizType,
    title: quiz.title,
    description: quiz.description,
    passPercent: quiz.passPercent,
    timeLimitMinutes: quiz.timeLimitMinutes || null,
    maxAttempts: quiz.maxAttempts || null,
    shuffleQuestions: Boolean(quiz.shuffleQuestions),
    requiresManualReview: Boolean(quiz.requiresManualReview),
    questions: (quiz.questions || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((q) => ({
        id: q.id,
        position: q.position,
        questionType: q.questionType || 'multiple_choice',
        difficulty: q.difficulty || 'medium',
        marks: Number(q.marks || 1),
        prompt: q.prompt,
        contextText: q.contextText || '',
        options: q.options || [],
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
    return (data || []).map((a) => ({
      id: a.id,
      userId: a.user_id,
      quizId: a.quiz_id,
      attemptNumber: a.attempt_number || 1,
      score: a.score,
      total: a.total,
      percentage: a.percentage,
      passed: a.passed,
      reviewStatus: a.review_status || 'auto_graded',
      manualFeedback: a.manual_feedback || '',
      createdAt: a.created_at,
    }));
  }

  return (getDemoState().quizAttempts || [])
    .filter((a) => a.userId === userId && a.quizId === quizId)
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
      const quiz = (state.quizzes || []).find((q) => q.id === quizId);
      if (!quiz) throw new Error('Assessment not found');

      // Deduplicate identical double-click / replay submissions
      const existing = (state.quizAttempts || []).find(
        (a) => a.userId === userId && a.idempotencyKey === effectiveKey
      );
      if (existing) {
        const gradedReplay = gradeAssessmentAttempt({
          quiz,
          questions: quiz.questions || [],
          answerKeysByQuestionId: state.privateQuizAnswers || {},
          answersMap: existing.answers || answersMap,
        });
        return {
          attemptId: existing.id,
          quizId,
          attemptNumber: existing.attemptNumber || 1,
          score: existing.score,
          total: existing.total,
          percentage: existing.percentage,
          passed: existing.passed,
          reviewStatus: existing.reviewStatus || gradedReplay.reviewStatus,
          results: gradedReplay.results,
        };
      }

      const priorAttempts = (state.quizAttempts || []).filter(
        (a) => a.userId === userId && a.quizId === quizId
      );
      if (quiz.maxAttempts && priorAttempts.length >= quiz.maxAttempts) {
        throw new Error(`Maximum allowed attempts (${quiz.maxAttempts}) reached for this assessment.`);
      }

      const graded = gradeAssessmentAttempt({
        quiz,
        questions: quiz.questions || [],
        answerKeysByQuestionId: state.privateQuizAnswers || {},
        answersMap,
      });

      const attemptId = `qa-${Date.now()}`;
      const attemptNumber = priorAttempts.length + 1;

      updateDemoState((draft) => {
        draft.quizAttempts = draft.quizAttempts || [];
        draft.quizAttempts.push({
          id: attemptId,
          userId,
          quizId,
          attemptNumber,
          answers: answersMap,
          score: graded.score,
          total: graded.total,
          percentage: graded.percentage,
          passed: graded.passed,
          reviewStatus: graded.reviewStatus,
          manualScores: {},
          manualFeedback: '',
          idempotencyKey: effectiveKey,
          createdAt: new Date().toISOString(),
        });
        return draft;
      });

      if (graded.passed && graded.reviewStatus !== 'pending_review') {
        if (quiz.courseId) {
          await recomputeCourseAndSkillStatus(userId, quiz.courseId);
        } else {
          const targetLevel = quiz.quizType === 'skill_check' ? 'demonstrated' : 'practising';
          await upgradeSkillLevel(userId, quiz.skillId, targetLevel);
        }
      }

      return {
        attemptId,
        quizId,
        attemptNumber,
        score: graded.score,
        total: graded.total,
        percentage: graded.percentage,
        passed: graded.passed,
        reviewStatus: graded.reviewStatus,
        results: graded.results,
      };
    },
    { cacheResult: true }
  );
}

// =========================================================================
// Protected Admin Assessment & Grading APIs
// =========================================================================
export async function adminListAllQuizzes() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*, skills(title, slug), courses(title, slug)')
      .order('title');
    if (error) throw error;
    return (data || []).map((q) => ({
      id: q.id,
      skillId: q.skill_id,
      courseId: q.course_id,
      phaseId: q.phase_id,
      lessonId: q.lesson_id,
      quizType: q.quiz_type,
      title: q.title,
      description: q.description,
      passPercent: q.pass_percent,
      timeLimitMinutes: q.time_limit_minutes,
      maxAttempts: q.max_attempts,
      shuffleQuestions: Boolean(q.shuffle_questions),
      requiresManualReview: Boolean(q.requires_manual_review),
      skillTitle: q.skills?.title || 'Skill',
      courseTitle: q.courses?.title || '',
    }));
  }

  const state = getDemoState();
  return (state.quizzes || []).map((q) => ({
    ...q,
    skillTitle: (state.skills || []).find((s) => s.id === q.skillId)?.title || 'Skill',
    courseTitle: q.courseId
      ? (state.courses || []).find((c) => c.id === q.courseId)?.title || ''
      : '',
  }));
}

export async function adminUpsertAssessment(payload) {
  const key = buildIdempotencyKey('admin-quiz', payload.id || payload.title, payload.skillId, payload.courseId || '');
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('quizzes')
        .upsert({
          id: payload.id || undefined,
          skill_id: payload.skillId,
          course_id: payload.courseId || null,
          phase_id: payload.phaseId || null,
          lesson_id: payload.lessonId || null,
          quiz_type: payload.quizType || 'phase',
          title: String(payload.title || '').trim(),
          description: String(payload.description || '').trim(),
          pass_percent: Number(payload.passPercent || 70),
          time_limit_minutes: payload.timeLimitMinutes ? Number(payload.timeLimitMinutes) : null,
          max_attempts: payload.maxAttempts ? Number(payload.maxAttempts) : null,
          shuffle_questions: Boolean(payload.shuffleQuestions),
          requires_manual_review: Boolean(payload.requiresManualReview),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      draft.quizzes = draft.quizzes || [];
      const existing = payload.id ? draft.quizzes.find((q) => q.id === payload.id) : null;
      const fields = {
        skillId: payload.skillId,
        courseId: payload.courseId || null,
        phaseId: payload.phaseId || null,
        lessonId: payload.lessonId || null,
        quizType: payload.quizType || 'phase',
        title: String(payload.title || '').trim(),
        description: String(payload.description || '').trim(),
        passPercent: Number(payload.passPercent || 70),
        timeLimitMinutes: payload.timeLimitMinutes ? Number(payload.timeLimitMinutes) : null,
        maxAttempts: payload.maxAttempts ? Number(payload.maxAttempts) : null,
        shuffleQuestions: Boolean(payload.shuffleQuestions),
        requiresManualReview: Boolean(payload.requiresManualReview),
      };
      if (existing) {
        Object.assign(existing, fields);
      } else {
        draft.quizzes.push({
          id: `quiz-${Date.now()}`,
          ...fields,
          questions: [],
        });
      }
      return draft;
    });
  });
}

export async function adminGetQuizQuestions(quizId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('admin_get_quiz_questions', { p_quiz_id: quizId });
    if (error) throw error;
    return (data || []).map((q) => ({
      id: q.id,
      quizId: q.quiz_id,
      position: q.position,
      questionType: q.question_type || 'multiple_choice',
      difficulty: q.difficulty || 'medium',
      marks: Number(q.marks || 1),
      prompt: q.prompt,
      contextText: q.context_text || '',
      options: q.options || [],
      correctIndex: q.correct_index,
      answerConfig: q.answer_config || {},
      explanation: q.explanation,
    }));
  }

  const state = getDemoState();
  const quiz = (state.quizzes || []).find((q) => q.id === quizId);
  if (!quiz) return [];
  return (quiz.questions || []).map((q) => {
    const ans = state.privateQuizAnswers?.[q.id] || {};
    return {
      ...q,
      questionType: q.questionType || 'multiple_choice',
      difficulty: q.difficulty || 'medium',
      marks: Number(q.marks || 1),
      correctIndex: ans.correctIndex ?? 0,
      correctIndices: ans.correctIndices || null,
      acceptedAnswers: ans.acceptedAnswers || null,
      correctOrder: ans.correctOrder || null,
      answerConfig: ans,
      explanation: ans.explanation || '',
    };
  });
}

export async function adminUpsertQuestion({
  id,
  quizId,
  questionType = 'multiple_choice',
  difficulty = 'medium',
  marks = 1,
  prompt,
  contextText = '',
  options = [],
  correctIndex = 0,
  correctIndices = null,
  acceptedAnswers = null,
  correctOrder = null,
  explanation = '',
}) {
  const key = buildIdempotencyKey('admin-question', id || quizId, questionType, prompt);
  return runIdempotent(key, async () => {
    const answerConfig = {};
    if (Array.isArray(correctIndices)) answerConfig.correctIndices = correctIndices;
    if (Array.isArray(acceptedAnswers)) answerConfig.acceptedAnswers = acceptedAnswers;
    if (Array.isArray(correctOrder)) answerConfig.correctOrder = correctOrder;

    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('admin_upsert_question', {
        p_id: id || null,
        p_quiz_id: quizId,
        p_position: Date.now() % 10000,
        p_prompt: prompt,
        p_options: options,
        p_correct_index: Number(correctIndex || 0),
        p_explanation: explanation,
        p_question_type: questionType,
        p_difficulty: difficulty,
        p_marks: Number(marks || 1),
        p_context_text: contextText,
        p_answer_config: answerConfig,
      });
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const quiz = (draft.quizzes || []).find((q) => q.id === quizId);
      if (!quiz) throw new Error('Assessment not found');
      quiz.questions = quiz.questions || [];

      const existing = id
        ? quiz.questions.find((q) => q.id === id)
        : quiz.questions.find((q) => q.prompt.trim().toLowerCase() === prompt.trim().toLowerCase());

      const questionId = existing ? existing.id : id || `q-${Date.now()}`;
      const questionFields = {
        questionType,
        difficulty,
        marks: Math.max(1, Number(marks || 1)),
        prompt: String(prompt || '').trim(),
        contextText: String(contextText || '').trim(),
        options: Array.isArray(options) ? options : [],
      };

      if (existing) {
        Object.assign(existing, questionFields);
      } else {
        quiz.questions.push({
          id: questionId,
          position: quiz.questions.length + 1,
          ...questionFields,
        });
      }

      draft.privateQuizAnswers = draft.privateQuizAnswers || {};
      draft.privateQuizAnswers[questionId] = {
        correctIndex: Number(correctIndex || 0),
        correctIndices: correctIndices || null,
        acceptedAnswers: acceptedAnswers || null,
        correctOrder: correctOrder || null,
        explanation: String(explanation || '').trim(),
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
      const quiz = (draft.quizzes || []).find((q) => q.id === quizId);
      if (!quiz) return draft;
      quiz.questions = (quiz.questions || []).filter((q) => q.id !== questionId);
      if (draft.privateQuizAnswers) delete draft.privateQuizAnswers[questionId];
      return draft;
    });
  });
}

export async function adminListPendingAssessmentAttempts() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*, profiles!quiz_attempts_user_id_fkey(full_name, email), quizzes(title, pass_percent, course_id, skill_id)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || [])
      .filter((a) => a.review_status === 'pending_review' || a.review_status === 'reviewed')
      .map((a) => ({
        id: a.id,
        userId: a.user_id,
        quizId: a.quiz_id,
        learnerName: a.profiles?.full_name || 'Learner',
        learnerEmail: a.profiles?.email || '',
        quizTitle: a.quizzes?.title || 'Assessment',
        passPercent: a.quizzes?.pass_percent || 70,
        courseId: a.quizzes?.course_id || null,
        skillId: a.quizzes?.skill_id || null,
        answers: a.answers || {},
        score: a.score,
        total: a.total,
        percentage: a.percentage,
        passed: a.passed,
        reviewStatus: a.review_status,
        manualScores: a.manual_scores || {},
        manualFeedback: a.manual_feedback || '',
        createdAt: a.created_at,
      }));
  }

  const state = getDemoState();
  return (state.quizAttempts || [])
    .filter((a) => a.reviewStatus === 'pending_review' || a.reviewStatus === 'reviewed')
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((a) => {
      const learner = (state.users || []).find((u) => u.id === a.userId);
      const quiz = (state.quizzes || []).find((q) => q.id === a.quizId);
      return {
        ...a,
        learnerName: learner?.fullName || 'Learner',
        learnerEmail: learner?.email || '',
        quizTitle: quiz?.title || 'Assessment',
        passPercent: quiz?.passPercent || 70,
        courseId: quiz?.courseId || null,
        skillId: quiz?.skillId || null,
        questions: quiz?.questions || [],
      };
    });
}

export async function adminGradeAttempt({ attemptId, reviewerId, manualScores, feedback }) {
  const key = buildIdempotencyKey('admin-grade-attempt', attemptId, JSON.stringify(manualScores), feedback);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('*, quizzes(*)')
        .eq('id', attemptId)
        .single();
      if (!attempt) throw new Error('Attempt not found');
      const manualSum = Object.values(manualScores || {}).reduce((s, v) => s + Number(v || 0), 0);
      const newScore = Number(attempt.score || 0) + manualSum;
      const pct = attempt.total > 0 ? Math.round((newScore / attempt.total) * 100) : 0;
      const passed = pct >= Number(attempt.quizzes?.pass_percent || 70);
      const { error } = await supabase
        .from('quiz_attempts')
        .update({
          score: newScore,
          percentage: pct,
          passed,
          review_status: 'reviewed',
          manual_scores: manualScores,
          manual_feedback: feedback,
        })
        .eq('id', attemptId);
      if (error) throw error;
      if (passed && attempt.quizzes?.course_id) {
        await supabase.rpc('evaluate_course_and_skill_progression', {
          p_user_id: attempt.user_id,
          p_course_id: attempt.quizzes.course_id,
        });
      }
      return;
    }

    let targetUserId = null;
    let targetCourseId = null;
    let targetSkillId = null;
    let didPass = false;

    updateDemoState((draft) => {
      const attempt = (draft.quizAttempts || []).find((a) => a.id === attemptId);
      if (!attempt) throw new Error('Assessment attempt not found');
      const quiz = (draft.quizzes || []).find((q) => q.id === attempt.quizId);
      if (!quiz) throw new Error('Assessment not found');

      // Recompute base auto-graded score + supplied manualScores cleanly (idempotent)
      const baseGraded = gradeAssessmentAttempt({
        quiz,
        questions: quiz.questions || [],
        answerKeysByQuestionId: draft.privateQuizAnswers || {},
        answersMap: attempt.answers || {},
      });

      let manualSum = 0;
      (quiz.questions || []).forEach((q) => {
        if (manualScores && manualScores[q.id] !== undefined) {
          const capped = Math.min(Number(q.marks || 1), Math.max(0, Number(manualScores[q.id]) || 0));
          manualSum += capped;
        }
      });

      const finalScore = Math.min(baseGraded.total, baseGraded.score + manualSum);
      const finalPct = baseGraded.total > 0 ? Math.round((finalScore / baseGraded.total) * 100) : 0;
      const passed = finalPct >= Number(quiz.passPercent || 70);

      attempt.score = finalScore;
      attempt.total = baseGraded.total;
      attempt.percentage = finalPct;
      attempt.passed = passed;
      attempt.reviewStatus = 'reviewed';
      attempt.manualScores = manualScores;
      attempt.manualFeedback = String(feedback || '').trim();
      attempt.reviewedBy = reviewerId;
      attempt.reviewedAt = new Date().toISOString();

      targetUserId = attempt.userId;
      targetCourseId = quiz.courseId || null;
      targetSkillId = quiz.skillId;
      didPass = passed;
      return draft;
    });

    if (didPass && targetUserId) {
      if (targetCourseId) {
        await recomputeCourseAndSkillStatus(targetUserId, targetCourseId);
      } else if (targetSkillId) {
        await upgradeSkillLevel(targetUserId, targetSkillId, 'demonstrated');
      }
    }
  });
}
