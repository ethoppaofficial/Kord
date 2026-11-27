import { escapeHtml } from '../lib/formatters.js';

/**
 * @param {{ currentPath: string; innerHtml: string }} params
 */
export function renderAdminLayout({ currentPath, innerHtml }) {
  const tabs = [
    { path: '/admin', label: 'Overview', exact: true },
    { path: '/admin/submissions', label: 'Review Submissions' },
    { path: '/admin/content', label: 'Content & Roadmaps' },
    { path: '/admin/quizzes', label: 'Quiz Questions' },
    { path: '/admin/opportunities', label: 'Opportunities' },
    { path: '/admin/governance', label: 'Governance & Audit' },
  ];

  return `
    <div class="admin-subnav" aria-label="Admin navigation">
      <div class="admin-subnav-inner">
        <div class="admin-tabs">
          ${tabs
            .map((t) => {
              const active = t.exact
                ? currentPath === t.path
                : currentPath === t.path || currentPath.startsWith(`${t.path}/`);
              return `<a href="${t.path}" data-link class="admin-tab ${active ? 'is-active' : ''}">${escapeHtml(t.label)}</a>`;
            })
            .join('')}
        </div>
        <span class="status-tag status-blue">Administrator console</span>
      </div>
    </div>
    ${innerHtml}
  `;
}
