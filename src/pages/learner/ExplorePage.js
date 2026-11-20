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

export async function renderExplorePage({ session }) {
  let filterState = {
    search: '',
    category: 'All',
    level: 'All',
    courseFilter: 'all',
  };

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

  const skillById = new Map(skills.map((skill) => [skill.id, skill]));

  function getCourseCategory(course) {
    const linkedIds = [course.skillId, ...(course.associatedSkillIds || [])].filter(Boolean);
    const primarySkill = skillById.get(course.skillId);
    if (primarySkill?.category) return primarySkill.category;

    const linkedSkill = linkedIds
      .map((skillId) => skillById.get(skillId))
      .find((skill) => skill?.category);
    return linkedSkill?.category || 'Other';
  }

  function applyFilters() {
    const q = filterState.search.trim().toLowerCase();
    return skills.filter((s) => {
      if (filterState.category !== 'All' && s.category !== filterState.category) return false;
      if (filterState.level !== 'All' && s.level !== filterState.level) return false;
      const skillCourses = coursesBySkill.get(s.id) || [];
      const count = skillCourses.length;
      if (filterState.courseFilter === 'with_courses' && count === 0) return false;
      if (filterState.courseFilter === 'no_courses' && count > 0) return false;
      if (q) {
        const matchesSkill = `${s.title} ${s.summary} ${s.category}`.toLowerCase().includes(q);
        const matchesCourse = skillCourses.some((course) =>
          `${course.title} ${course.description || ''}`.toLowerCase().includes(q)
        );
        if (!matchesSkill && !matchesCourse) return false;
      }
      return true;
    });
  }

  function renderCards(filtered) {
    const filteredSkillIds = new Set(filtered.map((skill) => skill.id));
    const q = filterState.search.trim().toLowerCase();

    const courseMatchesFilters = (course) => {
      if (filterState.courseFilter === 'no_courses') return false;

      const linkedIds = [course.skillId, ...(course.associatedSkillIds || [])].filter(Boolean);
      if (![...linkedIds].some((skillId) => filteredSkillIds.has(skillId))) return false;

      if (q) {
        const primarySkill = skillById.get(course.skillId);
        const searchable = `${course.title} ${course.description || ''} ${primarySkill?.title || ''} ${primarySkill?.category || ''}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    };

    if (filtered.length === 0) {
      const hasMatchingCourses = filterState.courseFilter !== 'no_courses' && allCourses.some((course) => {
        const linkedIds = [course.skillId, ...(course.associatedSkillIds || [])].filter(Boolean);
        return linkedIds.some((skillId) => {
          const skill = skillById.get(skillId);
          if (!skill) return false;
          if (filterState.category !== 'All' && skill.category !== filterState.category) return false;
          if (filterState.level !== 'All' && skill.level !== filterState.level) return false;
          return !q || `${course.title} ${course.description || ''} ${skill.title} ${skill.category}`.toLowerCase().includes(q);
        });
      });

      if (!hasMatchingCourses) {
        return renderEmptyState({
          title: 'No matching courses or skills',
          message: 'Try clearing your search term or adjusting the category, level, and course availability filters.',
          actionHtml: `<button type="button" class="btn btn-secondary btn-sm" id="reset-explore-filters">Clear filters</button>`,
        });
      }
    }

    const categoryList = filterState.category === 'All'
      ? categories.slice().sort((a, b) => (a.position || 0) - (b.position || 0))
      : categories.filter((category) => category.name === filterState.category);

    const buildSkillCard = (skill, index) => {
      const skillCourses = coursesBySkill.get(skill.id) || [];
      const overall = computeOverallSkillCourseProgress({
        publishedCourses: skillCourses,
        courseProgressById,
      });
      const us = userSkillById.get(skill.id);

      return renderSkillCard(skill, {
        index,
        completedCoursesCount: overall.completedCoursesCount,
        totalCoursesCount: skillCourses.length,
        averageCoursePct: overall.averagePercent,
        userLevel: us?.level || null,
      });
    };

    const sections = categoryList.map((category) => {
      const categorySkills = filtered.filter((skill) => skill.category === category.name);
      const categoryCourses = allCourses.filter((course) =>
        getCourseCategory(course) === category.name && courseMatchesFilters(course)
      );

      const withCourses = categorySkills.filter((skill) => (coursesBySkill.get(skill.id) || []).length > 0);
      const withoutCourses = categorySkills.filter((skill) => (coursesBySkill.get(skill.id) || []).length === 0);

      if (categoryCourses.length === 0 && withCourses.length === 0 && withoutCourses.length === 0) return '';

      return `
        <section class="card" style="padding:18px; margin-bottom:24px;">
          <header style="margin-bottom:18px;">
            <h2 class="section-heading" style="margin:0 0 5px;">${escapeHtml(category.name)}</h2>
            ${category.description ? `<p style="font-size:13px; color:var(--color-text-muted); margin:0;">${escapeHtml(category.description)}</p>` : ''}
          </header>

          ${categoryCourses.length > 0 ? `
            <section style="margin-bottom:28px;">
              <h3 style="font-size:15px; margin:0 0 12px;">Published Courses (${categoryCourses.length})</h3>
              <div class="course-catalog-grid">
                ${categoryCourses.map((course, index) => renderCourseCard(course, {
                  index,
                  progress: courseProgressById[course.id],
                  enrollment: enrollmentByCourseId.get(course.id) || null,
                })).join('')}
              </div>
            </section>
          ` : ''}

          ${withCourses.length > 0 ? `
            <section style="margin-bottom:${withoutCourses.length > 0 ? '28px' : '0'};">
              <h3 style="font-size:15px; margin:0 0 12px;">Skills with Published Courses (${withCourses.length})</h3>
              <div class="lab-grid-3">${withCourses.map((skill, index) => buildSkillCard(skill, index)).join('')}</div>
            </section>
          ` : ''}

          ${withoutCourses.length > 0 ? `
            <section>
              <h3 style="font-size:15px; margin:0 0 12px;">Skills Awaiting Dedicated Courses (${withoutCourses.length})</h3>
              <div class="lab-grid-3">${withoutCourses.map((skill, index) => buildSkillCard(skill, index + withCourses.length)).join('')}</div>
            </section>
          ` : ''}
        </section>
      `;
    }).join('');

    if (sections.trim()) return sections;

    return renderEmptyState({
      title: 'No matching courses or skills',
      message: 'Try clearing your search term or adjusting the category, level, and course availability filters.',
      actionHtml: `<button type="button" class="btn btn-secondary btn-sm" id="reset-explore-filters">Clear filters</button>`,
    });
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

      <div class="card" style="padding:16px; margin-bottom:22px; display:flex; flex-direction:column; gap:12px;">
        <div class="filter-bar" style="margin-bottom:0;">
          <div style="flex:1.4; min-width:220px;">
            <label class="sr-only" for="explore-search">Search courses and skills</label>
            <input class="input" id="explore-search" type="search" placeholder="Search courses, skills, categories, or topics…" value="${escapeHtml(filterState.search)}" />
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
