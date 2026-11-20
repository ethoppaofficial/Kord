import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { escapeHtml } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderCourseBreadcrumbs, renderCourseOutlineDrawer, bindCourseOutlineDrawer } from '../../components/CourseOutlineDrawer.js';
import { renderProgressRail, renderStatusBadge } from '../../components/Common.js';

export async function renderCoursePhasePage({ params, session, navigate }) {
  const userId = session.user.id;
  const targetUrl = `/courses/${params.slug}/phases/${params.phaseId}`;

  const ctx = await resolveCourseHierarchy({
    courseSlug: params.slug,
    phaseId: params.phaseId,
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
    prevPhase,
    nextPhase,
    courseProgress,
    phaseProgressById,
    progressByLesson,
    assessments,
    challenges,
    quizAttempts,
    submissions,
  } = ctx;

  const pp = phaseProgressById[phase.id];
  const lessons = phase.lessons || [];
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
          label: `Phase progress (${pp?.completedLessonsCount || 0}/${pp?.requiredLessonsCount || 0} required lessons · ${pp?.passedAssessmentsCount || 0}/${pp?.assessmentsCount || 0} assessments · ${pp?.approvedChallengesCount || 0}/${pp?.challengesCount || 0} challenges)`,
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
                  prevPhaseUrl
                    ? `<a href="${escapeHtml(prevPhaseUrl)}" data-link class="btn btn-secondary btn-sm">← Previous: Phase ${prevPhase.position}</a>`
                    : `<a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-secondary btn-sm">← Course overview</a>`
                }
              </div>
              <a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-ghost btn-sm">All phases</a>
              <div>
                ${
                  nextPhaseUrl
                    ? `<a href="${escapeHtml(nextPhaseUrl)}" data-link class="btn btn-navy btn-sm">Next: Phase ${nextPhase.position} →</a>`
                    : ''
                }
              </div>
            </div>
          </section>
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
              <li>Complete all <strong class="mono-num">${pp?.requiredLessonsCount || 0}</strong> required lessons in this phase</li>
              ${phaseAssessments.length > 0 ? `<li>Pass <strong class="mono-num">${phaseAssessments.length}</strong> phase assessment(s)</li>` : ''}
              ${phaseChallenges.length > 0 ? `<li>Earn approval on <strong class="mono-num">${phaseChallenges.length}</strong> phase practical challenge(s)</li>` : ''}
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
    bind(root) {
      bindCourseOutlineDrawer(root);
    },
  };
}
