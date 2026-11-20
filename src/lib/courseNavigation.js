import { getCourseBySlug } from './repositories/contentRepository.js';
import {
  getCourseEnrollments,
  getLessonProgress,
  enrollInCourse,
} from './repositories/progressRepository.js';
import { getQuizAttempts } from './repositories/quizRepository.js';
import { getUserSubmissions } from './repositories/submissionRepository.js';
import { computeCourseProgress } from './progressionEngine.js';
import { escapeHtml } from './formatters.js';
import { renderErrorState } from '../components/Common.js';
import { showToast } from '../components/Toast.js';

/**
 * Resolves and validates Course -> Phase -> Lesson hierarchy using explicit numeric position ordering.
 * Enforces explicit enrollment for phase/lesson/assessment deep links and verifies parent-child ownership.
 */
export async function resolveCourseHierarchy({
  courseSlug,
  phaseId = null,
  lessonId = null,
  userId,
  requireEnrollment = true,
  includeDrafts = false,
}) {
  const course = await getCourseBySlug(courseSlug, { includeDrafts });
  if (!course) {
    return { status: 'not_found' };
  }

  const [enrollments, lessonProgress, submissions] = await Promise.all([
    userId ? getCourseEnrollments(userId) : Promise.resolve([]),
    userId ? getLessonProgress(userId, course.id) : Promise.resolve([]),
    userId ? getUserSubmissions(userId) : Promise.resolve([]),
  ]);

  const enrollment = enrollments.find((e) => e.courseId === course.id) || null;
  if (requireEnrollment && !enrollment) {
    return { status: 'enrollment_required', course };
  }

  const assessments = course.assessments || [];
  const challenges = course.challenges || [];
  const attemptsNested = userId
    ? await Promise.all(assessments.map((q) => getQuizAttempts(userId, q.id)))
    : [];
  const quizAttempts = attemptsNested.flat();

  const orderedPhases = (course.phases || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((p) => ({
      ...p,
      lessons: (p.lessons || [])
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0)),
    }));

  const normalizedCourse = { ...course, phases: orderedPhases };
  const courseProgress = computeCourseProgress({
    course: normalizedCourse,
    lessonProgress,
    assessments,
    quizAttempts,
    challenges,
    submissions,
    enrollment,
  });

  const progressByLesson = new Map(lessonProgress.map((lp) => [lp.lessonId, lp]));

  // Flattened ordered lesson index across all phases (respecting explicit position order)
  const flattenedLessons = [];
  orderedPhases.forEach((p, phaseIdx) => {
    p.lessons.forEach((l, lessonIdx) => {
      flattenedLessons.push({
        lesson: l,
        phase: p,
        phaseIdx,
        lessonIdx,
        globalIdx: flattenedLessons.length,
        url: `/courses/${course.slug}/phases/${p.id}/lessons/${l.id}`,
      });
    });
  });

  let phase = null;
  let phaseIdx = -1;
  let prevPhase = null;
  let nextPhase = null;

  if (phaseId !== null) {
    phaseIdx = orderedPhases.findIndex((p) => p.id === phaseId);
    if (phaseIdx < 0) {
      return { status: 'invalid_phase', course: normalizedCourse, enrollment, courseProgress };
    }
    phase = orderedPhases[phaseIdx];
    prevPhase = phaseIdx > 0 ? orderedPhases[phaseIdx - 1] : null;
    nextPhase = phaseIdx + 1 < orderedPhases.length ? orderedPhases[phaseIdx + 1] : null;
  }

  let lesson = null;
  let lessonEntry = null;
  let prevLesson = null;
  let nextLesson = null;

  if (lessonId !== null) {
    if (!phase) {
      return { status: 'invalid_phase', course: normalizedCourse, enrollment, courseProgress };
    }
    const belongsToPhase = phase.lessons.some((l) => l.id === lessonId);
    if (!belongsToPhase) {
      return {
        status: 'invalid_lesson',
        course: normalizedCourse,
        phase,
        enrollment,
        courseProgress,
      };
    }
    const gIdx = flattenedLessons.findIndex(
      (item) => item.phase.id === phase.id && item.lesson.id === lessonId
    );
    lessonEntry = flattenedLessons[gIdx] || null;
    lesson = lessonEntry?.lesson || null;
    // Cross-phase sequential navigation as confirmed
    prevLesson = gIdx > 0 ? flattenedLessons[gIdx - 1] : null;
    nextLesson = gIdx >= 0 && gIdx + 1 < flattenedLessons.length ? flattenedLessons[gIdx + 1] : null;
  }

  return {
    status: 'ok',
    course: normalizedCourse,
    orderedPhases,
    flattenedLessons,
    phase,
    phaseIdx,
    prevPhase,
    nextPhase,
    lesson,
    lessonEntry,
    prevLesson,
    nextLesson,
    enrollment,
    courseProgress,
    phaseProgressById: courseProgress.phaseProgressById || {},
    progressByLesson,
    assessments,
    challenges,
    quizAttempts,
    submissions,
  };
}

