import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { appendDemoAuditLog } from '../demo/demoAudit.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { recomputeCourseAndSkillStatus, recomputeDemoSkillLevel } from './progressRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import { gradeAssessmentAttempt, isManualQuestionType } from '../assessmentEngine.js';

function sanitizeReturnedResults(results = [], solutionsReleased = false) {
  if (solutionsReleased) return results;
  return (results || []).map((r) => ({
    ...r,
    correctIndex: null,
    answerConfig: {},
    explanation: null,
  }));
}

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

export async function listAllQuizzes() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quizzes')
      .select('id, skill_id, course_id, phase_id, lesson_id, quiz_type, title, description, pass_percent, time_limit_minutes, max_attempts');
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
  return (getDemoState().quizzes || []).map((q) => ({
    id: q.id,
    skillId: q.skillId,
    courseId: q.courseId || null,
    phaseId: q.phaseId || null,
    lessonId: q.lessonId || null,
    quizType: q.quizType,
    title: q.title,
    description: q.description,
    passPercent: q.passPercent,
    timeLimitMinutes: q.timeLimitMinutes || null,
    maxAttempts: q.maxAttempts || null,
  }));
}

export async function getUserAllQuizAttempts(userId) {
  if (!userId) return [];
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('id, user_id, quiz_id, course_id, attempt_number, score, total, percentage, passed, review_status, manual_feedback, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((a) => ({
      id: a.id,
      userId: a.user_id,
      quizId: a.quiz_id,
      courseId: a.course_id,
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
    .filter((a) => a.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Learner-safe assessment loader.
 * NEVER returns correctIndex, answerConfig, or explanation before submission.
 * Returns empty questions list if learner is not enrolled in a course-scoped assessment.
 */
export async function getQuizForLearner(quizId, { userId = null, includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select(
        'id, skill_id, course_id, phase_id, lesson_id, quiz_type, title, description, pass_percent, time_limit_minutes, max_attempts, shuffle_questions, requires_manual_review, skills!quizzes_skill_id_fkey(id, slug, title, publication_status), courses!quizzes_course_id_fkey(id, slug, title, publication_status)'
      )
      .eq('id', quizId)
      .single();
    if (error || !quiz) return null;
    if (!includeDrafts && quiz.course_id && quiz.courses?.publication_status !== 'published') {
      return null;
    }

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

  if (!includeDrafts) {
    if (course && course.publicationStatus !== 'published') return null;
    if (!course && skill && skill.publicationStatus !== 'published') return null;
    if (course && quiz.phaseId) {
      const phase = (course.phases || []).find((p) => p.id === quiz.phaseId);
      if (!phase || phase.publicationStatus === 'draft' || phase.publicationStatus === 'archived') {
        return null;
      }
      if (quiz.lessonId) {
        const lesson = (phase.lessons || []).find((l) => l.id === quiz.lessonId);
        if (!lesson || lesson.publicationStatus === 'draft' || lesson.publicationStatus === 'archived') {
          return null;
        }
      }
    }
  }

  let hasAccess = true;
  if (userId && quiz.courseId) {
    hasAccess = (state.courseEnrollments || []).some(
      (e) => e.userId === userId && e.courseId === quiz.courseId && (e.status === 'active' || e.status === 'completed')
    );
  }

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
    enrollmentRequired: Boolean(userId && quiz.courseId && !hasAccess),
    questions: hasAccess
      ? (quiz.questions || [])
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
          }))
      : [],
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

export async function startQuizSession(userId, quizId, { restartExpired = false } = {}) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('start_quiz_session', {
      p_quiz_id: quizId,
      p_restart_expired: Boolean(restartExpired),
    });
    if (error) throw new Error(error.message);
    return data;
  }

  const state = getDemoState();
  const actor = (state.users || []).find((u) => u.id === userId);
  if (!actor || actor.role === 'admin') {
    throw new Error('Learner authentication required to start an assessment.');
  }
  if ((actor.accountStatus || 'active') !== 'active') {
    throw new Error('Account is suspended or inactive.');
  }

  const quiz = (state.quizzes || []).find((q) => q.id === quizId);
  if (!quiz) throw new Error('Assessment not found');

  if (quiz.courseId) {
    const course = (state.courses || []).find((c) => c.id === quiz.courseId);
    if (!course || course.publicationStatus !== 'published') {
      throw new Error('Course assessment is not currently published.');
    }
    if (quiz.phaseId) {
      const phase = (course.phases || []).find((p) => p.id === quiz.phaseId);
      if (!phase || phase.publicationStatus === 'draft' || phase.publicationStatus === 'archived') {
        throw new Error('Module assessment is not currently published.');
      }
      if (quiz.lessonId) {
        const lesson = (phase.lessons || []).find((l) => l.id === quiz.lessonId);
        if (!lesson || lesson.publicationStatus === 'draft' || lesson.publicationStatus === 'archived') {
          throw new Error('Lesson assessment is not currently published.');
        }
      }
    }
    const enrolled = (state.courseEnrollments || []).some(
      (e) => e.userId === userId && e.courseId === quiz.courseId && (e.status === 'active' || e.status === 'completed')
    );
    if (!enrolled) {
      throw new Error('Active course enrollment required to start this assessment.');
    }
  } else {
    const skill = (state.skills || []).find((s) => s.id === quiz.skillId);
    if (skill && skill.publicationStatus !== 'published') {
      throw new Error('Assessment skill is not currently published.');
    }
  }

  const attemptsUsed = (state.quizAttempts || []).filter(
    (a) => a.userId === userId && a.quizId === quizId
  ).length;
  if (quiz.maxAttempts && attemptsUsed >= quiz.maxAttempts) {
    throw new Error(`Maximum allowed attempts (${quiz.maxAttempts}) reached for this assessment.`);
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const existingSessions = (state.quizSessions || [])
    .filter(
      (s) =>
        s.userId === userId &&
        s.quizId === quizId &&
        s.status === 'active' &&
        !s.completedAttemptId
    )
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  const latestActive = existingSessions[0] || null;
  if (latestActive) {
    const expMs = latestActive.expiresAt ? new Date(latestActive.expiresAt).getTime() : null;
    if (expMs === null || expMs >= nowMs) {
      return {
        sessionId: latestActive.id,
        quizId,
        startedAt: latestActive.startedAt,
        expiresAt: latestActive.expiresAt,
        serverNow: nowIso,
        expired: false,
      };
    }
    if (!restartExpired) {
      return {
        sessionId: latestActive.id,
        quizId,
        startedAt: latestActive.startedAt,
        expiresAt: latestActive.expiresAt,
        serverNow: nowIso,
        expired: true,
      };
    }
  }

  const limitMins = Number(quiz.timeLimitMinutes || 0);
  const expiresAt = limitMins > 0 ? new Date(nowMs + limitMins * 60000).toISOString() : null;
  let createdSession = null;

  updateDemoState((draft) => {
    draft.quizSessions = draft.quizSessions || [];
    if (latestActive && restartExpired) {
      const target = draft.quizSessions.find((s) => s.id === latestActive.id);
      if (target) target.status = 'expired';
    }
    createdSession = {
      id: `qs-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      quizId,
      status: 'active',
      startedAt: nowIso,
      expiresAt,
      completedAttemptId: null,
      createdAt: nowIso,
    };
    draft.quizSessions.push(createdSession);
    return draft;
  });

  return {
    sessionId: createdSession.id,
    quizId,
    startedAt: createdSession.startedAt,
    expiresAt: createdSession.expiresAt,
    serverNow: nowIso,
    expired: false,
  };
}

export async function submitQuiz(userId, quizId, answersMap, idempotencyKey = null) {
  const effectiveKey =
    idempotencyKey || buildIdempotencyKey('quiz-submit', userId, quizId, JSON.stringify(answersMap));

  const inFlightKey = buildIdempotencyKey('quiz-submit-lock', userId, quizId, effectiveKey);

  return runIdempotent(
    inFlightKey,
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
      const actor = (state.users || []).find((u) => u.id === userId);
      if (!actor || actor.role === 'admin') {
        throw new Error('Learner authentication required to submit an assessment.');
      }
      if ((actor.accountStatus || 'active') !== 'active') {
        throw new Error('Account is suspended or inactive.');
      }

      const quiz = (state.quizzes || []).find((q) => q.id === quizId);
      if (!quiz) throw new Error('Assessment not found');

      if (quiz.courseId) {
        const course = (state.courses || []).find((c) => c.id === quiz.courseId);
        if (!course || course.publicationStatus !== 'published') {
          throw new Error('Course assessment is not currently published.');
        }
        if (quiz.phaseId) {
          const phase = (course.phases || []).find((p) => p.id === quiz.phaseId);
          if (!phase || phase.publicationStatus === 'draft' || phase.publicationStatus === 'archived') {
            throw new Error('Module assessment is not currently published.');
          }
          if (quiz.lessonId) {
            const lesson = (phase.lessons || []).find((l) => l.id === quiz.lessonId);
            if (!lesson || lesson.publicationStatus === 'draft' || lesson.publicationStatus === 'archived') {
              throw new Error('Lesson assessment is not currently published.');
            }
          }
        }
        const enrolled = (state.courseEnrollments || []).some(
          (e) => e.userId === userId && e.courseId === quiz.courseId && (e.status === 'active' || e.status === 'completed')
        );
        if (!enrolled) {
          throw new Error('Active course enrollment required before submitting this assessment.');
        }
      }

      // Deduplicate identical double-click / replay submissions
      const existing = (state.quizAttempts || []).find(
        (a) => a.userId === userId && a.idempotencyKey === effectiveKey
      );
      if (existing) {
        if (existing.quizId !== quizId) {
          throw new Error('Idempotency key already used for a different assessment.');
        }
        const gradedReplay = gradeAssessmentAttempt({
          quiz,
          questions: quiz.questions || [],
          answerKeysByQuestionId: state.privateQuizAnswers || {},
          answersMap: existing.answers || answersMap,
        });
        const replayReviewStatus = existing.reviewStatus || gradedReplay.reviewStatus;
        const replayAttemptNum = existing.attemptNumber || 1;
        const solutionsReleased =
          replayReviewStatus !== 'pending_review' &&
          (existing.passed || (quiz.maxAttempts != null && replayAttemptNum >= quiz.maxAttempts));
        return {
          attemptId: existing.id,
          quizId,
          attemptNumber: replayAttemptNum,
          score: existing.score,
          total: existing.total,
          percentage: existing.percentage,
          passed: existing.passed,
          reviewStatus: replayReviewStatus,
          solutionsReleased,
          results: sanitizeReturnedResults(gradedReplay.results, solutionsReleased),
        };
      }

      const priorAttempts = (state.quizAttempts || []).filter(
        (a) => a.userId === userId && a.quizId === quizId
      );
      if (quiz.maxAttempts && priorAttempts.length >= quiz.maxAttempts) {
        throw new Error(`Maximum allowed attempts (${quiz.maxAttempts}) reached for this assessment.`);
      }

      let activeSessionId = null;
      if (quiz.timeLimitMinutes && Number(quiz.timeLimitMinutes) > 0) {
        const activeSession = (state.quizSessions || [])
          .filter(
            (s) =>
              s.userId === userId &&
              s.quizId === quizId &&
              s.status === 'active' &&
              !s.completedAttemptId
          )
          .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
        if (!activeSession) {
          throw new Error('Active assessment session required before submitting a timed assessment.');
        }
        if (
          activeSession.expiresAt &&
          Date.now() > new Date(activeSession.expiresAt).getTime() + 30000
        ) {
          throw new Error('Assessment time limit exceeded for this session.');
        }
        activeSessionId = activeSession.id;
      }

      const graded = gradeAssessmentAttempt({
        quiz,
        questions: quiz.questions || [],
        answerKeysByQuestionId: state.privateQuizAnswers || {},
        answersMap,
      });

      if (graded.total <= 0) {
        throw new Error('Assessment has no configured questions.');
      }

      const attemptId = `qa-${Date.now()}`;
      const attemptNumber = priorAttempts.length + 1;
      const solutionsReleased =
        graded.reviewStatus !== 'pending_review' &&
        (graded.passed || (quiz.maxAttempts != null && attemptNumber >= quiz.maxAttempts));

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
        if (activeSessionId) {
          const sess = (draft.quizSessions || []).find((s) => s.id === activeSessionId);
          if (sess) {
            sess.status = 'completed';
            sess.completedAttemptId = attemptId;
          }
        }
        return draft;
      });

      // Quizzes can establish Practising and trigger course evaluation when enrolled,
      // but NEVER independently award Demonstrated or Verified without practical completion.
      if (quiz.courseId) {
        await recomputeCourseAndSkillStatus(userId, quiz.courseId);
      } else if (quiz.skillId) {
        await recomputeDemoSkillLevel(userId, quiz.skillId);
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
        solutionsReleased,
        results: sanitizeReturnedResults(graded.results, solutionsReleased),
      };
    },
    { cacheResult: false }
  );
}

// =========================================================================
// Protected Admin Assessment & Grading APIs
// =========================================================================
export async function adminListAllQuizzes() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*, skills!quizzes_skill_id_fkey(title, slug), courses!quizzes_course_id_fkey(title, slug)')
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
        const prev = { title: existing.title, passPercent: existing.passPercent };
        Object.assign(existing, fields);
        appendDemoAuditLog(draft, {
          action: 'quiz_updated',
          targetTable: 'quizzes',
          targetId: existing.id,
          beforeData: prev,
          afterData: { title: existing.title, passPercent: existing.passPercent },
        });
      } else {
        const newQuizId = `quiz-${Date.now()}`;
        draft.quizzes.push({
          id: newQuizId,
          ...fields,
          questions: [],
        });
        appendDemoAuditLog(draft, {
          action: 'quiz_created',
          targetTable: 'quizzes',
          targetId: newQuizId,
          beforeData: null,
          afterData: { title: fields.title, passPercent: fields.passPercent },
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
  position = null,
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
        p_position: position ?? null,
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
      appendDemoAuditLog(draft, {
        action: existing ? 'question_updated' : 'question_created',
        targetTable: 'questions',
        targetId: questionId,
        beforeData: null,
        afterData: { quizId, questionType, marks: questionFields.marks },
      });
      return draft;
    });
  });
}

export async function adminDeleteQuestion(quizId, questionId) {
  const key = buildIdempotencyKey('admin-q-del', quizId, questionId);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('admin_delete_question', {
        p_quiz_id: quizId,
        p_question_id: questionId,
      });
      if (error) throw new Error(error.message);
      return;
    }

    updateDemoState((draft) => {
      const quiz = (draft.quizzes || []).find((q) => q.id === quizId);
      if (!quiz) return draft;
      quiz.questions = (quiz.questions || []).filter((q) => q.id !== questionId);
      if (draft.privateQuizAnswers) delete draft.privateQuizAnswers[questionId];
      appendDemoAuditLog(draft, {
        action: 'question_deleted',
        targetTable: 'questions',
        targetId: questionId,
        beforeData: { quizId },
        afterData: null,
      });
      return draft;
    });
  });
}

export async function adminListPendingAssessmentAttempts() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*, profiles!quiz_attempts_user_id_fkey(full_name, email), quizzes!quiz_attempts_quiz_id_fkey(title, pass_percent, course_id, skill_id)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const filtered = (data || []).filter(
      (a) => a.review_status === 'pending_review' || a.review_status === 'reviewed'
    );
    const uniqueQuizIds = Array.from(new Set(filtered.map((a) => a.quiz_id).filter(Boolean)));
    const questionsByQuizId = new Map();
    if (uniqueQuizIds.length > 0) {
      const questionLists = await Promise.all(
        uniqueQuizIds.map(async (qid) => [qid, await adminGetQuizQuestions(qid)])
      );
      questionLists.forEach(([qid, qList]) => questionsByQuizId.set(qid, qList));
    }
    return filtered.map((a) => ({
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
      questions: questionsByQuizId.get(a.quiz_id) || [],
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
  const cleanFeedback = String(feedback || '').trim();
  if (!cleanFeedback) {
    throw new Error('Grading feedback is required.');
  }

  const key = buildIdempotencyKey('admin-grade-attempt', attemptId, JSON.stringify(manualScores), cleanFeedback);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('admin_grade_attempt', {
        p_attempt_id: attemptId,
        p_manual_scores: manualScores || {},
        p_feedback: cleanFeedback,
      });
      if (error) throw new Error(error.message);
      return data;
    }

    let targetUserId = null;
    let targetCourseId = null;
    let targetSkillId = null;
    let didPass = false;

    updateDemoState((draft) => {
      const reviewer = (draft.users || []).find((u) => u.id === reviewerId);
      if (!reviewer || reviewer.role !== 'admin' || (reviewer.accountStatus || 'active') !== 'active') {
        throw new Error('Administrator authorization required to grade assessments.');
      }
      const attempt = (draft.quizAttempts || []).find((a) => a.id === attemptId);
      if (!attempt) throw new Error('Assessment attempt not found');
      if (attempt.userId === reviewerId) {
        throw new Error('Reviewers cannot grade their own assessment attempts.');
      }
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
      const cleanManualScores = {};
      (quiz.questions || []).forEach((q) => {
        if (isManualQuestionType(q.questionType)) {
          const rawPresent = manualScores && Object.prototype.hasOwnProperty.call(manualScores, q.id) && manualScores[q.id] !== null && manualScores[q.id] !== '';
          if (!rawPresent) {
            throw new Error(`Manual score for question "${q.prompt}" is required.`);
          }
          const rawVal = Number(manualScores[q.id]);
          const maxMarks = Math.max(1, Number(q.marks || 1));
          if (!Number.isFinite(rawVal) || rawVal < 0 || rawVal > maxMarks) {
            throw new Error(`Manual score for question "${q.prompt}" must be between 0 and ${maxMarks}.`);
          }
          cleanManualScores[q.id] = rawVal;
          manualSum += rawVal;
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
      attempt.manualScores = cleanManualScores;
      attempt.manualFeedback = cleanFeedback;
      attempt.reviewedBy = reviewerId;
      attempt.reviewedAt = new Date().toISOString();

      appendDemoAuditLog(draft, {
        actorId: reviewerId,
        action: 'quiz_attempt_graded',
        targetTable: 'quiz_attempts',
        targetId: attempt.id,
        beforeData: { reviewStatus: 'pending_review' },
        afterData: { reviewStatus: 'reviewed', score: finalScore, total: baseGraded.total, passed },
      });

      targetUserId = attempt.userId;
      targetCourseId = quiz.courseId || null;
      targetSkillId = quiz.skillId;
      didPass = passed;
      return draft;
    });

    if (targetUserId) {
      if (targetCourseId) {
        await recomputeCourseAndSkillStatus(targetUserId, targetCourseId);
      } else if (targetSkillId) {
        await recomputeDemoSkillLevel(targetUserId, targetSkillId);
      }
    }
  });
}
