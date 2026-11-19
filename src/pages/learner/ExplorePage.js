import { listSkills } from '../../lib/repositories/contentRepository.js';
import { getUserEnrollments, getUserActivityProgress } from '../../lib/repositories/progressRepository.js';
import { getUserSkills } from '../../lib/repositories/skillsRepository.js';
import { SKILL_CATEGORIES, SKILL_LEVELS } from '../../lib/constants.js';
import { escapeHtml } from '../../lib/formatters.js';
import { renderSkillCard, renderEmptyState } from '../../components/Common.js';

let filterState = {
  search: '',
  category: 'All',
  level: 'All',
};

export async function renderExplorePage({ session }) {
  const userId = session.user.id;
  const [skills, enrollments, progress, userSkills] = await Promise.all([
    listSkills(),
    getUserEnrollments(userId),
    getUserActivityProgress(userId),
    getUserSkills(userId),
  ]);

  const enrollBySkill = new Map(enrollments.map((e) => [e.skillId, e]));
  const userSkillById = new Map(userSkills.map((us) => [us.skillId, us]));
  const completedSet = new Set(progress.filter((p) => p.completed).map((p) => p.activityId));

  function applyFilters() {
    const q = filterState.search.trim().toLowerCase();
    return skills.filter((s) => {
      if (filterState.category !== 'All' && s.category !== filterState.category) return false;
      if (filterState.level !== 'All' && s.level !== filterState.level) return false;
      if (q && !`${s.title} ${s.summary} ${s.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderCards(filtered) {
    if (filtered.length === 0) {
      return renderEmptyState({
        title: 'No matching skills',
        message: 'Try clearing your search term or switching category and level filters.',
        actionHtml: `<button type="button" class="btn btn-secondary btn-sm" id="reset-explore-filters">Clear filters</button>`,
      });
    }

    const fullRoadmaps = filtered.filter((s) => s.roadmapStatus === 'full');
    const comingSoon = filtered.filter((s) => s.roadmapStatus !== 'full');

    const buildCard = (skill, idx) => {
      const enr = enrollBySkill.get(skill.id);
      const us = userSkillById.get(skill.id);
      const allActs = (skill.phases || []).flatMap((p) => p.activities || []);
      const doneCount = allActs.filter((a) => completedSet.has(a.id)).length;

      return renderSkillCard(skill, {
        index: idx,
        completedCount: doneCount,
        totalCount: allActs.length,
        enrollmentStatus: enr?.status || null,
        userLevel: us?.level || null,
      });
    };

    return `
      ${
        fullRoadmaps.length > 0
          ? `
        <section style="margin-bottom:32px;">
          <h2 class="section-heading">Full roadmaps (${fullRoadmaps.length})</h2>
          <div class="lab-grid-3">${fullRoadmaps.map((s, i) => buildCard(s, i)).join('')}</div>
        </section>
      `
          : ''
      }
      ${
        comingSoon.length > 0
          ? `
        <section>
          <h2 class="section-heading">Coming soon (${comingSoon.length})</h2>
          <div class="lab-grid-3">${comingSoon.map((s, i) => buildCard(s, i + fullRoadmaps.length)).join('')}</div>
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
          <h1 class="page-title">Explore Skills</h1>
          <p class="page-subtitle">Browse full roadmaps ready for practice and assessment, alongside upcoming skill tracks.</p>
        </div>
        <span class="mono-num" id="explore-count" style="font-size:13px; color:var(--color-text-muted);">
          ${initialFiltered.length} of ${skills.length} skills
        </span>
      </div>

      <div class="filter-bar">
        <div style="flex:1; min-width:220px; max-width:340px;">
          <label class="sr-only" for="explore-search">Search skills</label>
          <input class="input" id="explore-search" type="search" placeholder="Search skills or topics…" value="${escapeHtml(filterState.search)}" />
        </div>

        <div class="segmented" role="group" aria-label="Filter by category">
          ${SKILL_CATEGORIES.map(
            (cat) => `<button type="button" class="segmented-btn ${filterState.category === cat ? 'is-active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
          ).join('')}
        </div>

        <div class="segmented" role="group" aria-label="Filter by level">
          ${SKILL_LEVELS.map(
            (lvl) => `<button type="button" class="segmented-btn ${filterState.level === lvl ? 'is-active' : ''}" data-lvl="${escapeHtml(lvl)}">${escapeHtml(lvl)}</button>`
          ).join('')}
        </div>
      </div>

      <div id="explore-results">
        ${renderCards(initialFiltered)}
      </div>
    `,
    bind(root) {
      const resultsEl = root.querySelector('#explore-results');
      const countEl = root.querySelector('#explore-count');
      const refresh = () => {
        const filtered = applyFilters();
        countEl.textContent = `${filtered.length} of ${skills.length} skills`;
        resultsEl.innerHTML = renderCards(filtered);
        root.querySelector('#reset-explore-filters')?.addEventListener('click', () => {
          filterState = { search: '', category: 'All', level: 'All' };
          root.querySelector('#explore-search').value = '';
          root.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('is-active', b.dataset.cat === 'All'));
          root.querySelectorAll('[data-lvl]').forEach((b) => b.classList.toggle('is-active', b.dataset.lvl === 'All'));
          refresh();
        });
      };

      root.querySelector('#explore-search')?.addEventListener('input', (e) => {
        filterState.search = e.target.value;
        refresh();
      });

      root.querySelectorAll('[data-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          filterState.category = btn.dataset.cat;
          root.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('is-active', b === btn));
          refresh();
        });
      });

      root.querySelectorAll('[data-lvl]').forEach((btn) => {
        btn.addEventListener('click', () => {
          filterState.level = btn.dataset.lvl;
          root.querySelectorAll('[data-lvl]').forEach((b) => b.classList.toggle('is-active', b === btn));
          refresh();
        });
      });
    },
  };
}
