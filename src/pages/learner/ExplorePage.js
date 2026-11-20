import {
  listCategories,
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
import { getUserSkills } from '../../lib/repositories/skillsRepository.js';
import { SKILL_LEVELS } from '../../lib/constants.js';
import { computeCourseProgress, computeOverallSkillCourseProgress } from '../../lib/progressionEngine.js';
import { escapeHtml } from '../../lib/formatters.js';
import { renderSkillCard, renderCourseCard, renderEmptyState } from '../../components/Common.js';

let filterState = {
  search: '',
  category: 'All',
  level: 'All',
  courseFilter: 'all',
};

export async function renderExplorePage({ session }) {
  const userId = session.user.id;
  const [
    categories,
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
    listCategories(),
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

  const userSkillById = new Map(userSkills.map((us) => [us.skillId, us]));
  const coursesBySkill = new Map();
  const courseProgressById = {};
  const enrollmentByCourseId = new Map(enrollments.map((e) => [e.courseId, e]));

  allCourses.forEach((course) => {
    const linkedIds = Array.from(
      new Set([course.skillId, ...(course.associatedSkillIds || [])].filter(Boolean))
    );
    linkedIds.forEach((sid) => {
      if (!coursesBySkill.has(sid)) coursesBySkill.set(sid, []);
      coursesBySkill.get(sid).push(course);
    });

    const enr = enrollmentByCourseId.get(course.id) || null;
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

  function applyFilters() {
    const q = filterState.search.trim().toLowerCase();
    return skills.filter((s) => {
      if (filterState.category !== 'All' && s.category !== filterState.category) return false;
      if (filterState.level !== 'All' && s.level !== filterState.level) return false;
      const count = (coursesBySkill.get(s.id) || []).length;
      if (filterState.courseFilter === 'with_courses' && count === 0) return false;
      if (filterState.courseFilter === 'no_courses' && count > 0) return false;
      if (q && !`${s.title} ${s.summary} ${s.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderCards(filtered) {
    if (filtered.length === 0) {
      return renderEmptyState({
        title: 'No matching skills',
        message: 'Try clearing your search term or adjusting the category, level, and course availability filters.',
        actionHtml: `<button type="button" class="btn btn-secondary btn-sm" id="reset-explore-filters">Clear filters</button>`,
      });
    }

    const withCourses = filtered.filter((s) => (coursesBySkill.get(s.id) || []).length > 0);
    const withoutCourses = filtered.filter((s) => (coursesBySkill.get(s.id) || []).length === 0);

    const buildCard = (skill, idx) => {
      const skillCourses = coursesBySkill.get(skill.id) || [];
      const overall = computeOverallSkillCourseProgress({
        publishedCourses: skillCourses,
        courseProgressById,
      });
      const us = userSkillById.get(skill.id);

      return renderSkillCard(skill, {
        index: idx,
        completedCoursesCount: overall.completedCoursesCount,
        totalCoursesCount: skillCourses.length,
        averageCoursePct: overall.averagePercent,
        userLevel: us?.level || null,
      });
    };

    return `
      ${
        withCourses.length > 0
          ? `
        <section style="margin-bottom:32px;">
          <h2 class="section-heading">Skills with Published Courses (${withCourses.length})</h2>
          <p style="font-size:13px; color:var(--color-text-muted); margin-bottom:14px;">
            Competencies connected directly to Kord's structured multi-module courses and graded practical capstones.
          </p>
          <div class="lab-grid-3">${withCourses.map((s, i) => buildCard(s, i)).join('')}</div>
        </section>
      `
          : ''
      }
      ${
        withoutCourses.length > 0
          ? `
        <section>
          <h2 class="section-heading">Competencies Awaiting Dedicated Courses (${withoutCourses.length})</h2>
          <p style="font-size:13px; color:var(--color-text-muted); margin-bottom:14px;">
            Published competencies without a standalone course yet. Several link directly to foundational flagship courses; others are queued for future curriculum development.
          </p>
          <div class="lab-grid-3">${withoutCourses.map((s, i) => buildCard(s, i + withCourses.length)).join('')}</div>
        </section>
      `
          : ''
      }
    `;
  }

  const initialFiltered = applyFilters();

  return {
    html: `
      <div class="page-header">
        <div>
          <h1 class="page-title">Explore Skills &amp; Flagship Courses</h1>
          <p class="page-subtitle">Start with Kord's complete multi-module courses or browse ${skills.length} competencies across ${categories.length} categories.</p>
        </div>
        <span class="mono-num" id="explore-count" style="font-size:13px; color:var(--color-text-muted);">
          ${initialFiltered.length} of ${skills.length} skills
        </span>
      </div>

      ${
        allCourses.length > 0
          ? `
        <section style="margin-bottom:32px;">
          <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
            <h2 class="section-heading" style="margin:0;">Published Courses (${allCourses.length})</h2>
            <span style="font-size:13px; color:var(--color-text-muted);">Full multi-module curricula with guided lessons, practical activities, graded checks, and capstone projects</span>
          </div>
          <div class="course-catalog-grid">
            ${allCourses
              .map((course, idx) =>
                renderCourseCard(course, {
                  index: idx,
                  progress: courseProgressById[course.id],
                  enrollment: enrollmentByCourseId.get(course.id) || null,
                })
              )
              .join('')}
          </div>
        </section>
      `
          : ''
      }

      <div class="card" style="padding:16px; margin-bottom:22px; display:flex; flex-direction:column; gap:12px;">
        <div class="filter-bar" style="margin-bottom:0;">
          <div style="flex:1.4; min-width:220px;">
            <label class="sr-only" for="explore-search">Search skills</label>
            <input class="input" id="explore-search" type="search" placeholder="Search skills, categories, or topics…" value="${escapeHtml(filterState.search)}" />
          </div>

          <div style="min-width:220px;">
            <label class="sr-only" for="explore-cat-select">Filter by category</label>
            <select class="select" id="explore-cat-select">
              <option value="All" ${filterState.category === 'All' ? 'selected' : ''}>All categories (${categories.length})</option>
              ${categories
                .map(
                  (c) => `<option value="${escapeHtml(c.name)}" ${filterState.category === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                )
                .join('')}
            </select>
          </div>

          <div class="segmented" role="group" aria-label="Filter by level">
            ${SKILL_LEVELS.map(
              (lvl) => `<button type="button" class="segmented-btn ${filterState.level === lvl ? 'is-active' : ''}" data-lvl="${escapeHtml(lvl)}">${escapeHtml(lvl)}</button>`
            ).join('')}
          </div>

          <div class="segmented" role="group" aria-label="Filter by course availability">
            <button type="button" class="segmented-btn ${filterState.courseFilter === 'all' ? 'is-active' : ''}" data-course-filter="all">All skills</button>
            <button type="button" class="segmented-btn ${filterState.courseFilter === 'with_courses' ? 'is-active' : ''}" data-course-filter="with_courses">Courses available</button>
            <button type="button" class="segmented-btn ${filterState.courseFilter === 'no_courses' ? 'is-active' : ''}" data-course-filter="no_courses">Awaiting course</button>
          </div>
        </div>
      </div>

      <div id="explore-results">
        ${renderCards(initialFiltered)}
      </div>
    `,
    bind(root) {
      const resultsEl = root.querySelector('#explore-results');
      const countEl = root.querySelector('#explore-count');
      const catSelect = root.querySelector('#explore-cat-select');

      const refresh = () => {
        const filtered = applyFilters();
        countEl.textContent = `${filtered.length} of ${skills.length} skills`;
        resultsEl.innerHTML = renderCards(filtered);
        root.querySelector('#reset-explore-filters')?.addEventListener('click', () => {
          filterState = { search: '', category: 'All', level: 'All', courseFilter: 'all' };
          root.querySelector('#explore-search').value = '';
          if (catSelect) catSelect.value = 'All';
          root.querySelectorAll('[data-lvl]').forEach((b) => b.classList.toggle('is-active', b.dataset.lvl === 'All'));
          root.querySelectorAll('[data-course-filter]').forEach((b) => b.classList.toggle('is-active', b.dataset.courseFilter === 'all'));
          refresh();
        });
      };

      root.querySelector('#explore-search')?.addEventListener('input', (e) => {
        filterState.search = e.target.value;
        refresh();
      });

      catSelect?.addEventListener('change', (e) => {
        filterState.category = e.target.value;
        refresh();
      });

      root.querySelectorAll('[data-lvl]').forEach((btn) => {
        btn.addEventListener('click', () => {
          filterState.level = btn.dataset.lvl;
          root.querySelectorAll('[data-lvl]').forEach((b) => b.classList.toggle('is-active', b === btn));
          refresh();
        });
      });

      root.querySelectorAll('[data-course-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          filterState.courseFilter = btn.dataset.courseFilter;
          root.querySelectorAll('[data-course-filter]').forEach((b) => b.classList.toggle('is-active', b === btn));
          refresh();
        });
      });
    },
  };
}
