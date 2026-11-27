import { listOpportunities, adminUpsertOpportunity, adminDeleteOpportunity } from '../../lib/repositories/opportunityRepository.js';
import { listSkills } from '../../lib/repositories/contentRepository.js';
import { escapeHtml } from '../../lib/formatters.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { showToast } from '../../components/Toast.js';

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderAdminOpportunitiesPage({ currentPath, rerender }) {
  const [opportunities, skills] = await Promise.all([listOpportunities(), listSkills()]);

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Manage Opportunities</h1>
        <p class="page-subtitle">Curate internships, fellowships, apprenticeships, and junior roles mapped to Kord skill slugs.</p>
      </div>
    </div>

    <div class="lab-split">
      <section class="card">
        <h2 class="section-heading">Current listings (${opportunities.length})</h2>
        <div class="divider-list">
          ${opportunities
            .map(
              (o) => `
            <div class="divider-row" style="align-items:flex-start;">
              <div>
                <div style="font-weight:700; color:var(--color-navy);">${escapeHtml(o.title)}</div>
                <div class="meta-line" style="margin-top:2px;">
                  <span>${escapeHtml(o.organization)}</span>
                  <span class="meta-sep" aria-hidden="true">·</span>
                  <span>${escapeHtml(o.opportunityType)}</span>
                  <span class="meta-sep" aria-hidden="true">·</span>
                  <span>${escapeHtml(o.workMode)}</span>
                  ${o.isSample ? `<span class="meta-sep" aria-hidden="true">·</span><span style="color:var(--color-amber);">Sample listing</span>` : ''}
                </div>
                <div style="font-size:12px; color:var(--color-text-muted); margin-top:4px;">
                  Skills: ${(o.requiredSkillSlugs || []).join(', ') || 'None mapped'}
                </div>
              </div>
              <button type="button" class="btn btn-danger btn-sm" data-del-opp="${escapeHtml(o.id)}">Delete</button>
            </div>
          `
            )
            .join('')}
        </div>
      </section>

      <aside class="card-workspace">
        <h2 style="font-size:1.05rem; margin-bottom:12px;">Add opportunity</h2>
        <form id="admin-opp-form" class="form-stack">
          <div class="field">
            <label class="field-label" for="opp-title">Role title</label>
            <input class="input" id="opp-title" name="title" required placeholder="e.g. Junior Civic Analyst" />
          </div>
          <div class="field">
            <label class="field-label" for="opp-org">Organization</label>
            <input class="input" id="opp-org" name="organization" required placeholder="e.g. Metro Insights Lab" />
          </div>
          <div class="lab-grid-2">
            <div class="field">
              <label class="field-label" for="opp-type">Type</label>
              <select class="select" id="opp-type" name="opportunityType">
                <option value="Internship">Internship</option>
                <option value="Junior Role">Junior Role</option>
                <option value="Apprenticeship">Apprenticeship</option>
                <option value="Fellowship">Fellowship</option>
                <option value="Project">Project</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="opp-mode">Work mode</label>
              <select class="select" id="opp-mode" name="workMode">
                <option value="Remote">Remote</option>
                <option value="Hybrid">Hybrid</option>
                <option value="On-site">On-site</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="opp-loc">Location</label>
            <input class="input" id="opp-loc" name="location" value="Remote" required />
          </div>
          <div class="field">
            <span class="field-label">Required skills</span>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${skills
                .map(
                  (s) => `
                <label style="display:flex; align-items:center; gap:8px; font-size:13px;">
                  <input type="checkbox" name="reqSkills" value="${escapeHtml(s.slug)}" />
                  <span>${escapeHtml(s.title)}</span>
                </label>
              `
                )
                .join('')}
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="opp-summary">Summary</label>
            <textarea class="textarea" id="opp-summary" name="summary" style="min-height:76px;" required placeholder="Concise role overview shown on opportunity cards…"></textarea>
          </div>
          <div class="field">
            <label class="field-label" for="opp-apply-url">Original listing URL</label>
            <input class="input" id="opp-apply-url" name="applyUrl" type="url" placeholder="https://example.org/apply" />
          </div>

          <details style="border:1px solid var(--color-blue-border); border-radius:8px; padding:10px 12px; background:var(--color-surface);">
            <summary style="cursor:pointer; font-size:13px; font-weight:600; color:var(--color-navy);">
              Role details, requirements &amp; organization tips (optional)
            </summary>
            <div class="form-stack" style="margin-top:12px;">
              <div class="field">
                <label class="field-label" for="opp-about-role">About the opportunity &amp; role</label>
                <textarea class="textarea" id="opp-about-role" name="aboutRole" style="min-height:76px;" placeholder="Detailed context about the team, scope, and learning goals…"></textarea>
              </div>
              <div class="field">
                <label class="field-label" for="opp-resp">Responsibilities (one per line)</label>
                <textarea class="textarea" id="opp-resp" name="responsibilities" style="min-height:76px;" placeholder="Draft weekly stakeholder updates&#10;Collaborate on sprint QA"></textarea>
              </div>
              <div class="field">
                <label class="field-label" for="opp-req">Requirements (one per line)</label>
                <textarea class="textarea" id="opp-req" name="requirements" style="min-height:76px;" placeholder="Clear written communication&#10;Ability to collaborate across teams"></textarea>
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="opp-comp">Compensation</label>
                  <input class="input" id="opp-comp" name="compensation" placeholder="e.g. £24,000 / yr" />
                </div>
                <div class="field">
                  <label class="field-label" for="opp-dur">Duration</label>
                  <input class="input" id="opp-dur" name="duration" placeholder="e.g. 12 weeks" />
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="opp-deadline">Application window / deadline</label>
                <input class="input" id="opp-deadline" name="deadline" placeholder="e.g. Rolling review" />
              </div>
              <div class="field">
                <label class="field-label" for="opp-about-org">About the organization</label>
                <textarea class="textarea" id="opp-about-org" name="aboutOrg" style="min-height:68px;" placeholder="Mission and team culture…"></textarea>
              </div>
              <div class="field">
                <label class="field-label" for="opp-how-apply">How to apply</label>
                <textarea class="textarea" id="opp-how-apply" name="howToApply" style="min-height:68px;" placeholder="What applicants should attach or include…"></textarea>
              </div>
              <div class="field">
                <label class="field-label" for="opp-tips">Organization tips (one per line)</label>
                <textarea class="textarea" id="opp-tips" name="orgTipsList" style="min-height:68px;" placeholder="Link a verified Kord challenge brief&#10;Keep your cover note concise"></textarea>
              </div>
            </div>
          </details>

          <label style="display:flex; align-items:center; gap:8px; font-size:13px;">
            <input type="checkbox" name="isSample" checked />
            <span>Label as Sample listing</span>
          </label>
          <button type="submit" class="btn btn-primary btn-sm">Publish opportunity</button>
        </form>
      </aside>
    </div>
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    /** @param {HTMLElement} root */
    bind(root) {
      root.querySelectorAll('[data-del-opp]').forEach((node) => {
        const btn = /** @type {HTMLButtonElement} */ (node);
        btn.addEventListener('click', async () => {
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            await adminDeleteOpportunity(btn.dataset.delOpp || '');
            showToast('Opportunity removed.', 'success');
            rerender({ silent: true });
          } catch (err) {
            btn.disabled = false;
            showToast(err instanceof Error ? err.message : 'Unable to remove opportunity.', 'error');
          }
        });
      });

      root.querySelector('#admin-opp-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = /** @type {HTMLFormElement} */ (e.currentTarget);
        const submitBtn = /** @type {HTMLButtonElement | null} */ (form.querySelector('button[type="submit"]'));
        if (submitBtn?.disabled) return;
        if (submitBtn) submitBtn.disabled = true;

        /** @param {FormDataEntryValue | null} val */
        const splitLines = (val) =>
          String(val || '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);

        try {
          const fd = new FormData(form);
          const reqSkills = fd.getAll('reqSkills').map(String);
          const workMode = String(fd.get('workMode'));
          const compensation = String(fd.get('compensation') || '').trim();
          const duration = String(fd.get('duration') || '').trim();
          const deadline = String(fd.get('deadline') || '').trim();
          const aboutOrg = String(fd.get('aboutOrg') || '').trim();
          const howToApply = String(fd.get('howToApply') || '').trim();
          const tips = splitLines(fd.get('orgTipsList'));

          await adminUpsertOpportunity({
            title: String(fd.get('title')),
            organization: String(fd.get('organization')),
            opportunityType: String(fd.get('opportunityType')),
            workMode,
            location: String(fd.get('location')),
            summary: String(fd.get('summary')),
            aboutRole: String(fd.get('aboutRole') || '').trim(),
            responsibilities: splitLines(fd.get('responsibilities')),
            requirements: splitLines(fd.get('requirements')),
            otherInfo:
              compensation || duration || deadline
                ? {
                    compensation: compensation || 'Competitive / To be confirmed',
                    duration: duration || 'Fixed term or ongoing',
                    schedule: workMode,
                    deadline: deadline || 'Open for applications',
                  }
                : undefined,
            orgTips:
              aboutOrg || howToApply || tips.length
                ? {
                    aboutOrg: aboutOrg || undefined,
                    howToApply: howToApply || undefined,
                    tips,
                  }
                : undefined,
            applyUrl: String(fd.get('applyUrl') || '').trim(),
            requiredSkillSlugs: reqSkills,
            isSample: fd.get('isSample') === 'on',
          });
          showToast('Opportunity published.', 'success');
          rerender({ silent: true });
        } catch (err) {
          if (submitBtn) submitBtn.disabled = false;
          showToast(err instanceof Error ? err.message : 'Unable to publish opportunity.', 'error');
        }
      });
    },
  };
}
