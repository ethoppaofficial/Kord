import { escapeHtml } from '../lib/formatters.js';
import { icon } from '../lib/icons.js';

export function renderProgressRail({
  label = 'Progress',
  value = 0,
  max = 100,
  detail = '',
  id = '',
}) {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.min(100, Math.max(0, Math.round((value / safeMax) * 100)));
  return `
    <div class="progress-rail-wrap" ${id ? `id="${escapeHtml(id)}"` : ''}>
      <div class="progress-rail-header">
        <span data-rail-label>${escapeHtml(label)}</span>
        <span class="mono-num" data-rail-detail>${detail ? escapeHtml(detail) : `${pct}%`}</span>
      </div>
      <div class="progress-rail-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-rail-fill" data-rail-fill style="width: ${pct}%;"></div>
      </div>
    </div>
  `;
}

export function renderStatusBadge(status) {
  const map = {
    approved: { cls: 'status-green', ic: 'checkCircle', text: 'Approved' },
    verified: { cls: 'status-green', ic: 'checkCircle', text: 'Verified' },
    completed: { cls: 'status-green', ic: 'checkCircle', text: 'Completed' },
    passed: { cls: 'status-green', ic: 'checkCircle', text: 'Passed' },
    published: { cls: 'status-blue', ic: 'book', text: 'Published' },
    active: { cls: 'status-blue', ic: 'play', text: 'Active' },
    demonstrated: { cls: 'status-blue', ic: 'award', text: 'Demonstrated' },
    practising: { cls: 'status-blue', ic: 'book', text: 'Practising' },
    auto_graded: { cls: 'status-blue', ic: 'check', text: 'Auto-graded' },
    reviewed: { cls: 'status-green', ic: 'checkCircle', text: 'Reviewed' },
    declared: { cls: 'status-neutral', ic: 'check', text: 'Declared' },
    pending: { cls: 'status-amber', ic: 'clock', text: 'Pending review' },
    pending_review: { cls: 'status-amber', ic: 'clock', text: 'Awaiting grading' },
    paused: { cls: 'status-amber', ic: 'pause', text: 'Paused' },
    needs_revision: { cls: 'status-amber', ic: 'alert', text: 'Needs revision' },
    draft: { cls: 'status-neutral', ic: 'clock', text: 'Draft' },
    archived: { cls: 'status-neutral', ic: 'clock', text: 'Archived' },
    failed: { cls: 'status-red', ic: 'alert', text: 'Not passed' },
    coming_soon: { cls: 'status-neutral', ic: 'clock', text: 'Coming soon' },
    full: { cls: 'status-blue', ic: 'book', text: 'Courses ready' },
  };
  const cfg = map[status] || { cls: 'status-neutral', ic: 'check', text: status || 'Status' };
  return `<span class="status-tag ${cfg.cls}">${icon(cfg.ic, 13)} ${escapeHtml(cfg.text)}</span>`;
}

export function renderSkillCard(
  skill,
  {
    index = 0,
    completedCoursesCount = 0,
    totalCoursesCount = 0,
    averageCoursePct = 0,
    userLevel = null,
  } = {}
) {
  const courseCount = Number(totalCoursesCount || skill.courseCount || 0);
  const pct =
    userLevel === 'verified'
      ? 100
      : courseCount > 0
        ? averageCoursePct
        : userLevel === 'demonstrated'
          ? 75
          : userLevel === 'practising'
            ? 45
            : userLevel === 'declared'
              ? 15
              : 0;

  return `
    <article class="skill-card view-enter" style="animation-delay:${Math.min(index, 6) * 20}ms;">
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div class="meta-line">
          <span>${escapeHtml(skill.category)}</span>
          <span class="meta-sep" aria-hidden="true">·</span>
          <span>${escapeHtml(skill.level)}</span>
          <span class="meta-sep" aria-hidden="true">·</span>
          <span class="mono-num">${courseCount} ${courseCount === 1 ? 'course' : 'courses'}</span>
        </div>

        <h3 style="font-size:1.1rem;">${escapeHtml(skill.title)}</h3>
        <p class="line-clamp-2" style="font-size:14px; color:var(--color-text-secondary);">
          ${escapeHtml(skill.summary)}
        </p>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        ${renderProgressRail({
          label: courseCount > 0 ? `Skill pathway (${completedCoursesCount}/${courseCount} courses)` : 'Competency overview',
          value: pct,
          max: 100,
          detail: `${pct}%`,
        })}

        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding-top:10px; border-top:1px solid var(--color-border); flex-wrap:wrap;">
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            ${courseCount > 0 ? renderStatusBadge('full') : renderStatusBadge('declared')}
            ${userLevel ? renderStatusBadge(userLevel) : ''}
          </div>
          <a href="/skills/${escapeHtml(skill.slug)}" data-link class="btn btn-secondary btn-sm">
            ${courseCount > 0 ? 'View courses' : 'View skill'} ${icon('arrowRight', 14)}
          </a>
        </div>
      </div>
    </article>
  `;
}

