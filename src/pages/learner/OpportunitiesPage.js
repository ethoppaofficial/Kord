import { listRankedOpportunities } from '../../lib/repositories/opportunityRepository.js';
import { OPPORTUNITY_TYPES, WORK_MODES } from '../../lib/constants.js';
import { escapeHtml } from '../../lib/formatters.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import { renderOpportunityCard, renderEmptyState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

function getStorageKey(userId) {
  return `kord_saved_opps_v2_${userId || 'guest'}`;
}

export function getSavedOpportunityIds(userId) {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function toggleSavedOpportunity(userId, oppId) {
  const set = getSavedOpportunityIds(userId);
  let saved;
  if (set.has(oppId)) {
    set.delete(oppId);
    saved = false;
  } else {
    set.add(oppId);
    saved = true;
  }
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify([...set]));
  } catch {
    // ignore
  }
  return saved;
}

let oppFilters = {
  search: '',
  type: 'All',
  workMode: 'All',
  savedOnly: false,
};

registerSessionCleanup(() => {
  oppFilters = {
    search: '',
    type: 'All',
    workMode: 'All',
    savedOnly: false,
  };
});

export async function renderOpportunitiesPage({ session }) {
  const userId = session?.user?.id || null;
  const opportunities = await listRankedOpportunities(userId);

  function getFiltered() {
    const q = oppFilters.search.trim().toLowerCase();
    const savedSet = getSavedOpportunityIds(userId);
    return opportunities.filter((o) => {
      if (oppFilters.type !== 'All' && o.opportunityType !== oppFilters.type) return false;
      if (oppFilters.workMode !== 'All' && o.workMode !== oppFilters.workMode) return false;
      if (oppFilters.savedOnly && !savedSet.has(o.id)) return false;
      if (q && !`${o.title} ${o.organization} ${o.summary}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderList(list) {
    if (list.length === 0) {
      return renderEmptyState({
        title: 'No opportunities match those filters',
        message: 'Adjust the opportunity type, work mode, saved toggle, or search query.',
      });
    }
    const savedSet = getSavedOpportunityIds(userId);
    return `<div class="lab-grid-2">${list
      .map((o) => renderOpportunityCard(o, { isSaved: savedSet.has(o.id) }))
      .join('')}</div>`;
  }

  const initialList = getFiltered();

  return {
    html: `
      <div class="page-header">
        <div>
          <h1 class="page-title">Opportunities</h1>
          <p class="page-subtitle">Ranked by your demonstrated and verified skill match. Open any listing for the full score breakdown, requirements, and application tips.</p>
        </div>
        <span class="mono-num" id="opp-count" style="font-size:13px; color:var(--color-text-muted);">
          Showing ${initialList.length} of ${opportunities.length} listings
        </span>
      </div>

      <div class="filter-bar">
        <div style="flex:1; min-width:220px; max-width:300px;">
          <label class="sr-only" for="opp-search">Search opportunities</label>
          <input class="input" id="opp-search" type="search" placeholder="Search role or organization…" value="${escapeHtml(oppFilters.search)}" />
        </div>

        <div class="segmented" role="group" aria-label="Filter by type">
          ${OPPORTUNITY_TYPES.map(
            (t) => `<button type="button" class="segmented-btn ${oppFilters.type === t ? 'is-active' : ''}" data-opp-type="${escapeHtml(t)}">${escapeHtml(t)}</button>`
          ).join('')}
        </div>

        <div class="segmented" role="group" aria-label="Filter by work mode">
          ${WORK_MODES.map(
            (m) => `<button type="button" class="segmented-btn ${oppFilters.workMode === m ? 'is-active' : ''}" data-opp-mode="${escapeHtml(m)}">${escapeHtml(m)}</button>`
          ).join('')}
        </div>

        <button type="button" class="btn btn-sm ${oppFilters.savedOnly ? 'btn-primary' : 'btn-secondary'}" id="opp-saved-toggle" aria-pressed="${oppFilters.savedOnly}">
          Saved only
        </button>
      </div>

      <div id="opp-results">
        ${renderList(initialList)}
      </div>
    `,
    bind(root) {
      const resultsEl = root.querySelector('#opp-results');
      const countEl = root.querySelector('#opp-count');

      const bindCardActions = () => {
        root.querySelectorAll('[data-save-opp]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const saved = toggleSavedOpportunity(userId, btn.dataset.saveOpp);
            btn.textContent = saved ? 'Saved' : 'Save';
            btn.setAttribute('aria-pressed', String(saved));
            showToast(saved ? 'Opportunity saved to shortlist.' : 'Removed from shortlist.', 'info');
            if (oppFilters.savedOnly) refresh();
          });
        });
      };

      const refresh = () => {
        const list = getFiltered();
        countEl.textContent = `Showing ${list.length} of ${opportunities.length} listings`;
        resultsEl.innerHTML = renderList(list);
        bindCardActions();
      };

      bindCardActions();

      root.querySelector('#opp-search')?.addEventListener('input', (e) => {
        oppFilters.search = e.target.value;
        refresh();
      });

      root.querySelectorAll('[data-opp-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
          oppFilters.type = btn.dataset.oppType;
          root.querySelectorAll('[data-opp-type]').forEach((b) => b.classList.toggle('is-active', b === btn));
          refresh();
        });
      });

      root.querySelectorAll('[data-opp-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          oppFilters.workMode = btn.dataset.oppMode;
          root.querySelectorAll('[data-opp-mode]').forEach((b) => b.classList.toggle('is-active', b === btn));
          refresh();
        });
      });

      root.querySelector('#opp-saved-toggle')?.addEventListener('click', (e) => {
        oppFilters.savedOnly = !oppFilters.savedOnly;
        const btn = e.currentTarget;
        btn.classList.toggle('btn-primary', oppFilters.savedOnly);
        btn.classList.toggle('btn-secondary', !oppFilters.savedOnly);
        btn.setAttribute('aria-pressed', String(oppFilters.savedOnly));
        refresh();
      });
    },
  };
}
