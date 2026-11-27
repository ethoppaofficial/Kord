import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { togglePhaseActivityComplete } from '../../lib/repositories/progressRepository.js';
import { escapeHtml } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderCourseBreadcrumbs, renderCourseOutlineDrawer, bindCourseOutlineDrawer } from '../../components/CourseOutlineDrawer.js';
import { renderProgressRail, renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderCoursePhasePage({ params, session, navigate, rerender }) {
  const userId = session?.user?.id || '';
  const targetUrl = `/courses/${params.slug}/phases/${params.phaseId}`;

  const ctx = await resolveCourseHierarchy({
    courseSlug: params.slug,
    phaseId: params.phaseId,
    userId,
    requireEnrollment: true,
  });

  if (ctx.status !== 'ok') {
    return renderHierarchyGuard({ ctx, userId, targetUrlAfterEnroll: targetUrl, navigate }) || { html: '', bind() {} };
  }

  const {
    course,
    orderedPhases,
    phase,
    prevPhase,
    nextPhase,
    courseProgress,
    phaseProgressById,
    progressByLesson,
    progressByActivity,
    assessments,
    challenges,
    quizAttempts,
    submissions,
  } = ctx;

  if (!phase) {
    return { html: '', bind() {} };
  }

  const pp = phaseProgressById[phase.id];
  const lessons = phase.lessons || [];
  const activities = phase.activities || [];
  const phaseAssessments = assessments.filter((a) => a.phaseId === phase.id);
  const phaseChallenges = challenges.filter((c) => c.phaseId === phase.id);

  const breadcrumbItems = [
    { label: 'Explore', href: '/explore' },
    ...(course.skill ? [{ label: course.skill.title, href: `/skills/${course.skill.slug}` }] : []),
    { label: course.title, href: `/courses/${course.slug}` },
    { label: `Phase ${phase.position}: ${phase.title}` },
  ];

  const prevPhaseUrl = prevPhase ? `/courses/${course.slug}/phases/${prevPhase.id}` : null;
  const nextPhaseUrl = nextPhase ? `/courses/${course.slug}/phases/${nextPhase.id}` : null;

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
        courseProgress,
      })}

      <div class="page-header">
        <div>
          <div class="meta-line" style="margin-bottom:4px;">
            <span>${escapeHtml(course.title)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>Phase ${phase.position} of ${orderedPhases.length}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(phase.difficulty || course.difficulty)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span class="mono-num">Est. ${phase.estHours || 2} hrs</span>
          </div>
          <h1 class="page-title">${escapeHtml(phase.title)}</h1>
          ${phase.summary ? `<p class="page-subtitle">${escapeHtml(phase.summary)}</p>` : ''}
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          ${renderStatusBadge(pp?.status || 'not_started')}
          <a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-secondary btn-sm">← Back to course</a>
        </div>
      </div>

      <section class="card" style="margin-bottom:22px; display:flex; flex-direction:column; gap:12px;">
        ${renderProgressRail({
          label: `Module progress (${pp?.completedLessonsCount || 0}/${pp?.requiredLessonsCount || 0} lessons · ${pp?.completedActivitiesCount || 0}/${pp?.requiredActivitiesCount || 0} activities · ${pp?.passedAssessmentsCount || 0}/${pp?.assessmentsCount || 0} assessments)`,
          value: pp?.progressPercent || 0,
          max: 100,
          detail: `${pp?.progressPercent || 0}%`,
        })}
        <div style="font-size:12.5px; color:var(--color-text-muted);">
          Phase completion is earned by completing all required lessons and passing phase evaluations below—opening this page does not mark items complete.
        </div>
      </section>

      <div class="lab-split">
        <!-- LEFT: Lessons List (Dedicated Links to Lesson Pages ONLY — No Inline Lesson Bodies) -->
        <div style="display:flex; flex-direction:column; gap:18px;">
          <section class="card">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
              <h2 class="section-heading" style="margin:0;">Lessons in Phase ${phase.position} (${lessons.length})</h2>
              <span style="font-size:13px; color:var(--color-text-muted);">Select a lesson to open its dedicated page</span>
            </div>

            ${
              lessons.length > 0
                ? `
              <div class="divider-list">
                ${lessons
                  .map((les, idx) => {
                    const lp = progressByLesson.get(les.id);
                    const isDone = Boolean(lp?.completed);
                    const lessonUrl = `/courses/${course.slug}/phases/${phase.id}/lessons/${les.id}`;
                    const hasVideos = (les.videos || []).length > 0;

                    return `
                      <div class="divider-row" style="align-items:center; flex-wrap:wrap; gap:12px;">
                        <div style="min-width:0; flex:1;">
                          <div class="meta-line" style="margin-bottom:2px;">
                            <span class="mono-num">Lesson ${phase.position}.${idx + 1}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span class="mono-num">${les.estMinutes} min</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>${les.isRequired === false ? 'Optional' : 'Required'}</span>
                            ${hasVideos ? `<span class="meta-sep" aria-hidden="true">·</span><span>Video included</span>` : ''}
                          </div>
                          <a href="${escapeHtml(lessonUrl)}" data-link style="font-size:1rem; font-weight:700; color:var(--color-navy); text-decoration:none;">
                            ${escapeHtml(les.title)}
                          </a>
                          ${les.introduction ? `<p class="line-clamp-2" style="font-size:13px; color:var(--color-text-secondary); margin-top:4px;">${escapeHtml(les.introduction)}</p>` : ''}
                        </div>

                        <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                          ${renderStatusBadge(isDone ? 'completed' : 'not_started')}
                          <a href="${escapeHtml(lessonUrl)}" data-link class="btn ${isDone ? 'btn-secondary' : 'btn-primary'} btn-sm">
                            ${isDone ? 'Review lesson' : 'Open lesson'} ${icon('arrowRight', 14)}
                          </a>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            `
                : `<p style="font-size:14px; color:var(--color-text-muted);">No lessons have been authored for this phase yet.</p>`
            }

            <div class="lesson-nav-footer">
              <div>
                ${
                  prevPhaseUrl && prevPhase
                    ? `<a href="${escapeHtml(prevPhaseUrl)}" data-link class="btn btn-secondary btn-sm">← Previous: Phase ${prevPhase.position}</a>`
                    : `<a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-secondary btn-sm">← Course overview</a>`
                }
              </div>
              <a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-ghost btn-sm">All phases</a>
              <div>
                ${
                  nextPhaseUrl && nextPhase
                    ? `<a href="${escapeHtml(nextPhaseUrl)}" data-link class="btn btn-navy btn-sm">Next: Phase ${nextPhase.position} →</a>`
                    : ''
                }
              </div>
            </div>
          </section>

          ${
            activities.length > 0
              ? `
            <section class="card">
              <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                <h2 class="section-heading" style="margin:0;">Practical Activities (${activities.length})</h2>
                <span style="font-size:13px; color:var(--color-text-muted);">Apply module concepts hands-on and log your output</span>
              </div>
              <div style="display:flex; flex-direction:column; gap:14px;">
                ${activities
                  .map((act, idx) => {
                    const ap = progressByActivity?.get(act.id);
                    const isDone = Boolean(ap?.completed);
                    return `
                      <div class="activity-check-card ${isDone ? 'is-done' : ''}">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                          <div>
                            <div class="meta-line" style="margin-bottom:3px;">
                              <span class="mono-num">Activity ${phase.position}.${idx + 1}</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span class="mono-num">${act.estMinutes || 25} min</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span>${act.isRequired === false ? 'Optional' : 'Required'}</span>
                            </div>
                            <h3 style="font-size:1rem; color:var(--color-navy);">${escapeHtml(act.title)}</h3>
                          </div>
                          ${renderStatusBadge(isDone ? 'completed' : 'not_started')}
                        </div>
                        ${act.description ? `<p style="font-size:13.5px; color:var(--color-text-secondary);">${escapeHtml(act.description)}</p>` : ''}
                        ${
                          act.instructions
                            ? `<div style="font-size:13px; color:var(--color-navy); padding:10px 12px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-sm);">
                                <strong>Instructions:</strong> ${escapeHtml(act.instructions)}
                              </div>`
                            : ''
                        }
                        ${
                          act.expectedOutput
                            ? `<div style="font-size:13px; color:var(--color-text-secondary);">
                                <strong>Expected deliverable / output:</strong> ${escapeHtml(act.expectedOutput)}
                              </div>`
                            : ''
                        }
                        <div class="field">
                          <label class="field-label" style="font-size:12.5px;" for="act-notes-${escapeHtml(act.id)}">Practice log / output summary</label>
                          <textarea class="textarea" id="act-notes-${escapeHtml(act.id)}" data-activity-notes="${escapeHtml(act.id)}" style="min-height:64px;" placeholder="Record what you built, tested, or refined during this activity…">${escapeHtml(ap?.notes || '')}</textarea>
                        </div>
                        <div style="display:flex; justify-content:flex-end;">
                          <button type="button" class="btn ${isDone ? 'btn-secondary' : 'btn-primary'} btn-sm" data-toggle-activity="${escapeHtml(act.id)}" data-est-minutes="${Number(act.estMinutes || 25)}" data-done="${isDone ? '1' : '0'}">
                            ${isDone ? 'Activity completed (undo)' : 'Mark activity complete'}
                          </button>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </section>
          `
              : ''
          }
        </div>

        <!-- RIGHT SIDEBAR: Phase Objectives, Completion Requirements, Assessments & Challenges -->
        <aside style="display:flex; flex-direction:column; gap:18px;">
          ${
            phase.objectives?.length
              ? `
            <section class="card">
              <h2 style="font-size:1.05rem; margin-bottom:10px;">Phase learning objectives</h2>
              <ul style="margin:0; padding-left:18px; font-size:13.5px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:6px;">
                ${phase.objectives.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
              </ul>
            </section>
          `
              : ''
          }

          <section class="card-workspace" style="padding:18px; display:flex; flex-direction:column; gap:10px;">
            <h2 style="font-size:1.05rem;">Phase completion requirements</h2>
            <ul style="margin:0; padding-left:18px; font-size:13px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:5px;">
              <li>Complete all <strong class="mono-num">${pp?.requiredLessonsCount || 0}</strong> required lessons in this module</li>
              ${(pp?.requiredActivitiesCount || 0) > 0 ? `<li>Complete <strong class="mono-num">${pp?.requiredActivitiesCount || 0}</strong> practical activity(ies)</li>` : ''}
              ${phaseAssessments.length > 0 ? `<li>Pass <strong class="mono-num">${phaseAssessments.length}</strong> module assessment(s)</li>` : ''}
              ${phaseChallenges.length > 0 ? `<li>Earn approval on <strong class="mono-num">${phaseChallenges.length}</strong> practical challenge(s)</li>` : ''}
            </ul>

            ${
              phaseAssessments.length > 0 || phaseChallenges.length > 0
                ? `
              <div style="margin-top:6px; padding-top:10px; border-top:1px solid var(--color-blue-border); display:flex; flex-direction:column; gap:8px;">
                ${phaseAssessments
                  .map((q) => {
                    const passed = quizAttempts.some((a) => a.quizId === q.id && a.passed && a.reviewStatus !== 'pending_review');
                    return `
                      <a href="/courses/${escapeHtml(course.slug)}/assessments/${escapeHtml(q.id)}" data-link class="btn ${passed ? 'btn-secondary' : 'btn-primary'} btn-sm" style="justify-content:space-between;">
                        <span>${escapeHtml(q.title)}</span>
                        <span>${passed ? 'Passed' : 'Start assessment →'}</span>
                      </a>
                    `;
                  })
                  .join('')}
                ${phaseChallenges
                  .map((c) => {
                    const approved = submissions.some((s) => s.challengeId === c.id && s.status === 'approved');
                    return `
                      <a href="/courses/${escapeHtml(course.slug)}/challenges/${escapeHtml(c.id)}" data-link class="btn ${approved ? 'btn-secondary' : 'btn-navy'} btn-sm" style="justify-content:space-between;">
                        <span>${escapeHtml(c.title)}</span>
                        <span>${approved ? 'Approved' : 'Open challenge →'}</span>
                      </a>
                    `;
                  })
                  .join('')}
              </div>
            `
                : ''
            }
          </section>
        </aside>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindCourseOutlineDrawer(root);

      root.querySelectorAll('[data-toggle-activity]').forEach((node) => {
        const btn = /** @type {HTMLButtonElement} */ (node);
        btn.addEventListener('click', async () => {
          if (btn.disabled) return;
          btn.disabled = true;
          const actId = btn.dataset.toggleActivity || '';
          const nextDone = btn.dataset.done !== '1';
          const estMinutes = Number(btn.dataset.estMinutes || 25);
          const notesEl = /** @type {HTMLTextAreaElement | null} */ (
            root.querySelector(`[data-activity-notes="${actId}"]`)
          );
          const notes = notesEl?.value || '';
          try {
            await togglePhaseActivityComplete(userId, course.id, actId, estMinutes, nextDone, notes);
            showToast(nextDone ? 'Practical activity marked complete!' : 'Activity updated.', 'success');
            rerender({ silent: true });
          } catch (err) {
            btn.disabled = false;
            showToast(err instanceof Error ? err.message : 'Unable to update activity progress.', 'error');
          }
        });
      });
    },
  };
}
