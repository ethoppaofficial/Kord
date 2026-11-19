import { getChallengeById } from '../../lib/repositories/contentRepository.js';
import { getUserSubmissions, submitChallengeEvidence } from '../../lib/repositories/submissionRepository.js';
import { validateSubmissionForm, isValidUrl } from '../../lib/validators.js';
import { escapeHtml, formatDateTime } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

export async function renderChallengePage({ params, session, rerender }) {
  const challenge = await getChallengeById(params.challengeId);
  if (!challenge) {
    return {
      html: renderErrorState({ title: 'Challenge not found', message: 'We could not load this practical challenge.' }),
      bind() {},
    };
  }

  const userId = session.user.id;
  const submissions = await getUserSubmissions(userId, challenge.id);
  const rubricMax = (challenge.rubric || []).reduce((sum, r) => sum + Number(r.maxPoints || 5), 0);
  const backPath = challenge.skill?.slug ? `/roadmap/${challenge.skill.slug}` : '/skills';

  return {
    html: `
      <div style="margin-bottom:14px;">
        <a href="${escapeHtml(backPath)}" data-link style="font-size:14px; font-weight:500;">← Back to roadmap</a>
      </div>

      <div class="lab-split">
        <div style="display:flex; flex-direction:column; gap:20px;">
          <section class="card">
            <div class="meta-line" style="margin-bottom:6px;">
              <span>Practical Challenge</span>
              ${challenge.skill ? `<span class="meta-sep" aria-hidden="true">·</span><span>${escapeHtml(challenge.skill.title)}</span>` : ''}
            </div>
            <h1 class="page-title">${escapeHtml(challenge.title)}</h1>
            <p style="margin-top:12px; color:var(--color-text-secondary);">${escapeHtml(challenge.brief)}</p>
            ${
              challenge.deliverableHint
                ? `<p style="margin-top:10px; font-size:13px; color:var(--color-text-muted);"><strong>Accepted formats:</strong> ${escapeHtml(challenge.deliverableHint)}</p>`
                : ''
            }
          </section>

          <section>
            <h2 class="section-heading">Assessment rubric (<span class="mono-num">${rubricMax}</span> points total)</h2>
            <div class="rubric-sheet">
              ${(challenge.rubric || [])
                .map(
                  (item) => `
                <div class="rubric-row">
                  <div>
                    <div style="font-weight:600; color:var(--color-navy);">${escapeHtml(item.label)}</div>
                    <div style="font-size:13px; color:var(--color-text-secondary);">${escapeHtml(item.description)}</div>
                  </div>
                  <div class="mono-num" style="font-weight:600; color:var(--color-blue);">/${item.maxPoints}</div>
                </div>
              `
                )
                .join('')}
            </div>
          </section>

          <section class="card">
            <h2 class="section-heading">${submissions.length > 0 ? 'Resubmit or add new evidence' : 'Submit your evidence'}</h2>
            <form id="challenge-form" class="form-stack" novalidate>
              <div class="field">
                <label class="field-label" for="evidence-url">Evidence link (optional if uploading a file)</label>
                <input class="input" id="evidence-url" name="evidenceUrl" type="url" placeholder="https://docs.google.com/…" />
                <div class="field-error" data-error-for="evidenceUrl"></div>
              </div>

              <div class="field">
                <span class="field-label">Upload evidence file (optional if providing a link)</span>
                <div class="dropzone" id="evidence-dropzone" tabindex="0" role="button" aria-label="Choose or drop evidence file">
                  <div style="color:var(--color-blue); margin-bottom:4px;">${icon('upload', 20)}</div>
                  <div id="dropzone-label" style="font-size:14px; font-weight:600; color:var(--color-navy);">
                    Drop a file here or click to browse
                  </div>
                  <div id="dropzone-meta" style="font-size:12px; color:var(--color-text-muted); margin-top:2px;">
                    Stored in private user-scoped evidence storage
                  </div>
                </div>
                <input class="sr-only" id="evidence-file" name="evidenceFile" type="file" />
                <div style="display:flex; justify-content:flex-end;">
                  <button type="button" class="btn btn-ghost btn-sm" id="clear-file-btn" style="display:none;">Remove selected file</button>
                </div>
              </div>

              <div class="field-error" data-error-for="evidence"></div>

              <div class="field">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <label class="field-label" for="evidence-explanation">Explanation of your work (required)</label>
                  <span class="mono-num" id="explanation-counter" style="font-size:12px; color:var(--color-text-muted);">0 / 20 min chars</span>
                </div>
                <textarea class="textarea" id="evidence-explanation" name="explanation" placeholder="Describe what you produced, key decisions, and how it satisfies the rubric criteria…" required></textarea>
                <div class="field-error" data-error-for="explanation"></div>
              </div>

              <div class="card-workspace" style="padding:12px 14px; display:flex; gap:16px; flex-wrap:wrap; font-size:13px;" id="readiness-checklist">
                <span id="check-evidence" style="color:var(--color-text-muted);">○ Link or file attached</span>
                <span id="check-explanation" style="color:var(--color-text-muted);">○ Explanation (20+ chars)</span>
              </div>

              <button type="submit" class="btn btn-primary" id="challenge-submit">
                ${submissions.length > 0 ? 'Submit updated evidence' : 'Submit evidence for review'}
              </button>
            </form>
          </section>
        </div>

        <aside class="card">
          <h2 style="font-size:1.05rem; margin-bottom:12px;">Submission history</h2>
          ${
            submissions.length > 0
              ? `
            <div class="divider-list">
              ${submissions
                .map(
                  (sub) => `
                <div class="divider-row pop-in" style="flex-direction:column; align-items:stretch; gap:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <span style="font-size:12px; color:var(--color-text-muted);">${formatDateTime(sub.createdAt)}</span>
                    ${renderStatusBadge(sub.status)}
                  </div>
                  <p style="font-size:13px; color:var(--color-text-secondary);">${escapeHtml(sub.explanation)}</p>
                  <div style="font-size:12px; color:var(--color-text-muted);">
                    ${sub.evidenceUrl ? `URL: <a href="${escapeHtml(sub.evidenceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sub.evidenceUrl)}</a>` : ''}
                    ${sub.fileName ? `<div>File: ${escapeHtml(sub.fileName)}</div>` : ''}
                  </div>
                  ${
                    sub.rubricTotal !== null && sub.rubricTotal !== undefined
                      ? `
                    <div class="card-workspace" style="padding:10px 12px;">
                      <div style="font-size:13px; font-weight:600; color:var(--color-navy);">
                        Rubric score: <span class="mono-num">${sub.rubricTotal}/${sub.rubricMax || rubricMax}</span>
                      </div>
                      ${sub.feedback ? `<p style="font-size:13px; margin-top:4px; color:var(--color-text-secondary);">${escapeHtml(sub.feedback)}</p>` : ''}
                    </div>
                  `
                      : ''
                  }
                </div>
              `
                )
                .join('')}
            </div>
          `
              : '<p style="font-size:14px; color:var(--color-text-muted);">No submissions yet. Approved submissions verify this skill on your profile.</p>'
          }
        </aside>
      </div>
    `,
    bind(root) {
      const form = root.querySelector('#challenge-form');
      const urlEl = root.querySelector('#evidence-url');
      const fileEl = root.querySelector('#evidence-file');
      const dropzone = root.querySelector('#evidence-dropzone');
      const dropLabel = root.querySelector('#dropzone-label');
      const dropMeta = root.querySelector('#dropzone-meta');
      const clearBtn = root.querySelector('#clear-file-btn');
      const expEl = root.querySelector('#evidence-explanation');
      const counterEl = root.querySelector('#explanation-counter');
      const checkEvidenceEl = root.querySelector('#check-evidence');
      const checkExpEl = root.querySelector('#check-explanation');
      const submitBtn = root.querySelector('#challenge-submit');

      let selectedFile = null;

      const updateReadiness = () => {
        const hasValidUrl = urlEl.value.trim().length > 0 && isValidUrl(urlEl.value.trim());
        const hasEvidence = Boolean(selectedFile) || hasValidUrl;
        const expLen = expEl.value.trim().length;
        const hasExplanation = expLen >= 20;

        counterEl.textContent = `${expLen} / 20 min chars`;
        counterEl.style.color = hasExplanation ? 'var(--color-green)' : 'var(--color-text-muted)';

        checkEvidenceEl.textContent = hasEvidence ? '✓ Link or file attached' : '○ Link or file attached';
        checkEvidenceEl.style.color = hasEvidence ? 'var(--color-green)' : 'var(--color-text-muted)';
        checkEvidenceEl.style.fontWeight = hasEvidence ? '600' : '400';

        checkExpEl.textContent = hasExplanation ? '✓ Explanation ready' : '○ Explanation (20+ chars)';
        checkExpEl.style.color = hasExplanation ? 'var(--color-green)' : 'var(--color-text-muted)';
        checkExpEl.style.fontWeight = hasExplanation ? '600' : '400';
      };

      const setFile = (file) => {
        selectedFile = file || null;
        if (selectedFile) {
          dropzone.classList.add('has-file');
          dropLabel.textContent = selectedFile.name;
          dropMeta.textContent = `${Math.max(1, Math.round(selectedFile.size / 1024))} KB · Ready to upload`;
          clearBtn.style.display = 'inline-flex';
        } else {
          dropzone.classList.remove('has-file');
          dropLabel.textContent = 'Drop a file here or click to browse';
          dropMeta.textContent = 'Stored in private user-scoped evidence storage';
          clearBtn.style.display = 'none';
          fileEl.value = '';
        }
        updateReadiness();
      };

      dropzone?.addEventListener('click', () => fileEl.click());
      dropzone?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileEl.click();
        }
      });

      dropzone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
      dropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const dropped = e.dataTransfer?.files?.[0];
        if (dropped) setFile(dropped);
      });

      fileEl?.addEventListener('change', () => setFile(fileEl.files?.[0] || null));
      clearBtn?.addEventListener('click', () => setFile(null));
      urlEl?.addEventListener('input', updateReadiness);
      expEl?.addEventListener('input', updateReadiness);

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          evidenceUrl: urlEl.value.trim(),
          file: selectedFile,
          explanation: expEl.value.trim(),
        };

        const errors = validateSubmissionForm(payload);
        root.querySelector('[data-error-for="evidence"]').textContent = errors.evidence || '';
        root.querySelector('[data-error-for="evidenceUrl"]').textContent = errors.evidenceUrl || '';
        root.querySelector('[data-error-for="explanation"]').textContent = errors.explanation || '';
        if (Object.keys(errors).length > 0) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
        try {
          await submitChallengeEvidence({
            userId,
            challengeId: challenge.id,
            evidenceUrl: payload.evidenceUrl,
            file: payload.file,
            explanation: payload.explanation,
            rubricMax,
          });
          showToast('Evidence submitted for administrator review.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err.message || 'Submission failed.', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit evidence for review';
        }
      });
    },
  };
}