export function renderHierarchyGuard({ ctx, userId, targetUrlAfterEnroll, navigate }) {
  if (ctx.status === 'not_found') {
    return {
      html:
        renderErrorState({
          title: 'Course not found',
          message: 'This course is unavailable, unpublished, or does not exist.',
        }) +
        `<div style="text-align:center; margin-top:16px;"><a href="/explore" data-link class="btn btn-primary btn-sm">Explore skills &amp; courses</a></div>`,
      bind() {},
    };
  }

  if (ctx.status === 'enrollment_required') {
    const course = ctx.course;
    return {
      html: `
        <div style="margin-bottom:14px;">
          <a href="/courses/${escapeHtml(course.slug)}" data-link style="font-size:14px; font-weight:500;">← Back to course details</a>
        </div>
        <div class="card" style="max-width:640px; margin:24px auto; text-align:center; display:flex; flex-direction:column; gap:14px; align-items:center;">
          <h1 class="page-title" style="font-size:1.4rem;">Enroll to unlock this course</h1>
          <p style="font-size:14.5px; color:var(--color-text-secondary); max-width:50ch;">
            You need to enroll in <strong>${escapeHtml(course.title)}</strong> before opening individual phases, lessons, or graded course checks.
          </p>
          <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">
            <button type="button" class="btn btn-primary" id="guard-enroll-btn">Enroll in course &amp; continue</button>
            <a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-secondary">View course details</a>
          </div>
        </div>
      `,
      bind(root) {
        root.querySelector('#guard-enroll-btn')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          if (btn.disabled) return;
          btn.disabled = true;
          btn.textContent = 'Enrolling…';
          try {
            await enrollInCourse(userId, course.id);
            showToast(`Enrolled in ${course.title}!`, 'success');
            navigate(targetUrlAfterEnroll || `/courses/${course.slug}`);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Enroll in course & continue';
            showToast(err?.message || 'Unable to enroll right now.', 'error');
          }
        });
      },
    };
  }

  if (ctx.status === 'invalid_phase') {
    return {
      html:
        renderErrorState({
          title: 'Phase not found in this course',
          message: 'The requested phase does not exist or does not belong to this course.',
        }) +
        `<div style="text-align:center; margin-top:16px;"><a href="/courses/${escapeHtml(ctx.course.slug)}" data-link class="btn btn-primary btn-sm">Return to Course Overview</a></div>`,
      bind() {},
    };
  }

  if (ctx.status === 'invalid_lesson') {
    return {
      html:
        renderErrorState({
          title: 'Lesson not found in this phase',
          message: 'The requested lesson does not belong to the selected phase in this course.',
        }) +
        `<div style="text-align:center; margin-top:16px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <a href="/courses/${escapeHtml(ctx.course.slug)}/phases/${escapeHtml(ctx.phase.id)}" data-link class="btn btn-primary btn-sm">Return to Phase Overview</a>
          <a href="/courses/${escapeHtml(ctx.course.slug)}" data-link class="btn btn-secondary btn-sm">Course Details</a>
        </div>`,
      bind() {},
    };
  }

  return null;
}