export function renderOpportunityCard(opp, { showDetailsButton = true, isSaved = false } = {}) {
  const matched = opp.matchedSkills || [];
  const missing = opp.missingSkills || [];

  return `
    <article class="card card-interactive" style="display:flex; flex-direction:column; gap:14px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <div class="meta-line" style="margin-bottom:4px;">
            <span>${escapeHtml(opp.organization)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(opp.opportunityType)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(opp.workMode)}</span>
          </div>
          <h3 style="font-size:1.1rem;">
            <a href="/opportunities/${escapeHtml(opp.id)}" data-link style="color:var(--color-navy);">
              ${escapeHtml(opp.title)}
            </a>
          </h3>
        </div>
        <div style="text-align:right; flex-shrink:0;">
          <div class="mono-num" style="font-size:1.35rem; font-weight:700; color:var(--color-navy); line-height:1;">${opp.matchPercent}%</div>
          <div style="font-size:12px; font-weight:600; color:var(--color-blue); margin-top:4px;">${escapeHtml(opp.matchTier || 'Skill match')}</div>
        </div>
      </div>

      <p class="line-clamp-2" style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(opp.summary)}</p>

      ${renderProgressRail({
        label: 'Match strength',
        value: opp.matchPercent,
        max: 100,
        detail: `${opp.matchPercent}%`,
      })}

      <div style="display:flex; flex-direction:column; gap:6px; font-size:13px;">
        <div>
          <strong>Matched skills:</strong>
          ${
            matched.length > 0
              ? matched.map((m) => `${escapeHtml(m.title)} (${escapeHtml(m.label || m.level)})`).join(', ')
              : '<span style="color:var(--color-text-muted);">None yet — declare or practise required skills</span>'
          }
        </div>
        ${
          missing.length > 0
            ? `<div>
                <strong>Missing skills:</strong>
                <span style="color:var(--color-text-muted);">${missing.map((m) => escapeHtml(m.title)).join(', ')}</span>
              </div>`
            : `<div style="color:var(--color-green); font-weight:600;">All required skills covered in your profile</div>`
        }
      </div>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:10px; border-top:1px solid var(--color-border); flex-wrap:wrap;">
        <span style="font-size:13px; color:var(--color-text-muted);">${escapeHtml(opp.location)}</span>
        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" class="btn btn-ghost btn-sm" data-save-opp="${escapeHtml(opp.id)}" aria-pressed="${isSaved}">
            ${isSaved ? 'Saved' : 'Save'}
          </button>
          ${
            showDetailsButton
              ? `<a href="/opportunities/${escapeHtml(opp.id)}" data-link class="btn btn-primary btn-sm">
                  View role &amp; match ${icon('arrowRight', 14)}
                </a>`
              : ''
          }
        </div>
      </div>
    </article>
  `;
}

export function renderEmptyState({ title, message, actionHtml = '' }) {
  return `
    <div class="state-box">
      <h3 style="font-size:1.05rem;">${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${actionHtml}
    </div>
  `;
}

export function renderErrorState({ title = 'Unable to load view', message, retryAction = false }) {
  return `
    <div class="state-box" style="background:var(--color-red-bg); border-color:var(--color-red-border);">
      <div style="color:var(--color-red);">${icon('alert', 22)}</div>
      <h3 style="color:var(--color-red); font-size:1.05rem;">${escapeHtml(title)}</h3>
      <p>${escapeHtml(message || 'Please try again.')}</p>
      ${retryAction ? `<button type="button" class="btn btn-secondary btn-sm" data-retry>Try again</button>` : ''}
    </div>
  `;
}

export function renderLoadingState(label = 'Loading workspace…') {
  return `
    <div class="state-box" role="status" aria-live="polite">
      <p style="font-weight:500;">${escapeHtml(label)}</p>
    </div>
  `;
}
