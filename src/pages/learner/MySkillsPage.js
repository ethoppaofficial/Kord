import {
  listSkills,
  listAllCourses,
  listAllChallenges,
} from '../../lib/repositories/contentRepository.js';
import {
  getCourseEnrollments,
  getLessonProgress,
  getActivityProgress,
} from '../../lib/repositories/progressRepository.js';
import {
  listAllQuizzes,
  getUserAllQuizAttempts,
} from '../../lib/repositories/quizRepository.js';
import { getUserSubmissions } from '../../lib/repositories/submissionRepository.js';
import { getUserSkills, declareUserSkill } from '../../lib/repositories/skillsRepository.js';
import { computeCourseProgress, computeOverallSkillCourseProgress } from '../../lib/progressionEngine.js';
import { renderCourseThumbnailHtml } from '../../lib/courseThumbnails.js';
import { PROGRESSION_LADDER, PROGRESSION_WEIGHT } from '../../lib/constants.js';
import { escapeHtml, formatDate } from '../../lib/formatters.js';
import { renderStatusBadge, renderEmptyState, renderProgressRail } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderMySkillsPage({ session, rerender }) {
  if (!session?.user) {
    return { html: '', bind() {} };
  }
  const userId = session.user.id;
  const [
    skills,
    allCourses,
    quizzes,
    challenges,
    enrollments,
    lessonProgress,
    activityProgress,
    quizAttempts,
    submissions,
    userSkills,
  ] = await Promise.all([
    listSkills(),
    listAllCourses({ includeDrafts: false }),
    listAllQuizzes(),
    listAllChallenges(),
    getCourseEnrollments(userId),
    getLessonProgress(userId),
    getActivityProgress(userId),
    getUserAllQuizAttempts(userId),
    getUserSubmissions(userId),
    getUserSkills(userId),
  ]);

  /** @type {Record<string, import('../../types/kord.d.ts').CourseProgressSummary>} */
  const courseProgressById = {};
  allCourses.forEach((course) => {
    const enr = enrollments.find((e) => e.courseId === course.id) || null;
    courseProgressById[course.id] = computeCourseProgress({
      course,
      lessonProgress: lessonProgress.filter((lp) => lp.courseId === course.id),
      activityProgress: activityProgress.filter((ap) => ap.courseId === course.id),
      assessments: quizzes,
      quizAttempts,
      challenges,
      submissions,
      enrollment: enr,
    });
  });

  const userSkillById = new Map(userSkills.map((us) => [us.skillId, us]));
  const undeclaredSkills = skills.filter((s) => !userSkillById.has(s.id));

  return {
    html: `
      <div class="page-header">
        <div>
          <h1 class="page-title">My Learning &amp; Skill Progression</h1>
          <p class="page-subtitle">Track individual course progress, practical activity completion, and how approved capstones elevate your skills to Verified.</p>
        </div>
        <a href="/explore" data-link class="btn btn-primary btn-sm">Explore courses</a>
      </div>

      <section class="card" style="margin-bottom:24px;">
        <h2 style="font-size:1rem; margin-bottom:12px;">How skill levels are earned</h2>
        <div class="kpi-strip">
          ${PROGRESSION_LADDER.map(
            (step) => `
            <div class="kpi-box" style="padding:14px;">
              <div style="margin-bottom:6px;">${renderStatusBadge(step.key)}</div>
              <div style="font-size:13px; color:var(--color-text-secondary);">${escapeHtml(step.hint)}</div>
            </div>
          `
          ).join('')}
        </div>
      </section>

      <!-- Active Course Enrollments -->
      <section style="margin-bottom:28px;">
        <h2 class="section-heading">Enrolled courses (${enrollments.length})</h2>
        ${
          enrollments.length > 0
            ? `
          <div class="lab-grid-2">
            ${enrollments
              .map((enr) => {
                const course = allCourses.find((c) => c.id === enr.courseId);
                if (!course) return '';
                const prog = courseProgressById[course.id];
                const skill = skills.find((s) => s.id === course.skillId);
                const statusKey = prog.completionState || enr.completionState || enr.status;
                return `
                  <article class="course-card">
                    ${renderCourseThumbnailHtml(course, { height: '132px' })}
                    <div class="course-card-body">
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                        <div>
                          <div class="meta-line" style="margin-bottom:2px;">
                            <span>${escapeHtml(skill?.title || 'Skill Pathway')}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>${escapeHtml(course.difficulty)}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span class="mono-num">v${Number(course.version || 1)}</span>
                          </div>
                          <a href="/courses/${escapeHtml(course.slug)}" data-link style="font-size:1.05rem; font-weight:700; color:var(--color-navy);">
                            ${escapeHtml(course.title)}
                          </a>
                          <div style="font-size:12px; color:var(--color-text-muted); margin-top:2px;">
                            By ${escapeHtml(course.authorName || 'Kord Curriculum Studio')}
                          </div>
                        </div>
                        ${renderStatusBadge(statusKey)}
                      </div>

                      ${renderProgressRail({
                        label: `${prog.completedLessonsCount}/${prog.requiredLessonsCount} lessons · ${prog.completedActivitiesCount}/${prog.requiredActivitiesCount} activities · ${prog.passedAssessmentsCount}/${prog.assessmentsCount} checks`,
                        value: prog.progressPercent,
                        max: 100,
                        detail: `${prog.progressPercent}%`,
                      })}

                      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:12.5px; color:var(--color-text-muted); flex-wrap:wrap;">
                        <span>${prog.isCompleted ? 'Completed' : prog.completionState === 'awaiting_practical_assessment' ? 'Instructional work done · Submit/await capstone review' : `Est. target: ${formatDate(prog.projectedCompletionAt)}`}</span>
                        <a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-secondary btn-sm">Continue course →</a>
                      </div>
                    </div>
                  </article>
                `;
              })
              .join('')}
          </div>
        `
            : renderEmptyState({
                title: 'No courses enrolled yet',
                message: 'Browse skills in Explore and enroll in individual courses to start building verified mastery.',
                actionHtml: `<a href="/explore" data-link class="btn btn-primary btn-sm">Browse skills &amp; courses</a>`,
              })
        }
      </section>

      <div class="lab-split">
        <section>
          <h2 class="section-heading">Your tracked skills (${userSkills.length})</h2>
          ${
            userSkills.length > 0
              ? `
            <div style="display:flex; flex-direction:column; gap:14px;">
              ${userSkills
                .map((us) => {
                  const skill = skills.find((s) => s.id === us.skillId);
                  if (!skill) return '';
                  const skillCourses = allCourses.filter(
                    (c) => c.skillId === skill.id || (c.associatedSkillIds || []).includes(skill.id)
                  );
                  const overall = computeOverallSkillCourseProgress({
                    publishedCourses: skillCourses,
                    courseProgressById,
                  });
                  const weightMap = /** @type {Record<string, number>} */ (PROGRESSION_WEIGHT);
                  const pct = Math.round((weightMap[us.level] || 0.3) * 100);
                  return `
                    <article class="card pop-in" style="display:flex; flex-direction:column; gap:12px;">
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                        <div>
                          <div class="meta-line" style="margin-bottom:4px;">
                            <span>${escapeHtml(skill.category)}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>${overall.completedCoursesCount}/${overall.totalPublishedCourses} courses completed</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>Updated ${formatDate(us.updatedAt)}</span>
                          </div>
                          <a href="/skills/${escapeHtml(skill.slug)}" data-link style="font-size:1.1rem; font-weight:700; color:var(--color-navy);">
                            ${escapeHtml(skill.title)}
                          </a>
                          <p class="line-clamp-2" style="font-size:13px; color:var(--color-text-secondary); margin-top:4px;">${escapeHtml(skill.summary)}</p>
                        </div>
                        ${renderStatusBadge(us.level)}
                      </div>

                      ${renderProgressRail({
                        label: 'Skill mastery progression',
                        value: pct,
                        max: 100,
                        detail: `${pct}%`,
                      })}

                      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <a href="/skills/${escapeHtml(skill.slug)}" data-link class="btn btn-secondary btn-sm">Open skill hub</a>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>
          `
              : renderEmptyState({
                  title: 'No skills declared yet',
                  message: 'Declare a skill on the right or enroll in a course to begin building evidence.',
                })
          }
        </section>

        <aside class="card-workspace">
          <h2 style="font-size:1.05rem; margin-bottom:8px;">Declare a skill</h2>
          <p style="font-size:13px; color:var(--color-text-secondary); margin-bottom:14px;">
            Declaring adds a skill at <strong>Declared</strong> level so you can track opportunity readiness while completing its courses.
          </p>
          ${
            undeclaredSkills.length > 0
              ? `
            <form id="declare-skill-form" class="form-stack">
              <div class="field">
                <label class="field-label" for="declare-select">Select skill</label>
                <select class="select" id="declare-select" name="skillId">
                  ${undeclaredSkills
                    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)} (${escapeHtml(s.category)})</option>`)
                    .join('')}
                </select>
              </div>
              <button type="submit" class="btn btn-primary">Declare skill</button>
            </form>
          `
              : '<p style="font-size:13px; color:var(--color-green); font-weight:600;">All catalog skills are already in your profile.</p>'
          }
        </aside>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      root.querySelector('#declare-skill-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = /** @type {HTMLFormElement | null} */ (e.currentTarget);
        const btn = /** @type {HTMLButtonElement | null} */ (form?.querySelector('button[type="submit"]') || null);
        if (btn?.disabled) return;
        if (btn) btn.disabled = true;
        const selectEl = /** @type {HTMLSelectElement | null} */ (root.querySelector('#declare-select'));
        const skillId = selectEl?.value || '';
        try {
          await declareUserSkill(userId, skillId);
          showToast('Skill declared! Enroll in its courses to advance your level.', 'success');
          rerender({ silent: true });
        } catch (err) {
          if (btn) btn.disabled = false;
          showToast(err instanceof Error && err.message ? err.message : 'Unable to declare skill.', 'error');
        }
      });
    },
  };
}
