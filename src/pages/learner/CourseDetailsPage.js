import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { enrollInCourse, setCourseEnrollmentStatus } from '../../lib/repositories/progressRepository.js';
import { renderCourseThumbnailHtml } from '../../lib/courseThumbnails.js';
import { escapeHtml, formatDate, formatMinutes } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderCourseBreadcrumbs, renderCourseOutlineDrawer, bindCourseOutlineDrawer } from '../../components/CourseOutlineDrawer.js';
import { renderProgressRail, renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderCourseDetailsPage({ params, session, navigate, rerender }) {
  const userId = session?.user?.id || '';
  const ctx = await resolveCourseHierarchy({
    courseSlug: params.slug,
    userId,
    requireEnrollment: false,
  });

  if (ctx.status !== 'ok') {
    return renderHierarchyGuard({ ctx, userId, targetUrlAfterEnroll: `/courses/${params.slug}`, navigate }) || { html: '', bind() {} };
  }

  const {
    course,
    orderedPhases,
    flattenedLessons,
    enrollment,
    courseProgress,
    phaseProgressById,
    progressByLesson,
    assessments,
    challenges,
    quizAttempts,
    submissions,
  } = ctx;

  // Determine resume target (first incomplete lesson in explicit position order, or lesson 1)
  const resumeEntry =
    flattenedLessons.find((item) => !progressByLesson.get(item.lesson.id)?.completed) ||
    flattenedLessons[0] ||
    null;

  const courseLevelAssessments = assessments.filter((a) => !a.phaseId);
  const courseLevelChallenges = challenges.filter((c) => !c.phaseId);

  const breadcrumbItems = [
    { label: 'Explore', href: '/explore' },
    ...(course.skill ? [{ label: course.skill.title, href: `/skills/${course.skill.slug}` }] : []),
    { label: course.title },
  ];

  return {
    html: `
      ${renderCourseBreadcrumbs({
        items: breadcrumbItems,
        showOutlineToggle: Boolean(enrollment),
      })}
      ${
        enrollment
          ? renderCourseOutlineDrawer({
              course,
              orderedPhases,
              phaseProgressById,
              progressByLesson,
              assessments,
              challenges,
              courseProgress,
            })
          : ''
      }

      <div class="card" style="padding:0; overflow:hidden; margin-bottom:22px;">
        ${renderCourseThumbnailHtml(course, { height: '210px' })}
        <div style="padding:20px 24px; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap;">
          <div style="flex:1; min-width:260px;">
            <div class="meta-line" style="margin-bottom:6px;">
              <span>${escapeHtml(course.skill?.title || 'Skill Pathway')}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span>${escapeHtml(course.difficulty)}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">${course.estimatedDurationWeeks} weeks (${course.recommendedWeeklyHours}h/wk)</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">${orderedPhases.length} modules · ${courseProgress.totalLessons} lessons · ${courseProgress.totalActivities} activities</span>
            </div>
            <h1 class="page-title">${escapeHtml(course.title)}</h1>
            <p class="page-subtitle" style="margin-top:6px;">${escapeHtml(course.description)}</p>
            <div class="meta-line" style="margin-top:10px; font-size:12.5px;">
              <span>Instructor: <strong>${escapeHtml(course.authorName || 'Kord Curriculum Studio')}</strong></span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">Version ${Number(course.version || 1)}</span>
              ${course.updatedAt ? `<span class="meta-sep" aria-hidden="true">·</span><span>Updated ${formatDate(course.updatedAt)}</span>` : ''}
            </div>
          </div>

          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            ${
              enrollment
                ? `
                  ${renderStatusBadge(courseProgress.completionState || (courseProgress.isCompleted ? 'completed' : enrollment.status))}
                  ${
                    resumeEntry
                      ? `<a href="${escapeHtml(resumeEntry.url)}" data-link class="btn btn-primary btn-sm">
                          ${courseProgress.completedLessonsCount > 0 ? 'Continue learning' : 'Start Module 1'} ${icon('arrowRight', 14)}
                        </a>`
                      : ''
                  }
                  ${
                    !courseProgress.isCompleted
                      ? `<button type="button" class="btn btn-secondary btn-sm" id="course-pause-btn">
                          ${enrollment.status === 'paused' ? 'Resume course' : 'Pause course'}
                        </button>`
                      : ''
                  }
                `
                : `<button type="button" class="btn btn-primary" id="course-enroll-btn">Enroll in course</button>`
            }
          </div>
        </div>
      </div>

      ${
        enrollment
          ? `
        <section class="card" style="margin-bottom:24px; display:flex; flex-direction:column; gap:14px;">
          ${renderProgressRail({
            id: 'course-progress-rail',
            label: 'Earned course completion (calendar time does not auto-complete)',
            value: courseProgress.progressPercent,
            max: 100,
            detail: `${courseProgress.progressPercent}%`,
          })}
          <div class="kpi-strip">
            <div class="kpi-box" style="padding:12px 14px;">
              <div class="kpi-label">Modules completed</div>
              <div class="kpi-value mono-num" style="font-size:1.25rem;">${courseProgress.completedPhasesCount}/${courseProgress.totalPhasesCount}</div>
            </div>
            <div class="kpi-box" style="padding:12px 14px;">
              <div class="kpi-label">Lessons &amp; activities</div>
              <div class="kpi-value mono-num" style="font-size:1.25rem;">${courseProgress.completedLessonsCount + courseProgress.completedActivitiesCount}/${courseProgress.requiredLessonsCount + courseProgress.requiredActivitiesCount}</div>
            </div>
            <div class="kpi-box" style="padding:12px 14px;">
              <div class="kpi-label">Checks &amp; capstone</div>
              <div class="kpi-value mono-num" style="font-size:1.25rem;">${courseProgress.passedAssessmentsCount + courseProgress.approvedChallengesCount}/${courseProgress.assessmentsCount + courseProgress.challengesCount}</div>
            </div>
            <div class="kpi-box" style="padding:12px 14px;">
              <div class="kpi-label">Pace &amp; projection</div>
              <div class="kpi-value" style="font-size:1rem; margin-top:8px;">
                ${courseProgress.isCompleted ? 'Completed' : `Est. ${formatDate(courseProgress.projectedCompletionAt)}`}
              </div>
              <div class="kpi-meta">${formatMinutes(courseProgress.actualMinutesSpent)} logged</div>
            </div>
          </div>
        </section>
      `
          : `
        <section class="card-workspace" style="margin-bottom:24px; display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;">
          <div>
            <h2 style="font-size:1.05rem; color:var(--color-navy);">Ready to start this structured pathway?</h2>
            <p style="font-size:13.5px; color:var(--color-text-secondary); margin-top:4px;">
              Enroll explicitly to unlock all ${orderedPhases.length} phase pages, individual lesson modules, study notes, and graded assessments.
            </p>
          </div>
          <button type="button" class="btn btn-primary" id="course-enroll-btn-banner">Enroll in course</button>
        </section>
      `
      }

      <div class="lab-split">
        <!-- LEFT: Phase Directory Cards ONLY (No Inline Full Lesson Bodies) -->
        <div style="display:flex; flex-direction:column; gap:20px;">
          <section>
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
              <h2 class="section-heading" style="margin:0;">Course phases (${orderedPhases.length})</h2>
              <span style="font-size:13px; color:var(--color-text-muted);">Open any phase to view and launch its individual lessons</span>
            </div>

            ${
              orderedPhases.length > 0
                ? `
              <div style="display:flex; flex-direction:column; gap:14px;">
                ${orderedPhases
                  .map((phase) => {
                    const pp = phaseProgressById[phase.id];
                    const phaseUrl = `/courses/${course.slug}/phases/${phase.id}`;
                    const lessons = phase.lessons || [];
                    const activitiesCount = (phase.activities || []).length;
                    const phaseAssCount = assessments.filter((a) => a.phaseId === phase.id).length;
                    const phaseChalCount = challenges.filter((c) => c.phaseId === phase.id).length;

                    return `
                      <article class="card card-interactive" style="display:flex; flex-direction:column; gap:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                          <div>
                            <div class="meta-line" style="margin-bottom:4px;">
                              <span>Module ${phase.position}</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span>${escapeHtml(phase.difficulty || course.difficulty)}</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span class="mono-num">${phase.estHours || 2} hrs</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span class="mono-num">${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}</span>
                              ${activitiesCount > 0 ? `<span class="meta-sep" aria-hidden="true">·</span><span class="mono-num">${activitiesCount} ${activitiesCount === 1 ? 'activity' : 'activities'}</span>` : ''}
                              ${phaseAssCount > 0 ? `<span class="meta-sep" aria-hidden="true">·</span><span class="mono-num">${phaseAssCount} assessment</span>` : ''}
                              ${phaseChalCount > 0 ? `<span class="meta-sep" aria-hidden="true">·</span><span class="mono-num">${phaseChalCount} challenge</span>` : ''}
                            </div>
                            <h3 style="font-size:1.15rem; color:var(--color-navy);">${escapeHtml(phase.title)}</h3>
                          </div>
                          ${enrollment ? renderStatusBadge(pp?.status || 'not_started') : ''}
                        </div>

                        ${phase.summary ? `<p style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(phase.summary)}</p>` : ''}

                        ${
                          phase.objectives?.length
                            ? `
                          <ul style="margin:0; padding-left:18px; font-size:13px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:3px;">
                            ${phase.objectives.slice(0, 3).map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
                          </ul>
                        `
                            : ''
                        }

                        ${
                          enrollment
                            ? renderProgressRail({
                                label: `${pp?.completedLessonsCount || 0}/${pp?.requiredLessonsCount || 0} required lessons completed`,
                                value: pp?.progressPercent || 0,
                                max: 100,
                                detail: `${pp?.progressPercent || 0}%`,
                              })
                            : ''
                        }

                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding-top:10px; border-top:1px solid var(--color-border); flex-wrap:wrap;">
                          <span style="font-size:12.5px; color:var(--color-text-muted);">
                            ${enrollment ? 'Click to open dedicated phase overview &amp; lesson list' : 'Enroll above to unlock this phase'}
                          </span>
                          ${
                            enrollment
                              ? `<a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-primary btn-sm">Open phase ${icon('arrowRight', 14)}</a>`
                              : `<button type="button" class="btn btn-secondary btn-sm" data-enroll-prompt="${escapeHtml(phase.id)}">Enroll to open</button>`
                          }
                        </div>
                      </article>
                    `;
                  })
                  .join('')}
              </div>
            `
                : `
              <div class="state-box">
                <h3 style="font-size:1rem;">Phases are being prepared</h3>
                <p>No phases have been added to this course yet.</p>
              </div>
            `
            }
          </section>
        </div>

        <!-- RIGHT SIDEBAR: Course Objectives, Prerequisites, Completion Rules & Final Checks -->
        <aside style="display:flex; flex-direction:column; gap:18px;">
          ${
            course.outcomes?.length
              ? `
            <section class="card">
              <h2 style="font-size:1.05rem; margin-bottom:10px;">Learning objectives</h2>
              <ul style="margin:0; padding-left:18px; font-size:13.5px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:6px;">
                ${course.outcomes.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
              </ul>
            </section>
          `
              : ''
          }

          <section class="card" style="display:flex; flex-direction:column; gap:12px;">
            <h2 style="font-size:1.05rem;">Audience, Schedule &amp; Prerequisites</h2>
            ${
              course.targetAudience
                ? `<div style="font-size:13.5px; color:var(--color-text-secondary);"><strong style="color:var(--color-navy);">Who this course is for:</strong> ${escapeHtml(course.targetAudience)}</div>`
                : ''
            }
            <div style="font-size:13.5px; color:var(--color-text-secondary);">
              <strong style="color:var(--color-navy);">Recommended schedule:</strong>
              ${escapeHtml(course.recommendedSchedule || `${course.recommendedWeeklyHours} hours/week over ${course.estimatedDurationWeeks} weeks`)}
            </div>
            ${
              course.associatedSkills?.length
                ? `
              <div>
                <strong style="font-size:13px; color:var(--color-navy);">Connected competencies (${course.associatedSkills.length}):</strong>
                <div style="display:flex; flex-direction:column; gap:4px; margin-top:6px;">
                  ${course.associatedSkills
                    .map(
                      (sk) => `<a href="/skills/${escapeHtml(sk.slug)}" data-link style="font-size:13px;">${escapeHtml(sk.title)} (${escapeHtml(sk.category)})</a>`
                    )
                    .join('')}
                </div>
              </div>
            `
                : ''
            }
            ${
              course.prerequisites?.length
                ? `
              <div>
                <strong style="font-size:13px; color:var(--color-navy);">Prerequisites:</strong>
                <ul style="margin:6px 0 0; padding-left:18px; font-size:13px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:4px;">
                  ${course.prerequisites.map((pr) => `<li>${escapeHtml(pr)}</li>`).join('')}
                </ul>
              </div>
            `
                : `<div style="font-size:13px; color:var(--color-text-muted);">No formal prerequisites required.</div>`
            }
            <div style="padding:10px 12px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-sm); font-size:12.5px; color:var(--color-text-secondary);">
              <strong style="color:var(--color-navy);">Completion criteria:</strong>
              Finish all required lessons and practical activities, pass graded assessments, and earn administrator approval on the practical capstone. Passing quizzes alone leaves status at <em>Awaiting practical assessment</em>.
            </div>
          </section>

          ${
            courseLevelAssessments.length > 0 || courseLevelChallenges.length > 0
              ? `
            <section class="card-workspace" style="padding:18px; display:flex; flex-direction:column; gap:10px;">
              <h2 style="font-size:1.05rem;">Course Assessments &amp; Capstone</h2>
              ${courseLevelAssessments
                .map((q) => {
                  const passed = quizAttempts.some((att) => att.quizId === q.id && att.passed && att.reviewStatus !== 'pending_review');
                  return enrollment
                    ? `<a href="/courses/${escapeHtml(course.slug)}/assessments/${escapeHtml(q.id)}" data-link class="btn ${passed ? 'btn-secondary' : 'btn-primary'} btn-sm" style="justify-content:space-between;">
                        <span>${escapeHtml(q.title)}</span>
                        <span>${passed ? 'Passed' : 'Open assessment →'}</span>
                      </a>`
                    : `<div class="divider-row" style="font-size:13px;">
                        <span>${escapeHtml(q.title)}</span>
                        <span style="color:var(--color-text-muted);">Enroll to start</span>
                      </div>`;
                })
                .join('')}
              ${courseLevelChallenges
                .map((c) => {
                  const approved = submissions.some((s) => s.challengeId === c.id && s.status === 'approved');
                  return enrollment
                    ? `<a href="/courses/${escapeHtml(course.slug)}/challenges/${escapeHtml(c.id)}" data-link class="btn ${approved ? 'btn-secondary' : 'btn-navy'} btn-sm" style="justify-content:space-between;">
                        <span>${escapeHtml(c.title)}</span>
                        <span>${approved ? 'Approved' : 'Open challenge →'}</span>
                      </a>`
                    : `<div class="divider-row" style="font-size:13px;">
                        <span>${escapeHtml(c.title)}</span>
                        <span style="color:var(--color-text-muted);">Enroll to submit</span>
                      </div>`;
                })
                .join('')}
            </section>
          `
              : ''
          }
        </aside>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindCourseOutlineDrawer(root);

      /** @param {HTMLButtonElement | null} btn */
      const triggerEnroll = async (btn) => {
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        btn.textContent = 'Enrolling…';
        try {
          await enrollInCourse(userId, course.id);
          showToast(`Enrolled in ${course.title}!`, 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Enroll in course';
          showToast(err instanceof Error ? err.message : 'Unable to enroll in this course.', 'error');
        }
      };

      root.querySelector('#course-enroll-btn')?.addEventListener('click', (e) => {
        triggerEnroll(/** @type {HTMLButtonElement | null} */ (e.currentTarget));
      });
      root.querySelector('#course-enroll-btn-banner')?.addEventListener('click', (e) => {
        triggerEnroll(/** @type {HTMLButtonElement | null} */ (e.currentTarget));
      });

      root.querySelectorAll('[data-enroll-prompt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          showToast('Click "Enroll in course" to unlock phases and lessons.', 'info');
          /** @type {HTMLElement | null} */ (root.querySelector('#course-enroll-btn'))?.focus();
        });
      });

      root.querySelector('#course-pause-btn')?.addEventListener('click', async () => {
        if (!enrollment) return;
        const nextStatus = enrollment.status === 'paused' ? 'active' : 'paused';
        try {
          await setCourseEnrollmentStatus(userId, course.id, nextStatus);
          showToast(nextStatus === 'paused' ? 'Course paused.' : 'Course resumed.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to update course status.', 'error');
        }
      });
    },
  };
}
