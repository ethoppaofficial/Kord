import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { saveLessonNotes, toggleLessonComplete } from '../../lib/repositories/progressRepository.js';
import {
  renderSimplifiedLessonView,
  bindSimplifiedLessonAssessment,
} from '../../lib/lessonArticle.js';
import { escapeHtml } from '../../lib/formatters.js';
import {
  renderCourseBreadcrumbs,
  renderCourseOutlineDrawer,
  bindCourseOutlineDrawer,
} from '../../components/CourseOutlineDrawer.js';
import { renderProgressRail, renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

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
    quizAttempts,
  } = ctx;

  if (!phase || !lesson) {
    return { html: '', bind() {} };
  }

  const lp = progressByLesson.get(lesson.id);
  const wordCount = (lp?.notes || '').trim().split(/\s+/).filter(Boolean).length;
  const lessonAssessments = assessments.filter((a) => a.lessonId === lesson.id);

  const phaseUrl = `/courses/${course.slug}/phases/${phase.id}`;
  const courseUrl = `/courses/${course.slug}`;

  const breadcrumbItems = [
    { label: 'Explore', href: '/explore' },
    ...(course.skill ? [{ label: course.skill.title, href: `/skills/${course.skill.slug}` }] : []),
    { label: course.title, href: courseUrl },
    { label: `Phase ${phase.position}: ${phase.title}`, href: phaseUrl },
    { label: lesson.title },
  ];

  const nextLabel = nextLesson
    ? nextLesson.phase.id !== phase.id
      ? `Next (Phase ${nextLesson.phase.position}): ${nextLesson.lesson.title} →`
      : `Next lesson: ${nextLesson.lesson.title} →`
    : null;
  const prevLabel = prevLesson
    ? prevLesson.phase.id !== phase.id
      ? `← Previous (Phase ${prevLesson.phase.position})`
      : `← Previous lesson`
    : null;

  const linkedQuizzesHtml =
    lessonAssessments.length > 0
      ? `
        <div class="lesson-linked-assessments-row">
          ${lessonAssessments
            .map((q) => {
              const passed = quizAttempts.some(
                (a) => a.quizId === q.id && a.passed && a.reviewStatus !== 'pending_review'
              );
              return `<a href="/courses/${escapeHtml(course.slug)}/assessments/${escapeHtml(q.id)}" data-link class="btn ${passed ? 'btn-secondary' : 'btn-primary'} btn-sm">
                ${passed ? 'Assessment passed' : `Take graded check: ${escapeHtml(q.title)} →`}
              </a>`;
            })
            .join('')}
        </div>
      `
      : '';

  const assessmentScopeId = `les_${String(lesson.id || 'current').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const { html: lessonArticleHtml, assessmentQuestions } = renderSimplifiedLessonView(lesson, {
    phaseLabel: `Phase ${phase.position}: ${phase.title}`,
    statusBadgeHtml: renderStatusBadge(lp?.completed ? 'completed' : 'not_started'),
    showStatusBadge: true,
    assessmentScopeId,
    linkedQuizzesHtml,
  });

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

      <section class="lesson-context-bar" aria-label="Course progress context">
        <div class="lesson-context-top">
          <div class="meta-line">
            <span>${escapeHtml(course.title)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>Phase ${phase.position}, Lesson ${(lessonEntry?.lessonIdx || 0) + 1} of ${(phase.lessons || []).length}</span>
          </div>
          <a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-ghost btn-sm">← Phase overview</a>
        </div>
        ${renderProgressRail({
          label: `Course progress (${courseProgress.completedLessonsCount}/${courseProgress.requiredLessonsCount} lessons completed)`,
          value: courseProgress.progressPercent,
          max: 100,
          detail: `${courseProgress.progressPercent}%`,
        })}
      </section>

      <article class="card pop-in lesson-reader-shell">
        ${lessonArticleHtml}

        <!-- Study Notes & Explicit Completion Controls -->
        <section class="lesson-study-footer" aria-label="Study notes and completion">
          <div class="field" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <label class="field-label" for="lesson-notes">Your study notes (autosaved)</label>
              <span id="notes-save-status" style="font-size:12px; color:var(--color-text-muted);">
                ${wordCount} words · ${lp?.notes ? 'Saved' : 'Ready'}
              </span>
            </div>
            <textarea class="textarea" id="lesson-notes" style="min-height:88px;" placeholder="Summarize key concepts or capture notes for the practical application…">${escapeHtml(lp?.notes || '')}</textarea>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <button type="button" class="btn ${lp?.completed ? 'btn-secondary' : 'btn-primary'}" id="toggle-lesson-complete">
              ${lp?.completed ? 'Mark lesson incomplete' : 'Mark lesson complete'}
            </button>
          </div>
        </section>

        <nav class="lesson-nav-footer" aria-label="Lesson sequence navigation">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${
              prevLesson
                ? `<a href="${escapeHtml(prevLesson.url)}" data-link class="btn btn-secondary btn-sm">${escapeHtml(prevLabel)}</a>`
                : `<a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-secondary btn-sm">← Phase overview</a>`
            }
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-ghost btn-sm">Return to phase</a>
            <a href="${escapeHtml(courseUrl)}" data-link class="btn btn-ghost btn-sm">Back to course</a>
          </div>

          <div>
            ${
              nextLesson
                ? `<a href="${escapeHtml(nextLesson.url)}" data-link class="btn btn-navy btn-sm">${escapeHtml(nextLabel)}</a>`
                : `<a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-navy btn-sm">Finish &amp; return to phase →</a>`
            }
          </div>
        </nav>
      </article>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindCourseOutlineDrawer(root);
      bindSimplifiedLessonAssessment(root, assessmentQuestions, assessmentScopeId);

      const notesEl = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('#lesson-notes'));
      const statusEl = /** @type {HTMLElement | null} */ (root.querySelector('#notes-save-status'));
      /** @type {number | undefined} */
      let saveTimer;
      notesEl?.addEventListener('input', () => {
        const words = notesEl.value.trim().split(/\s+/).filter(Boolean).length;
        if (statusEl) statusEl.textContent = `${words} words · Saving…`;
        if (saveTimer !== undefined) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(async () => {
          try {
            await saveLessonNotes(userId, lesson.id, course.id, notesEl.value);
            if (statusEl) statusEl.textContent = `${words} words · Saved`;
          } catch (err) {
            if (statusEl) statusEl.textContent = `${words} words · Save failed`;
            showToast(err instanceof Error ? err.message : 'Unable to save notes.', 'error');
          }
        }, 300);
      });

      root.querySelector('#toggle-lesson-complete')?.addEventListener('click', async (e) => {
        const btn = /** @type {HTMLButtonElement | null} */ (e.currentTarget);
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        const nextDone = !lp?.completed;
        try {
          await toggleLessonComplete(
            userId,
            course.id,
            lesson.id,
            lesson.estMinutes || 0,
            nextDone
          );
          showToast(nextDone ? 'Lesson marked complete!' : 'Lesson marked incomplete.', 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          showToast(err instanceof Error ? err.message : 'Unable to update lesson status.', 'error');
        }
      });
    },
  };
}
