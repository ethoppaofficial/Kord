import { getChallengeById } from '../../lib/repositories/contentRepository.js';
import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { getUserSubmissions, submitChallengeEvidence } from '../../lib/repositories/submissionRepository.js';
import { validateSubmissionForm, validateEvidenceFileContent, isValidUrl } from '../../lib/validators.js';
import { escapeHtml, formatDateTime } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderCourseBreadcrumbs, renderCourseOutlineDrawer, bindCourseOutlineDrawer } from '../../components/CourseOutlineDrawer.js';
import { renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderChallengePage({ params, session, navigate, rerender }) {
  if (!session?.user) {
    return { html: renderErrorState({ title: 'Sign in required', message: 'Please sign in to access challenges.' }), bind() {} };
  }
  const userId = session.user.id;
  /** @type {Awaited<ReturnType<typeof resolveCourseHierarchy>> | null} */
  let courseCtx = null;

  if (params.slug) {
    courseCtx = await resolveCourseHierarchy({
      courseSlug: params.slug,
      userId,
      requireEnrollment: true,
    });
    if (courseCtx.status !== 'ok') {
      return (
        renderHierarchyGuard({
          ctx: courseCtx,
          userId,
          targetUrlAfterEnroll: `/courses/${params.slug}/challenges/${params.challengeId}`,
          navigate,
        }) || { html: '', bind() {} }
      );
    }
  }

  const challenge = await getChallengeById(params.challengeId);
  if (!challenge || (courseCtx?.status === 'ok' && challenge.courseId !== courseCtx.course.id)) {
    return {
      html: renderErrorState({
        title: 'Challenge not found',
        message: courseCtx
          ? 'This practical challenge does not belong to the requested course.'
          : 'We could not load this practical challenge.',
      }),
      bind() {},
    };
  }

  if (!courseCtx && challenge.course?.slug) {
    courseCtx = await resolveCourseHierarchy({
      courseSlug: challenge.course.slug,
      userId,
      requireEnrollment: true,
    });
    if (courseCtx.status === 'enrollment_required') {
      return (
        renderHierarchyGuard({
          ctx: courseCtx,
          userId,
          targetUrlAfterEnroll: `/courses/${challenge.course.slug}/challenges/${params.challengeId}`,
          navigate,
        }) || { html: '', bind() {} }
      );
    }
  }

  const submissions = await getUserSubmissions(userId, challenge.id);
  const rubricMax = challenge.maxScore || (challenge.rubric || []).reduce((sum, r) => sum + Number(r.maxPoints || 5), 0);
  const activeCourse = courseCtx?.status === 'ok' ? courseCtx.course : challenge.course;
  const backToPhasePath =
    activeCourse?.slug && challenge.phaseId ? `/courses/${activeCourse.slug}/phases/${challenge.phaseId}` : null;
  const backPath =
    backToPhasePath ||
    (activeCourse?.slug ? `/courses/${activeCourse.slug}` : challenge.skill?.slug ? `/skills/${challenge.skill.slug}` : '/skills');

  const breadcrumbItems = activeCourse
    ? [
        { label: 'Explore', href: '/explore' },
        ...(activeCourse.skill ? [{ label: activeCourse.skill.title, href: `/skills/${activeCourse.skill.slug}` }] : []),
        { label: activeCourse.title, href: `/courses/${activeCourse.slug}` },
        ...(backToPhasePath ? [{ label: 'Phase overview', href: backToPhasePath }] : []),
        { label: challenge.title },
      ]
    : null;

  return {
    html: `
      ${
        breadcrumbItems && courseCtx?.status === 'ok'
          ? `
            ${renderCourseBreadcrumbs({ items: breadcrumbItems, showOutlineToggle: true })}
            ${renderCourseOutlineDrawer({
              course: courseCtx.course,
              orderedPhases: courseCtx.orderedPhases,
              phaseProgressById: courseCtx.phaseProgressById,
              progressByLesson: courseCtx.progressByLesson,
              assessments: courseCtx.assessments,
              challenges: courseCtx.challenges,
              activePhaseId: challenge.phaseId,
              courseProgress: courseCtx.courseProgress,
            })}
          `
          : `
            <div style="margin-bottom:14px;">
              <a href="${escapeHtml(backPath)}" data-link style="font-size:14px; font-weight:500;">← Back to ${backToPhasePath ? 'phase' : activeCourse ? escapeHtml(activeCourse.title) : 'Skill hub'}</a>
            </div>
          `
      }

      <div class="lab-split">
        <div style="display:flex; flex-direction:column; gap:20px;">
          <section class="card">
            <div class="meta-line" style="margin-bottom:6px;">
              <span>Practical Challenge</span>
              ${challenge.skill ? `<span class="meta-sep" aria-hidden="true">·</span><span>${escapeHtml(challenge.skill.title)}</span>` : ''}
              ${challenge.course ? `<span class="meta-sep" aria-hidden="true">·</span><span>${escapeHtml(challenge.course.title)}</span>` : ''}
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">Passing score: ${challenge.passingScore || Math.ceil(rubricMax * 0.7)}/${rubricMax}</span>
            </div>
            <h1 class="page-title">${escapeHtml(challenge.title)}</h1>
            <p style="margin-top:12px; color:var(--color-text-secondary);">${escapeHtml(challenge.brief)}</p>
            ${
              challenge.instructions && challenge.instructions !== challenge.brief
                ? `<div style="margin-top:14px; padding:12px 14px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-sm); font-size:13.5px; color:var(--color-text-secondary);">
                    <strong style="color:var(--color-navy);">Instructions:</strong> ${escapeHtml(challenge.instructions)}
                  </div>`
                : ''
            }
            ${
              challenge.expectedDeliverables?.length
                ? `<div style="margin-top:14px;">
                    <strong style="font-size:13px; color:var(--color-navy);">Expected deliverables:</strong>
                    <ul style="margin:6px 0 0; padding-left:18px; font-size:13.5px; color:var(--color-text-secondary);">
                      ${challenge.expectedDeliverables.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}
                    </ul>
                  </div>`
                : ''
            }
            ${
              challenge.deliverableHint || challenge.submissionFormat
                ? `<p style="margin-top:10px; font-size:13px; color:var(--color-text-muted);"><strong>Accepted formats:</strong> ${escapeHtml(challenge.deliverableHint || challenge.submissionFormat)}</p>`
                : ''
            }
            ${
              challenge.allowedEvidenceTypes?.length
                ? `<p style="margin-top:6px; font-size:12.5px; color:var(--color-text-muted);"><strong>Permitted evidence:</strong> ${escapeHtml(challenge.allowedEvidenceTypes.join(', '))} · Max upload ${Number(challenge.maxFileSizeMb || 25)} MB</p>`
                : ''
            }
          </section>

          <section>
            <h2 class="section-heading">Evaluation rubric (<span class="mono-num">${rubricMax}</span> points total)</h2>
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
                <label class="field-label" for="evidence-url">Live Project / Portfolio / Video URL (optional)</label>
                <input class="input" id="evidence-url" name="evidenceUrl" type="url" placeholder="https://docs.google.com/… or deployed URL" />
                <div class="field-error" data-error-for="evidenceUrl"></div>
              </div>

              <div class="field">
                <label class="field-label" for="evidence-repo-url">Code / Design Repository Link (optional)</label>
                <input class="input" id="evidence-repo-url" name="repoUrl" type="url" placeholder="https://github.com/username/project or Figma link" />
                <div class="field-error" data-error-for="repoUrl"></div>
              </div>

              <div class="field">
                <span class="field-label">Upload evidence file (optional, max ${Number(challenge.maxFileSizeMb || 25)} MB)</span>
                <div class="dropzone" id="evidence-dropzone" tabindex="0" role="button" aria-label="Choose or drop evidence file">
                  <div style="color:var(--color-blue); margin-bottom:4px;">${icon('upload', 20)}</div>
                  <div id="dropzone-label" style="font-size:14px; font-weight:600; color:var(--color-navy);">
                    Drop a file here or click to browse
                  </div>
                  <div id="dropzone-meta" style="font-size:12px; color:var(--color-text-muted); margin-top:2px;">
                    ${challenge.allowedMimeTypes?.length ? `Allowed MIME types: ${escapeHtml(challenge.allowedMimeTypes.join(', '))}` : 'Stored in private user-scoped evidence storage'}
                  </div>
                </div>
                <input class="sr-only" id="evidence-file" name="evidenceFile" type="file" />
                <div class="field-error" data-error-for="file"></div>
                <div style="display:flex; justify-content:flex-end;">
                  <button type="button" class="btn btn-ghost btn-sm" id="clear-file-btn" style="display:none;">Remove selected file</button>
                </div>
              </div>

              <div class="field">
                <label class="field-label" for="submission-text">Direct deliverable text (optional if providing URL or file)</label>
                <textarea class="textarea" id="submission-text" name="submissionText" style="min-height:90px;" placeholder="Paste your written brief, copy, script, or code solution directly here if preferred…"></textarea>
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
                <span id="check-evidence" style="color:var(--color-text-muted);">○ Deliverable attached (link, file, or text)</span>
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
                  ${sub.submissionText ? `<div style="padding:8px 10px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:6px; font-size:12.5px; white-space:pre-line;">${escapeHtml(sub.submissionText)}</div>` : ''}
                  <div style="font-size:12px; color:var(--color-text-muted); display:flex; flex-direction:column; gap:3px;">
                    ${sub.evidenceUrl ? `<div>Project URL: <a href="${escapeHtml(sub.evidenceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sub.evidenceUrl)}</a></div>` : ''}
                    ${sub.repoUrl ? `<div>Repository URL: <a href="${escapeHtml(sub.repoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sub.repoUrl)}</a></div>` : ''}
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
              : '<p style="font-size:14px; color:var(--color-text-muted);">No submissions yet. Approved work contributes toward course completion and skill verification.</p>'
          }
        </aside>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindCourseOutlineDrawer(root);
      const form = /** @type {HTMLFormElement | null} */ (root.querySelector('#challenge-form'));
      const urlEl = /** @type {HTMLInputElement | null} */ (root.querySelector('#evidence-url'));
      const repoUrlEl = /** @type {HTMLInputElement | null} */ (root.querySelector('#evidence-repo-url'));
      const fileEl = /** @type {HTMLInputElement | null} */ (root.querySelector('#evidence-file'));
      const subTextEl = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('#submission-text'));
      const dropzone = /** @type {HTMLElement | null} */ (root.querySelector('#evidence-dropzone'));
      const dropLabel = /** @type {HTMLElement | null} */ (root.querySelector('#dropzone-label'));
      const dropMeta = /** @type {HTMLElement | null} */ (root.querySelector('#dropzone-meta'));
      const clearBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#clear-file-btn'));
      const expEl = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('#evidence-explanation'));
      const counterEl = /** @type {HTMLElement | null} */ (root.querySelector('#explanation-counter'));
      const checkEvidenceEl = /** @type {HTMLElement | null} */ (root.querySelector('#check-evidence'));
      const checkExpEl = /** @type {HTMLElement | null} */ (root.querySelector('#check-explanation'));
      const submitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#challenge-submit'));

      /** @type {File | null} */
      let selectedFile = null;

      const updateReadiness = () => {
        const urlVal = urlEl?.value.trim() || '';
        const repoVal = repoUrlEl?.value.trim() || '';
        const hasValidUrl = urlVal.length > 0 && isValidUrl(urlVal);
        const hasValidRepo = repoVal.length > 0 && isValidUrl(repoVal);
        const hasText = (subTextEl?.value.trim().length || 0) >= 20;
        const hasEvidence = Boolean(selectedFile) || hasValidUrl || hasValidRepo || hasText;
        const expLen = expEl?.value.trim().length || 0;
        const hasExplanation = expLen >= 20;

        if (counterEl) {
          counterEl.textContent = `${expLen} / 20 min chars`;
          counterEl.style.color = hasExplanation ? 'var(--color-green)' : 'var(--color-text-muted)';
        }

        if (checkEvidenceEl) {
          checkEvidenceEl.textContent = hasEvidence ? '✓ Deliverable ready' : '○ Deliverable attached (link, file, or text)';
          checkEvidenceEl.style.color = hasEvidence ? 'var(--color-green)' : 'var(--color-text-muted)';
          checkEvidenceEl.style.fontWeight = hasEvidence ? '600' : '400';
        }

        if (checkExpEl) {
          checkExpEl.textContent = hasExplanation ? '✓ Explanation ready' : '○ Explanation (20+ chars)';
          checkExpEl.style.color = hasExplanation ? 'var(--color-green)' : 'var(--color-text-muted)';
          checkExpEl.style.fontWeight = hasExplanation ? '600' : '400';
        }
      };

      /** @param {File | null | undefined} file */
      const setFile = (file) => {
        selectedFile = file || null;
        if (selectedFile) {
          dropzone?.classList.add('has-file');
          if (dropLabel) dropLabel.textContent = selectedFile.name;
          if (dropMeta) dropMeta.textContent = `${Math.max(1, Math.round(selectedFile.size / 1024))} KB · Ready to upload`;
          if (clearBtn) clearBtn.style.display = 'inline-flex';
        } else {
          dropzone?.classList.remove('has-file');
          if (dropLabel) dropLabel.textContent = 'Drop a file here or click to browse';
          if (dropMeta) dropMeta.textContent = 'Stored in private user-scoped evidence storage';
          if (clearBtn) clearBtn.style.display = 'none';
          if (fileEl) fileEl.value = '';
        }
        updateReadiness();
      };

      dropzone?.addEventListener('click', () => fileEl?.click());
      dropzone?.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileEl?.click();
        }
      });
      dropzone?.addEventListener('dragover', (/** @type {DragEvent} */ e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
      dropzone?.addEventListener('drop', (/** @type {DragEvent} */ e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const dropped = e.dataTransfer?.files?.[0];
        if (dropped) setFile(dropped);
      });

      fileEl?.addEventListener('change', () => setFile(fileEl.files?.[0] || null));
      clearBtn?.addEventListener('click', () => setFile(null));
      urlEl?.addEventListener('input', updateReadiness);
      repoUrlEl?.addEventListener('input', updateReadiness);
      subTextEl?.addEventListener('input', updateReadiness);
      expEl?.addEventListener('input', updateReadiness);

      form?.addEventListener('submit', async (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        const submissionText = subTextEl?.value.trim() || '';
        const payload = {
          evidenceUrl: urlEl?.value.trim() || '',
          repoUrl: repoUrlEl?.value.trim() || '',
          file: selectedFile,
          submissionText,
          explanation: expEl?.value.trim() || '',
          challenge,
        };

        /** @type {Record<string, string>} */
        const errors = validateSubmissionForm(payload);
        if (!errors.file && payload.file) {
          const contentErr = await validateEvidenceFileContent(payload.file, challenge);
          if (contentErr) errors.file = contentErr;
        }
        const setFieldErr = (/** @type {string} */ key, /** @type {string} */ msg) => {
          const el = root.querySelector(`[data-error-for="${key}"]`);
          if (el) el.textContent = msg;
        };
        setFieldErr('evidence', errors.evidence || '');
        setFieldErr('evidenceUrl', errors.evidenceUrl || '');
        setFieldErr('repoUrl', errors.repoUrl || '');
        setFieldErr('file', errors.file || '');
        setFieldErr('explanation', errors.explanation || '');
        if (Object.keys(errors).length > 0) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting…';
        }
        try {
          await submitChallengeEvidence({
            userId,
            challengeId: challenge.id,
            courseId: challenge.courseId || null,
            evidenceUrl: payload.evidenceUrl,
            repoUrl: payload.repoUrl,
            file: payload.file,
            submissionText,
            explanation: payload.explanation,
            rubricMax,
            challenge,
          });
          showToast('Evidence submitted for administrator review.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Submission failed.', 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit evidence for review';
          }
        }
      });
    },
  };
}
