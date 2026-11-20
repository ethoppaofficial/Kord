import {
  adminListSubmissions,
  adminReviewSubmission,
  getSignedEvidenceUrl,
} from '../../lib/repositories/submissionRepository.js';
import {
  adminListPendingAssessmentAttempts,
  adminGradeAttempt,
} from '../../lib/repositories/quizRepository.js';
import { isManualQuestionType } from '../../lib/assessmentEngine.js';
import { escapeHtml, formatDateTime } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge, renderEmptyState, renderProgressRail } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let reviewQueueTab = 'challenges'; // 'challenges' | 'written'
let subFilter = 'pending';
let selectedSubId = null;
let selectedAttemptId = null;

const FEEDBACK_SNIPPETS = [
  'Clear structure and verifiable metrics.',
  'Strong alignment with the brief criteria.',
  'Add concrete baseline numbers and owner dates.',
  'Include a risk mitigation section before resubmitting.',
];

export async function renderAdminSubmissionsPage({ currentPath, session, rerender }) {
  const [submissions, writtenAttempts] = await Promise.all([
    adminListSubmissions(),
    adminListPendingAssessmentAttempts(),
  ]);

  const pendingWrittenCount = writtenAttempts.filter((a) => a.reviewStatus === 'pending_review').length;
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

  if (!selectedAttemptId || !writtenAttempts.some((a) => a.id === selectedAttemptId)) {
    selectedAttemptId =
      writtenAttempts.find((a) => a.reviewStatus === 'pending_review')?.id || writtenAttempts[0]?.id || null;
  }
  const activeAttempt = writtenAttempts.find((a) => a.id === selectedAttemptId) || null;

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Review Submissions &amp; Written Exams</h1>
        <p class="page-subtitle">Grade practical challenges and manual written assessment items. Completing all published courses verifies parent skills.</p>
      </div>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${reviewQueueTab === 'challenges' ? 'is-active' : ''}" data-queue-tab="challenges">
          Practical Challenges (${submissions.filter((s) => s.status === 'pending').length} pending)
        </button>
        <button type="button" class="segmented-btn ${reviewQueueTab === 'written' ? 'is-active' : ''}" data-queue-tab="written">
          Written Assessments (${pendingWrittenCount} awaiting)
        </button>
      </div>
    </div>

    ${
      reviewQueueTab === 'challenges'
        ? `
      <div style="margin-bottom:16px;">
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
              title: 'No challenge submissions yet',
              message: 'Wait for learners to submit practical deliverables or switch to Written Assessments.',
            })
          : `
        <div class="lab-split">
          <div class="card">
            <h2 style="font-size:1.05rem; margin-bottom:12px;">Challenge Queue (${filtered.length})</h2>
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
                ${
                  activeSub.submissionText
                    ? `<div style="margin-top:10px; padding:10px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:6px; font-size:13px; white-space:pre-line;">
                        <strong>Direct submission text:</strong><br/>${escapeHtml(activeSub.submissionText)}
                      </div>`
                    : ''
                }
                <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                  ${
                    activeSub.evidenceUrl
                      ? `<a href="${escapeHtml(activeSub.evidenceUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open project link ${icon('externalLink', 13)}</a>`
                      : ''
                  }
                  ${
                    activeSub.repoUrl
                      ? `<a href="${escapeHtml(activeSub.repoUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open repository ${icon('externalLink', 13)}</a>`
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
                            <input type="range" class="rubric-range" data-rubric-range="${escapeHtml(r.id)}" min="0" max="${r.maxPoints}" value="${currentVal}" />
                            <input type="number" class="input rubric-score-input" data-rubric-id="${escapeHtml(r.id)}" min="0" max="${r.maxPoints}" value="${currentVal}" style="width:58px; text-align:center;" />
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
                  <textarea class="textarea" id="review-feedback" name="feedback" placeholder="Explain strengths and rubric scoring rationale…" required>${escapeHtml(activeSub.feedback || '')}</textarea>
                </div>

                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                  <button type="submit" class="btn btn-primary" data-decision="approved">Approve submission</button>
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
    `
        : writtenAttempts.length === 0
          ? renderEmptyState({
              title: 'No written assessment attempts waiting',
              message: 'Short-answer, long-form, and practical assessment questions appear here once learners submit them.',
            })
          : `
        <div class="lab-split">
          <div class="card">
            <h2 style="font-size:1.05rem; margin-bottom:12px;">Written Exam Attempts (${writtenAttempts.length})</h2>
            <div class="divider-list">
              ${writtenAttempts
                .map(
                  (a) => `
                <div class="divider-row activity-row-item ${a.id === activeAttempt?.id ? 'is-selected' : ''}" data-select-attempt="${escapeHtml(a.id)}">
                  <div>
                    <div style="font-weight:600; color:var(--color-navy);">${escapeHtml(a.learnerName)} — ${escapeHtml(a.quizTitle)}</div>
                    <div style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(a.learnerEmail)} · ${formatDateTime(a.createdAt)}</div>
                  </div>
                  ${renderStatusBadge(a.reviewStatus)}
                </div>
              `
                )
                .join('')}
            </div>
          </div>

          <aside class="card-workspace">
            ${
              activeAttempt
                ? `
              <h2 style="font-size:1.1rem; margin-bottom:6px;">${escapeHtml(activeAttempt.quizTitle)}</h2>
              <div style="font-size:13px; color:var(--color-text-muted); margin-bottom:14px;">Learner: ${escapeHtml(activeAttempt.learnerName)} · Pass threshold: ${activeAttempt.passPercent}%</div>

              <form id="written-grade-form" class="form-stack">
                ${(activeAttempt.questions || [])
                  .filter((q) => isManualQuestionType(q.questionType))
                  .map(
                    (q) => `
                  <div class="card" style="padding:12px;">
                    <div style="font-weight:600; font-size:13.5px; color:var(--color-navy); margin-bottom:6px;">
                      ${escapeHtml(q.prompt)} <span class="mono-num" style="color:var(--color-text-muted);">(${q.marks || 1} marks max)</span>
                    </div>
                    <div style="padding:8px 10px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:6px; font-size:13px; white-space:pre-line; margin-bottom:8px;">
                      ${escapeHtml(activeAttempt.answers?.[q.id] || 'No answer provided')}
                    </div>
                    <div class="field">
                      <label class="field-label" style="font-size:12.5px;">Awarded marks (0 – ${q.marks || 1})</label>
                      <input class="input written-mark-input" type="number" min="0" max="${q.marks || 1}" data-q-id="${escapeHtml(q.id)}" value="${activeAttempt.manualScores?.[q.id] ?? (q.marks || 1)}" />
                    </div>
                  </div>
                `
                  )
                  .join('')}

                <div class="field">
                  <label class="field-label" for="written-feedback">Grading feedback</label>
                  <textarea class="textarea" id="written-feedback" style="min-height:70px;" required placeholder="Provide written feedback on the learner's response…">${escapeHtml(activeAttempt.manualFeedback || '')}</textarea>
                </div>

                <button type="submit" class="btn btn-primary btn-sm">Publish Grade &amp; Update Course Progress</button>
              </form>
            `
                : ''
            }
          </aside>
        </div>
      `
    }
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    bind(root) {
      root.querySelectorAll('[data-queue-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          reviewQueueTab = btn.dataset.queueTab;
          rerender({ silent: true });
        });
      });

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

      root.querySelectorAll('[data-select-attempt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedAttemptId = btn.dataset.selectAttempt;
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
      if (scoreInputs.length > 0) computeTotal();

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
          feedbackEl.value = feedbackEl.value.trim() ? `${feedbackEl.value.trim()} ${text}` : text;
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
            ? 'Submission approved and course/skill progress updated!'
            : 'Revision requested with feedback.',
          'success'
        );
        rerender({ silent: true });
      });

      root.querySelector('#written-grade-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeAttempt) return;
        const manualScores = {};
        root.querySelectorAll('.written-mark-input').forEach((inp) => {
          manualScores[inp.dataset.qId] = Number(inp.value || 0);
        });
        const feedback = root.querySelector('#written-feedback')?.value.trim() || '';
        await adminGradeAttempt({
          attemptId: activeAttempt.id,
          reviewerId: session.user.id,
          manualScores,
          feedback,
        });
        showToast('Written assessment graded and course progress updated!', 'success');
        rerender({ silent: true });
      });
    },
  };
}
