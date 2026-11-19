import { adminListSubmissions, adminReviewSubmission, getSignedEvidenceUrl } from '../../lib/repositories/submissionRepository.js';
import { escapeHtml, formatDateTime } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge, renderEmptyState, renderProgressRail } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let subFilter = 'pending';
let selectedSubId = null;

const FEEDBACK_SNIPPETS = [
  'Clear structure and verifiable metrics.',
  'Strong alignment with the brief criteria.',
  'Add concrete baseline numbers and owner dates.',
  'Include a risk mitigation section before resubmitting.',
];

export async function renderAdminSubmissionsPage({ currentPath, session, rerender }) {
  const submissions = await adminListSubmissions();
  const filtered = submissions.filter((s) => (subFilter === 'all' ? true : s.status === subFilter));

  if (!selectedSubId || !filtered.some((s) => s.id === selectedSubId)) {
    selectedSubId = filtered[0]?.id || submissions[0]?.id || null;
  }

  const activeSub = submissions.find((s) => s.id === selectedSubId) || null;
  const rubric = activeSub?.challenge?.rubric || [
    { id: 'r-1', label: 'Clarity & Structure', description: 'Meets brief structure.', maxPoints: 5 },
    { id: 'r-2', label: 'Evidence & Precision', description: 'Concrete metrics or proof.', maxPoints: 5 },
  ];
  const rubricMax = rubric.reduce((sum, r) => sum + Number(r.maxPoints || 5), 0);

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Review Submissions</h1>
        <p class="page-subtitle">Score submitted challenge work with interactive rubric sliders and publish feedback.</p>
      </div>

      <div class="segmented" role="group" aria-label="Filter submission status">
        ${[
          { key: 'pending', label: 'Pending' },
          { key: 'approved', label: 'Approved' },
          { key: 'needs_revision', label: 'Needs revision' },
          { key: 'all', label: 'All' },
        ]
          .map(
            (t) => `<button type="button" class="segmented-btn ${subFilter === t.key ? 'is-active' : ''}" data-sub-filter="${t.key}">${t.label}</button>`
          )
          .join('')}
      </div>
    </div>

    ${
      filtered.length === 0 && !activeSub
        ? renderEmptyState({
            title: 'No submissions in this filter',
            message: 'Switch to All or wait for learners to submit practical challenges.',
          })
        : `
      <div class="lab-split">
        <div class="card">
          <h2 style="font-size:1.05rem; margin-bottom:12px;">Queue (${filtered.length})</h2>
          ${
            filtered.length === 0
              ? '<p style="font-size:14px; color:var(--color-text-muted);">No submissions match this status filter.</p>'
              : `
            <div class="divider-list">
              ${filtered
                .map(
                  (sub) => `
                <div class="divider-row activity-row-item ${sub.id === activeSub?.id ? 'is-selected' : ''}" data-select-sub="${escapeHtml(sub.id)}">
                  <div>
                    <div style="font-weight:600; color:var(--color-navy);">
                      ${escapeHtml(sub.learnerName)} — ${escapeHtml(sub.challenge?.title || 'Challenge')}
                    </div>
                    <div style="font-size:12px; color:var(--color-text-muted); margin-top:2px;">
                      ${escapeHtml(sub.learnerEmail)} · ${formatDateTime(sub.createdAt)}
                    </div>
                  </div>
                  ${renderStatusBadge(sub.status)}
                </div>
              `
                )
                .join('')}
            </div>
          `
          }
        </div>

        <aside class="card-workspace pop-in">
          ${
            activeSub
              ? `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">
              <div>
                <div style="font-size:12px; font-weight:600; color:var(--color-blue);">${escapeHtml(activeSub.learnerName)} (${escapeHtml(activeSub.learnerEmail)})</div>
                <h2 style="font-size:1.15rem; margin-top:2px;">${escapeHtml(activeSub.challenge?.title || 'Challenge')}</h2>
              </div>
              ${renderStatusBadge(activeSub.status)}
            </div>

            <div class="card" style="padding:14px; margin-bottom:14px;">
              <div style="font-size:12px; font-weight:600; color:var(--color-text-muted); margin-bottom:4px;">Learner explanation</div>
              <p style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(activeSub.explanation)}</p>
              <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                ${
                  activeSub.evidenceUrl
                    ? `<a href="${escapeHtml(activeSub.evidenceUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open evidence link ${icon('externalLink', 13)}</a>`
                    : ''
                }
                ${
                  activeSub.filePath
                    ? `<button type="button" class="btn btn-secondary btn-sm" id="open-signed-file" data-file-path="${escapeHtml(activeSub.filePath)}">
                        Inspect file (${escapeHtml(activeSub.fileName || 'attachment')})
                      </button>`
                    : ''
                }
              </div>
            </div>

            <form id="review-form" class="form-stack">
              <div style="margin-bottom:4px;">
                ${renderProgressRail({
                  id: 'admin-rubric-rail',
                  label: 'Rubric score summary',
                  value: 0,
                  max: rubricMax,
                  detail: `0/${rubricMax}`,
                })}
              </div>

              <div class="rubric-sheet">
                ${rubric
                  .map((r) => {
                    const currentVal = activeSub.rubricScores?.[r.id] ?? Math.min(4, r.maxPoints);
                    return `
                      <div class="rubric-row">
                        <div>
                          <div style="font-size:14px; font-weight:600; color:var(--color-navy);">${escapeHtml(r.label)}</div>
                          <div style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(r.description)}</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                          <input
                            type="range"
                            class="rubric-range"
                            data-rubric-range="${escapeHtml(r.id)}"
                            min="0"
                            max="${r.maxPoints}"
                            value="${currentVal}"
                            aria-label="${escapeHtml(r.label)} slider"
                          />
                          <input
                            type="number"
                            class="input rubric-score-input"
                            data-rubric-id="${escapeHtml(r.id)}"
                            min="0"
                            max="${r.maxPoints}"
                            value="${currentVal}"
                            style="width:58px; text-align:center;"
                            aria-label="${escapeHtml(r.label)} score"
                          />
                          <span class="mono-num" style="font-size:13px; color:var(--color-text-muted);">/${r.maxPoints}</span>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
                <div class="rubric-footer">
                  <span>Rubric total</span>
                  <span class="mono-num" id="rubric-total-display">0/${rubricMax}</span>
                </div>
              </div>

              <div class="field">
                <label class="field-label" for="review-feedback">Reviewer feedback</label>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:4px;">
                  ${FEEDBACK_SNIPPETS.map(
                    (snippet) => `<button type="button" class="btn btn-secondary btn-sm" data-snippet="${escapeHtml(snippet)}" style="min-height:28px; padding:2px 8px; font-size:12px;">+ ${escapeHtml(snippet)}</button>`
                  ).join('')}
                </div>
                <textarea class="textarea" id="review-feedback" name="feedback" placeholder="Explain strengths, rubric scoring rationale, and any revisions needed…" required>${escapeHtml(activeSub.feedback || '')}</textarea>
              </div>

              <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button type="submit" class="btn btn-primary" data-decision="approved">Approve &amp; Verify skill</button>
                <button type="submit" class="btn btn-secondary" data-decision="needs_revision">Request revision</button>
              </div>
            </form>
          `
              : '<p>Select a submission to review.</p>'
          }
        </aside>
      </div>
    `
    }
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    bind(root) {
      root.querySelectorAll('[data-sub-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          subFilter = btn.dataset.subFilter;
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-select-sub]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedSubId = btn.dataset.selectSub;
          rerender({ silent: true });
        });
      });

      root.querySelector('#open-signed-file')?.addEventListener('click', async (e) => {
        const path = e.currentTarget.dataset.filePath;
        const url = await getSignedEvidenceUrl(path);
        showToast(`Authorized private storage path ready: ${url}`, 'info');
      });

      const scoreInputs = [...root.querySelectorAll('.rubric-score-input')];
      const rangeInputs = [...root.querySelectorAll('.rubric-range')];
      const totalEl = root.querySelector('#rubric-total-display');
      const rail = root.querySelector('#admin-rubric-rail');

      const computeTotal = () => {
        let sum = 0;
        const scores = {};
        scoreInputs.forEach((inp) => {
          const max = Number(inp.max || 5);
          const val = Math.min(max, Math.max(0, Number(inp.value) || 0));
          scores[inp.dataset.rubricId] = val;
          sum += val;
        });
        const pct = rubricMax > 0 ? Math.round((sum / rubricMax) * 100) : 0;
        if (totalEl) totalEl.textContent = `${sum}/${rubricMax} (${pct}%)`;
        if (rail) {
          rail.querySelector('[data-rail-fill]').style.width = `${pct}%`;
          rail.querySelector('[data-rail-detail]').textContent = `${sum}/${rubricMax} (${pct}%)`;
        }
        return { sum, scores };
      };

      computeTotal();

      rangeInputs.forEach((rng) => {
        rng.addEventListener('input', () => {
          const paired = root.querySelector(`.rubric-score-input[data-rubric-id="${rng.dataset.rubricRange}"]`);
          if (paired) paired.value = rng.value;
          computeTotal();
        });
      });

      scoreInputs.forEach((inp) => {
        inp.addEventListener('input', () => {
          const paired = root.querySelector(`.rubric-range[data-rubric-range="${inp.dataset.rubricId}"]`);
          if (paired) paired.value = inp.value;
          computeTotal();
        });
      });

      const feedbackEl = root.querySelector('#review-feedback');
      root.querySelectorAll('[data-snippet]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const text = btn.dataset.snippet;
          feedbackEl.value = feedbackEl.value.trim()
            ? `${feedbackEl.value.trim()} ${text}`
            : text;
          feedbackEl.focus();
        });
      });

      let pendingDecision = 'approved';
      root.querySelectorAll('[data-decision]').forEach((btn) => {
        btn.addEventListener('click', () => {
          pendingDecision = btn.dataset.decision;
        });
      });

      root.querySelector('#review-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeSub) return;
        const { sum, scores } = computeTotal();
        const feedback = feedbackEl.value.trim();
        if (!feedback) {
          showToast('Please enter reviewer feedback before saving.', 'error');
          return;
        }
        await adminReviewSubmission({
          submissionId: activeSub.id,
          reviewerId: session.user.id,
          status: pendingDecision,
          rubricScores: scores,
          rubricTotal: sum,
          rubricMax,
          feedback,
        });
        showToast(
          pendingDecision === 'approved'
            ? 'Submission approved and learner skill verified!'
            : 'Revision requested with feedback.',
          'success'
        );
        rerender({ silent: true });
      });
    },
  };
}
