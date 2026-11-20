import { getSkillBySlug } from '../../lib/repositories/contentRepository.js';
import {
  getCourseEnrollments,
  enrollInCourse,
  getLessonProgress,
} from '../../lib/repositories/progressRepository.js';
import { getUserSkills, declareUserSkill } from '../../lib/repositories/skillsRepository.js';
import { listRankedOpportunities } from '../../lib/repositories/opportunityRepository.js';
import { getDemoState } from '../../lib/demo/demoStore.js';
import { computeCourseProgress, computeOverallSkillCourseProgress } from '../../lib/progressionEngine.js';
import { escapeHtml } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderProgressRail, renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

export async function renderSkillDetailPage({ params, session, navigate, rerender }) {
  const skill = await getSkillBySlug(params.slug);
  if (!skill) {
    return {
      html: renderErrorState({
        title: 'Skill not found',
        message: 'We could not find a competency matching that slug.',
      }),
      bind() {},
    };
  }

  const userId = session?.user?.id || null;
  const [enrollments, lessonProgress, userSkills, opportunities] = await Promise.all([
    userId ? getCourseEnrollments(userId) : Promise.resolve([]),
    userId ? getLessonProgress(userId) : Promise.resolve([]),
    userId ? getUserSkills(userId) : Promise.resolve([]),
    listRankedOpportunities(userId),
  ]);

  const state = getDemoState();
  const quizzes = state.quizzes || [];
  const challenges = state.challenges || [];
  const quizAttempts = userId ? (state.quizAttempts || []).filter((a) => a.userId === userId) : [];
  const submissions = userId ? (state.submissions || []).filter((s) => s.userId === userId) : [];

  const userSkill = userSkills.find((us) => us.skillId === skill.id) || null;
  const courses = skill.courses || [];

  const courseProgressById = {};
  courses.forEach((course) => {
    const enr = enrollments.find((e) => e.courseId === course.id) || null;
    courseProgressById[course.id] = computeCourseProgress({
      course,
      lessonProgress: lessonProgress.filter((lp) => lp.courseId === course.id),
      assessments: quizzes,
      quizAttempts,
      challenges,
      submissions,
      enrollment: enr,
    });
  });

  const overall = computeOverallSkillCourseProgress({
    publishedCourses: courses,
    courseProgressById,
  });

  const relatedOpps = opportunities
    .filter((o) => (o.requiredSkillSlugs || []).includes(skill.slug))
    .slice(0, 3);

  return {
    html: `
      <div style="margin-bottom:16px;">
        <a href="/explore" data-link style="font-size:14px; font-weight:500;">← Back to Explore Skills</a>
      </div>

      <div class="lab-split">
        <div style="display:flex; flex-direction:column; gap:20px;">
          <!-- Skill Competency Overview -->
          <section class="card">
            <div class="meta-line" style="margin-bottom:8px;">
              <span>${escapeHtml(skill.category)}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span>${escapeHtml(skill.level)}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">${courses.length} ${courses.length === 1 ? 'course' : 'courses'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
              <h1 class="page-title">${escapeHtml(skill.title)}</h1>
              ${userSkill ? renderStatusBadge(userSkill.level) : renderStatusBadge('declared')}
            </div>
            <p style="margin-top:12px; color:var(--color-text-secondary);">${escapeHtml(skill.summary)}</p>

            ${
              skill.competencyExpectations
                ? `
              <div style="margin-top:14px; padding:12px 14px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-sm); font-size:13.5px; color:var(--color-text-secondary);">
                <strong style="color:var(--color-navy);">Competency expectation:</strong> ${escapeHtml(skill.competencyExpectations)}
              </div>
            `
                : ''
            }

            ${
              skill.outcomes?.length
                ? `
              <div style="margin-top:18px; padding-top:16px; border-top:1px solid var(--color-border);">
                <h2 style="font-size:1rem; margin-bottom:10px;">Target competency outcomes</h2>
                <ul style="margin:0; padding-left:18px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:6px;">
                  ${skill.outcomes.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
                </ul>
              </div>
            `
                : ''
            }
          </section>

          <!-- Structured Courses Under This Skill -->
          <section>
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
              <h2 class="section-heading" style="margin:0;">Structured courses for ${escapeHtml(skill.title)} (${courses.length})</h2>
              <span style="font-size:13px; color:var(--color-text-muted);">Enroll independently in any course below</span>
            </div>

            ${
              courses.length > 0
                ? `
              <div style="display:flex; flex-direction:column; gap:16px;">
                ${courses
                  .map((course, idx) => {
                    const enr = enrollments.find((e) => e.courseId === course.id);
                    const prog = courseProgressById[course.id];
                    const phaseCount = (course.phases || []).length;
                    const lessonCount = prog.totalLessons;

                    return `
                      <article class="card card-interactive" style="display:flex; flex-direction:column; gap:14px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                          <div>
                            <div class="meta-line" style="margin-bottom:4px;">
                              <span>Course ${idx + 1}</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span>${escapeHtml(course.difficulty)}</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span class="mono-num">${course.estimatedDurationWeeks} weeks (${course.recommendedWeeklyHours}h/wk)</span>
                              <span class="meta-sep" aria-hidden="true">·</span>
                              <span class="mono-num">${phaseCount} phases · ${lessonCount} lessons</span>
                            </div>
                            <h3 style="font-size:1.15rem;">${escapeHtml(course.title)}</h3>
                          </div>
                          ${
                            prog.isCompleted
                              ? renderStatusBadge('completed')
                              : enr
                                ? renderStatusBadge(enr.status)
                                : '<span class="status-tag status-neutral">Not enrolled</span>'
                          }
                        </div>

                        <p style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(course.description)}</p>

                        ${
                          course.outcomes?.length
                            ? `
                          <ul style="margin:0; padding-left:18px; font-size:13px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:3px;">
                            ${course.outcomes.slice(0, 3).map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
                          </ul>
                        `
                            : ''
                        }

                        ${renderProgressRail({
                          label: 'Course completion',
                          value: prog.progressPercent,
                          max: 100,
                          detail: `${prog.completedLessonsCount}/${prog.requiredLessonsCount} lessons · ${prog.progressPercent}%`,
                        })}

                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding-top:10px; border-top:1px solid var(--color-border); flex-wrap:wrap;">
                          <span style="font-size:12.5px; color:var(--color-text-muted);">
                            Recommended pace: ${escapeHtml(course.recommendedSchedule || 'Self-paced weekly milestones')}
                          </span>
                          <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-secondary btn-sm">Course details</a>
                            ${
                              enr
                                ? `<a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-primary btn-sm">
                                    Continue course ${icon('arrowRight', 14)}
                                  </a>`
                                : `<button type="button" class="btn btn-primary btn-sm" data-enroll-course="${escapeHtml(course.id)}" data-course-slug="${escapeHtml(course.slug)}">
                                    Enroll in course
                                  </button>`
                            }
                          </div>
                        </div>
                      </article>
                    `;
                  })
                  .join('')}
              </div>
            `
                : `
              <div class="state-box" style="padding:28px 20px;">
                <h3 style="font-size:1.05rem;">No courses available yet</h3>
                <p>No courses are available for this skill yet. Check back later as new learning pathways are added.</p>
                <a href="/explore" data-link class="btn btn-secondary btn-sm">Browse skills with courses</a>
              </div>
            `
            }
          </section>
        </div>

        <aside style="display:flex; flex-direction:column; gap:18px;">
          <div class="card-workspace" style="display:flex; flex-direction:column; gap:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:var(--color-navy);">Skill mastery status</strong>
              ${userSkill ? renderStatusBadge(userSkill.level) : '<span style="font-size:13px; color:var(--color-text-muted);">Not tracked yet</span>'}
            </div>

            ${
              courses.length > 0
                ? renderProgressRail({
                    label: 'Courses completed toward Verified',
                    value: overall.completedCoursesCount,
                    max: Math.max(1, overall.totalPublishedCourses),
                    detail: `${overall.completedCoursesCount}/${overall.totalPublishedCourses} courses`,
                  })
                : `<div style="font-size:13px; color:var(--color-text-secondary); padding:10px 12px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-sm);">
                    Courses for ${escapeHtml(skill.title)} are not published yet. This skill cannot be marked completed or verified until published courses exist and are finished.
                  </div>`
            }

            <div style="font-size:13px; color:var(--color-text-secondary); line-height:1.5; padding:10px 12px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-sm);">
              <strong>Verification rule:</strong> Completing a single course upgrades this skill to <strong>Demonstrated</strong>. Earning <strong>Verified</strong> requires completing <strong>all published courses</strong> associated with ${escapeHtml(skill.title)} with approved assessments and challenges.
            </div>

            <button type="button" class="btn btn-secondary btn-sm" id="declare-btn" ${userSkill ? 'disabled' : ''}>
              ${userSkill ? 'Skill tracked on profile' : 'Declare skill interest'}
            </button>

            ${
              skill.skillCheckQuizId
                ? `<a href="/quiz/${escapeHtml(skill.skillCheckQuizId)}" data-link class="btn btn-secondary btn-sm">Take skill assessment</a>`
                : ''
            }
            ${
              skill.challengeId
                ? `<a href="/challenge/${escapeHtml(skill.challengeId)}" data-link class="btn btn-secondary btn-sm">Open practical challenge</a>`
                : ''
            }
          </div>

          ${
            relatedOpps.length > 0
              ? `
            <div class="card">
              <h3 style="font-size:1rem; margin-bottom:10px;">Related opportunities</h3>
              <div class="divider-list">
                ${relatedOpps
                  .map(
                    (o) => `
                  <a href="/opportunities/${escapeHtml(o.id)}" data-link class="divider-row" style="align-items:flex-start; text-decoration:none;">
                    <div>
                      <div style="font-weight:600; font-size:14px; color:var(--color-navy);">${escapeHtml(o.title)}</div>
                      <div style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(o.organization)} · ${escapeHtml(o.workMode)}</div>
                    </div>
                    <span class="mono-num" style="font-size:13px; font-weight:600; color:var(--color-blue);">${o.matchPercent}%</span>
                  </a>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </aside>
      </div>
    `,
    bind(root) {
      root.querySelectorAll('[data-enroll-course]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (btn.disabled) return;
          btn.disabled = true;
          btn.textContent = 'Enrolling…';
          try {
            await enrollInCourse(userId, btn.dataset.enrollCourse);
            showToast('Enrolled in course!', 'success');
            navigate(`/courses/${btn.dataset.courseSlug}`);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Enroll in course';
            showToast(err?.message || 'Unable to enroll.', 'error');
          }
        });
      });

      root.querySelector('#declare-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          await declareUserSkill(userId, skill.id);
          showToast(`${skill.title} added as Declared.`, 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          showToast(err?.message || 'Unable to declare skill.', 'error');
        }
      });
    },
  };
}
