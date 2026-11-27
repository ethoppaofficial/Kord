/**
 * Unified 10-format assessment grading engine.
 * Auto-grades objective/structured question formats and routes written/practical items
 * into manual administrator review without exposing grading keys before submission.
 */

const MANUAL_TYPES = new Set(['short_answer', 'long_form', 'practical_submission']);

/** @param {string} type */
export function isManualQuestionType(type) {
  return MANUAL_TYPES.has(type);
}

/** @param {unknown} val */
function normalizeText(val) {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * @param {unknown[]} a
 * @param {unknown[]} b
 */
function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * @param {{
 *   quiz: import('../types/kord.d.ts').Quiz;
 *   questions: import('../types/kord.d.ts').QuizQuestion[];
 *   answerKeysByQuestionId: Record<string, import('../types/kord.d.ts').QuizAnswerKey>;
 *   answersMap: Record<string, unknown>;
 * }} params
 */
export function gradeAssessmentAttempt({ quiz, questions, answerKeysByQuestionId, answersMap }) {
  let score = 0;
  let total = 0;
  let hasManualItems = false;

  const results = (questions || []).map((q) => {
    const qType = q.questionType || 'multiple_choice';
    const marks = Math.max(1, Number(q.marks || 1));
    total += marks;

    const key = answerKeysByQuestionId[q.id] || {};
    const rawAnswer = answersMap[q.id];

    if (isManualQuestionType(qType)) {
      hasManualItems = true;
      return {
        questionId: q.id,
        questionType: qType,
        marks,
        earnedMarks: 0,
        submittedAnswer: rawAnswer ?? '',
        isCorrect: false,
        pendingReview: true,
        correctIndex: null,
        answerConfig: null,
        explanation: key.explanation || 'Queued for administrator grading.',
      };
    }

    let isCorrect;
    const optCount = Array.isArray(q.options) ? q.options.length : 0;
    if (qType === 'multiple_select') {
      const validElems =
        Array.isArray(rawAnswer) &&
        rawAnswer.every((v) => {
          const n = Number(v);
          return v !== null && v !== '' && Number.isInteger(n) && n >= 0 && (optCount === 0 || n < optCount);
        });
      const selected = validElems
        ? Array.from(new Set(rawAnswer.map(Number))).sort((a, b) => a - b)
        : [];
      const expected = Array.isArray(key.correctIndices)
        ? Array.from(new Set(key.correctIndices.map(Number))).sort((a, b) => a - b)
        : [Number(key.correctIndex ?? 0)];
      isCorrect = validElems && expected.length > 0 && arraysEqual(selected, expected);
    } else if (qType === 'fill_blank') {
      const accepted = Array.isArray(key.acceptedAnswers) ? key.acceptedAnswers : [];
      const userNorm = normalizeText(rawAnswer);
      isCorrect = Boolean(userNorm) && accepted.some((ans) => normalizeText(ans) === userNorm);
    } else if (qType === 'ordering') {
      const expectedOrder = Array.isArray(key.correctOrder)
        ? key.correctOrder.map(Number)
        : (q.options || []).map((_, idx) => idx);
      const validOrder =
        Array.isArray(rawAnswer) &&
        rawAnswer.length === expectedOrder.length &&
        rawAnswer.every((v) => {
          const n = Number(v);
          return v !== null && v !== '' && Number.isInteger(n) && n >= 0 && (optCount === 0 || n < optCount);
        });
      const userOrder = validOrder ? rawAnswer.map(Number) : [];
      isCorrect = validOrder && arraysEqual(userOrder, expectedOrder);
    } else {
      // multiple_choice, true_false, scenario, case_study
      const parsed = rawAnswer === '' || rawAnswer === null || rawAnswer === undefined ? -1 : Number(rawAnswer);
      const selectedIdx =
        Number.isInteger(parsed) && parsed >= 0 && (optCount === 0 || parsed < optCount) ? parsed : -1;
      isCorrect = selectedIdx === Number(key.correctIndex ?? 0);
    }

    const earnedMarks = isCorrect ? marks : 0;
    score += earnedMarks;

    return {
      questionId: q.id,
      questionType: qType,
      marks,
      earnedMarks,
      submittedAnswer: rawAnswer,
      selectedIndex: typeof rawAnswer === 'number' ? rawAnswer : null,
      isCorrect,
      pendingReview: false,
      correctIndex: key.correctIndex ?? 0,
      answerConfig: {
        correctIndices: key.correctIndices || null,
        acceptedAnswers: key.acceptedAnswers || null,
        correctOrder: key.correctOrder || null,
      },
      explanation: key.explanation || '',
    };
  });

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  const requiresReview = hasManualItems || Boolean(quiz.requiresManualReview);
  const reviewStatus = requiresReview ? 'pending_review' : 'auto_graded';
  const passed = requiresReview ? false : percentage >= Number(quiz.passPercent || 70);

  return {
    score,
    total,
    percentage,
    passed,
    reviewStatus,
    hasManualItems: requiresReview,
    results,
  };
}
