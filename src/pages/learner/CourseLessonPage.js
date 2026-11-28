import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { saveLessonNotes, toggleLessonComplete } from '../../lib/repositories/progressRepository.js';
import {
  getQuizForLearner,
  getQuizAttempts,
  startQuizSession,
  submitQuiz,
} from '../../lib/repositories/quizRepository.js';
import { buildIdempotencyKey } from '../../lib/idempotency.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import {
  renderCourseBreadcrumbs,
  renderCourseOutlineDrawer,
  bindCourseOutlineDrawer,
} from '../../components/CourseOutlineDrawer.js';
import { renderLessonReaderHtml, bindLessonReader } from '../../components/LessonReader.js';
import { showToast } from '../../components/Toast.js';

/** @type {Record<string, import('../../types/kord.d.ts').QuizAttempt>} */
let lastResultByLessonQuiz = {};
/** @type {Record<string, number[]>} */
let orderByLessonQuizQuestion = {};

registerSessionCleanup(() => {
  lastResultByLessonQuiz = {};
  orderByLessonQuizQuestion = {};
});

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderCourseLessonPage({ params, session, navigate, rerender }) {
  const userId = session?.user?.id || '';
  const targetUrl = `/courses/${params.slug}/phases/${params.phaseId}/lessons/${params.lessonId}`;

  const ctx = await resolveCourseHierarchy({
    courseSlug: params.slug,
    phaseId: params.phaseId,
    lessonId: params.lessonId,
    userId,
    requireEnrollment: true,
  });

  if (ctx.status !== 'ok') {
    return (
      renderHierarchyGuard({ ctx, userId, targetUrlAfterEnroll: targetUrl, navigate }) || {
        html: '',
        bind() {},
      }
    );
  }

  const {
    course,
    orderedPhases,
    phase,
    lesson,
    lessonEntry,
    prevLesson,
    nextLesson,
    courseProgress,
    phaseProgressById,
    progressByLesson,
    assessments,
    challenges,
  } = ctx;

  if (!phase || !lesson) {
    return { html: '', bind() {} };
  }

  const lp = progressByLesson.get(lesson.id);
  const lessonAssessments = assessments.filter((a) => a.lessonId === lesson.id);

  /** @type {import('../../types/kord.d.ts').Quiz | null} */
  let lessonQuiz = null;
  /** @type {import('../../types/kord.d.ts').QuizAttempt[]} */
  let lessonQuizAttempts = [];

  if (lessonAssessments.length > 0) {
    const primaryQuizId = lessonAssessments[0].id;
    lessonQuiz = await getQuizForLearner(primaryQuizId, { userId });
    if (lessonQuiz) {
      lessonQuizAttempts = await getQuizAttempts(userId, lessonQuiz.id);
      if (lessonQuiz.timeLimitMinutes && Number(lessonQuiz.timeLimitMinutes) > 0) {
        try {
          await startQuizSession(userId, lessonQuiz.id);
        } catch {
          // Session notice handled during submit if expired/locked
        }
      }
    }
  }

  const latestQuizResult = lessonQuiz ? lastResultByLessonQuiz[lessonQuiz.id] || null : null;

  const phaseUrl = `/courses/${course.slug}/phases/${phase.id}`;
  const courseUrl = `/courses/${course.slug}`;

  const breadcrumbItems = [
    { label: 'Explore', href: '/explore' },
    ...(course.skill ? [{ label: course.skill.title, href: `/skills/${course.skill.slug}` }] : []),
    { label: course.title, href: courseUrl },
    { label: `Phase ${phase.position}: ${phase.title}`, href: phaseUrl },
    { label: lesson.title },
  ];

  const prevNav = prevLesson
    ? {
        url: prevLesson.url,
        label:
          prevLesson.phase.id !== phase.id
            ? `← Previous (Phase ${prevLesson.phase.position})`
            : '← Previous lesson',
      }
    : null;

  const nextNav = nextLesson
    ? {
        url: nextLesson.url,
        label:
          nextLesson.phase.id !== phase.id
            ? `Next (Phase ${nextLesson.phase.position}): ${nextLesson.lesson.title} →`
            : `Next lesson: ${nextLesson.lesson.title} →`,
      }
    : null;

  return {
    html: `
      ${renderCourseBreadcrumbs({ items: breadcrumbItems, showOutlineToggle: true })}
      ${renderCourseOutlineDrawer({
        course,
        orderedPhases,
        phaseProgressById,
        progressByLesson,
        assessments,
        challenges,
        activePhaseId: phase.id,
        activeLessonId: lesson.id,
        courseProgress,
      })}

      ${renderLessonReaderHtml({
        lesson,
        courseTitle: course.title,
        phasePosition: phase.position,
        phaseTitle: phase.title,
        lessonNumber: (lessonEntry?.lessonIdx || 0) + 1,
        totalLessonsInPhase: (phase.lessons || []).length,
        completed: Boolean(lp?.completed),
        notes: lp?.notes || '',
        lessonQuiz,
        quizAttempts: lessonQuizAttempts,
        latestQuizResult,
        orderState: orderByLessonQuizQuestion,
        prevLesson: prevNav,
        nextLesson: nextNav,
        phaseUrl,
        courseUrl,
        previewMode: false,
      })}
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindCourseOutlineDrawer(root);

      bindLessonReader(root, {
        lessonQuiz,
        orderState: orderByLessonQuizQuestion,
        onSubmitQuiz: async (answersMap) => {
          if (!lessonQuiz) return;
          const retakeKey = buildIdempotencyKey(
            'lesson-quiz-attempt',
            userId,
            lessonQuiz.id,
            lessonQuizAttempts.length + 1,
            Date.now()
          );
          const graded = await submitQuiz(userId, lessonQuiz.id, answersMap, retakeKey);
          lastResultByLessonQuiz[lessonQuiz.id] = graded;
          showToast(
            graded.reviewStatus === 'pending_review'
              ? 'Submitted! Written answers queued for administrator review.'
              : graded.passed
                ? `Passed with ${graded.percentage}%!`
                : `Scored ${graded.percentage}%. Review feedback and try again.`,
            graded.passed ? 'success' : 'info'
          );
          await rerender({ silent: true });
        },
        onSaveNotes: async (value) => {
          await saveLessonNotes(userId, lesson.id, course.id, value);
        },
        onToggleComplete: async () => {
          const nextDone = !lp?.completed;
          await toggleLessonComplete(
            userId,
            course.id,
            lesson.id,
            lesson.estMinutes || 0,
            nextDone
          );
          showToast(nextDone ? 'Lesson marked complete!' : 'Lesson marked incomplete.', 'success');
          rerender({ silent: true });
        },
        onError: (msg) => showToast(msg, 'error'),
      });
    },
  };
}
