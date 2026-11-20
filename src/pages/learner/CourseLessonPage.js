import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { saveLessonNotes, toggleLessonComplete } from '../../lib/repositories/progressRepository.js';
import { renderLessonBlocks } from '../../lib/lessonBlocks.js';
import { renderVideoPlayerHtml } from '../../lib/videoProvider.js';
import { escapeHtml } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderCourseBreadcrumbs, renderCourseOutlineDrawer, bindCourseOutlineDrawer } from '../../components/CourseOutlineDrawer.js';
import { renderProgressRail, renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

export async function renderCourseLessonPage({ params, session, navigate, rerender }) {
  const userId = session.user.id;
  const targetUrl = `/courses/${params.slug}/phases/${params.phaseId}/lessons/${params.lessonId}`;

  const ctx = await resolveCourseHierarchy({
    courseSlug: params.slug,
    phaseId: params.phaseId,
    lessonId: params.lessonId,
    userId,
    requireEnrollment: true,
  });

  if (ctx.status !== 'ok') {
    return renderHierarchyGuard({ ctx, userId, targetUrlAfterEnroll: targetUrl, navigate });
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

  // Clear cross-phase Next / Previous labels
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

      <!-- Compact Course Progress Context Strip -->
      <section class="card" style="padding:14px 18px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px;">
          <div class="meta-line">
            <span>${escapeHtml(course.skill?.title || 'Skill')}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(course.title)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>Phase ${phase.position}, Lesson ${(lessonEntry?.lessonIdx || 0) + 1} of ${(phase.lessons || []).length}</span>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-ghost btn-sm">← Phase overview</a>
          </div>
        </div>
        ${renderProgressRail({
          label: `Overall course progress (${courseProgress.completedLessonsCount}/${courseProgress.requiredLessonsCount} lessons completed)`,
          value: courseProgress.progressPercent,
          max: 100,
          detail: `${courseProgress.progressPercent}%`,
        })}
      </section>

      <!-- Single Lesson Reader (No Combined Multi-Lesson Dump) -->
      <article class="card pop-in" style="max-width:920px; margin:0 auto;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; padding-bottom:16px; border-bottom:1px solid var(--color-border); margin-bottom:18px;">
          <div>
            <div class="meta-line" style="margin-bottom:4px;">
              <span>Phase ${phase.position}: ${escapeHtml(phase.title)}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">${lesson.estMinutes} min</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span>${lesson.isRequired === false ? 'Optional' : 'Required'}</span>
            </div>
            <h1 class="page-title">${escapeHtml(lesson.title)}</h1>
          </div>
          ${lp?.completed ? renderStatusBadge('completed') : renderStatusBadge('not_started')}
        </div>

        ${
          lesson.introduction
            ? `<p class="lesson-paragraph" style="font-size:15.5px; color:var(--color-navy); font-weight:500;">${escapeHtml(lesson.introduction)}</p>`
            : ''
        }

        ${
          lesson.objectives?.length
            ? `
          <div class="card-workspace" style="padding:14px 16px; margin-bottom:18px;">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--color-blue); margin-bottom:6px;">Learning objectives</div>
            <ul style="margin:0; padding-left:18px; font-size:14px; color:var(--color-navy); display:flex; flex-direction:column; gap:4px;">
              ${lesson.objectives.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
            </ul>
          </div>
        `
            : ''
        }

        <!-- Structured JSON Lesson Blocks -->
        <div class="lesson-body">
          ${renderLessonBlocks(lesson.blocks || [])}
        </div>

        <!-- Embedded External Videos -->
        ${
          (lesson.videos || []).length > 0
            ? `
          <div style="margin-top:22px; padding-top:18px; border-top:1px solid var(--color-border);">
            <h2 style="font-size:1.1rem; margin-bottom:12px;">Video walkthrough</h2>
            ${lesson.videos.map((v, idx) => renderVideoPlayerHtml(v, idx)).join('')}
          </div>
        `
            : ''
        }

        <!-- Summary & Takeaways -->
        ${
          lesson.summary || lesson.takeaways?.length
            ? `
          <div style="margin-top:22px; padding-top:18px; border-top:1px solid var(--color-border);">
            ${lesson.summary ? `<h2 style="font-size:1.05rem; margin-bottom:6px;">Lesson summary</h2><p class="lesson-paragraph">${escapeHtml(lesson.summary)}</p>` : ''}
            ${
              lesson.takeaways?.length
                ? `
              <div style="font-size:13.5px; font-weight:700; color:var(--color-navy); margin-bottom:6px;">Key takeaways</div>
              <ul class="lesson-bullets">
                ${lesson.takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
              </ul>
            `
                : ''
            }
          </div>
        `
            : ''
        }

        ${
          lesson.furtherReading?.length
            ? `
          <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--color-border);">
            <div style="font-size:13px; font-weight:700; color:var(--color-navy); margin-bottom:8px;">Further reading &amp; resources</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${lesson.furtherReading
                .map(
                  (fr) => `<a href="${escapeHtml(fr.url)}" target="_blank" rel="noopener noreferrer" style="font-size:13.5px;">${escapeHtml(fr.title)} ${icon('externalLink', 12)}</a>`
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        ${
          lessonAssessments.length > 0
            ? `
          <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--color-border); display:flex; gap:10px; flex-wrap:wrap;">
            ${lessonAssessments
              .map((q) => {
                const passed = quizAttempts.some((a) => a.quizId === q.id && a.passed && a.reviewStatus !== 'pending_review');
                return `<a href="/courses/${escapeHtml(course.slug)}/assessments/${escapeHtml(q.id)}" data-link class="btn ${passed ? 'btn-secondary' : 'btn-primary'} btn-sm">
                  ${passed ? 'Assessment passed' : `Take check: ${escapeHtml(q.title)} →`}
                </a>`;
              })
              .join('')}
          </div>
        `
            : ''
        }

        ${
          lesson.completionCriteria
            ? `
          <div class="lesson-callout lesson-definition" style="margin-top:18px;">
            <div class="lesson-callout-kicker">Completion criteria</div>
            <div style="font-size:13.5px; color:var(--color-navy);">${escapeHtml(lesson.completionCriteria)}</div>
          </div>
        `
            : ''
        }

        <!-- Study Notes & Explicit Completion Controls -->
        <div style="margin-top:22px; padding-top:18px; border-top:1px solid var(--color-border);">
          <div class="field" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <label class="field-label" for="lesson-notes">Your study notes (autosaved)</label>
              <span id="notes-save-status" style="font-size:12px; color:var(--color-text-muted);">
                ${wordCount} words · ${lp?.notes ? 'Saved' : 'Ready'}
              </span>
            </div>
            <textarea class="textarea" id="lesson-notes" style="min-height:90px;" placeholder="Summarize key concepts or draft your action plan from this lesson…">${escapeHtml(lp?.notes || '')}</textarea>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <button type="button" class="btn ${lp?.completed ? 'btn-secondary' : 'btn-primary'}" id="toggle-lesson-complete">
              ${lp?.completed ? 'Mark lesson incomplete' : 'Mark lesson complete'}
            </button>
          </div>
        </div>

        <!-- Bottom Previous / Back to Phase / Next Lesson Navigation -->
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
    bind(root) {
      bindCourseOutlineDrawer(root);

      // Inline Knowledge Check handler
      root.querySelectorAll('[data-check-kc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const kcId = btn.dataset.checkKc;
          const box = root.querySelector(`[data-inline-kc="${kcId}"]`);
          const feedback = root.querySelector(`[data-kc-feedback="${kcId}"]`);
          if (!box || !feedback) return;
          const selected = box.querySelector(`input[name="inline_kc_${kcId}"]:checked`);
          if (!selected) {
            feedback.style.color = 'var(--color-amber)';
            feedback.textContent = 'Select an option first.';
            return;
          }
          const correct = Number(box.dataset.correct);
          const isOk = Number(selected.value) === correct;
          feedback.style.color = isOk ? 'var(--color-green)' : 'var(--color-red)';
          feedback.style.fontWeight = '600';
          feedback.textContent = isOk
            ? `Correct! ${box.dataset.explanation || ''}`
            : `Not quite. ${box.dataset.explanation || 'Review the lesson text above.'}`;
        });
      });

      // Video playback help toggle
      root.querySelectorAll('[data-video-fallback-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const helpEl = root.querySelector(`#video-help-${btn.dataset.videoFallbackToggle}`);
          if (helpEl) {
            helpEl.style.display = helpEl.style.display === 'none' ? 'block' : 'none';
          }
        });
      });

      const notesEl = root.querySelector('#lesson-notes');
      const statusEl = root.querySelector('#notes-save-status');
      let saveTimer = null;
      notesEl?.addEventListener('input', () => {
        const words = notesEl.value.trim().split(/\s+/).filter(Boolean).length;
        statusEl.textContent = `${words} words · Saving…`;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(async () => {
          await saveLessonNotes(userId, lesson.id, course.id, notesEl.value);
          statusEl.textContent = `${words} words · Saved`;
        }, 300);
      });

      root.querySelector('#toggle-lesson-complete')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        const nextDone = !lp?.completed;
        try {
          await toggleLessonComplete(
            userId,
            course.id,
            lesson.id,
            lesson.estMinutes,
            nextDone
          );
          showToast(nextDone ? 'Lesson marked complete!' : 'Lesson marked incomplete.', 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          showToast(err?.message || 'Unable to update lesson status.', 'error');
        }
      });
    },
  };
}
