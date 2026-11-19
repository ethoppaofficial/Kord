import { listSkills, adminUpsertSkill, adminAddActivity } from '../../lib/repositories/contentRepository.js';
import { escapeHtml } from '../../lib/formatters.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

export async function renderAdminContentPage({ currentPath, rerender }) {
  const skills = await listSkills();

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Manage Content &amp; Roadmaps</h1>
        <p class="page-subtitle">Create or toggle skill roadmap availability and add learning activities with external resources.</p>
      </div>
    </div>

    <div class="lab-split">
      <section class="card">
        <h2 class="section-heading">Skills catalog (${skills.length})</h2>
        <div class="divider-list">
          ${skills
            .map(
              (s) => `
            <div class="divider-row" style="align-items:flex-start;">
              <div>
                <div style="font-weight:700; color:var(--color-navy);">${escapeHtml(s.title)}</div>
                <div class="meta-line" style="margin-top:2px;">
                  <span>${escapeHtml(s.category)}</span>
                  <span class="meta-sep" aria-hidden="true">·</span>
                  <span>${escapeHtml(s.level)}</span>
                  <span class="meta-sep" aria-hidden="true">·</span>
                  <span class="mono-num">${(s.phases || []).reduce((acc, p) => acc + (p.activities?.length || 0), 0)} activities</span>
                </div>
              </div>
              <div style="display:flex; gap:8px; align-items:center;">
                ${renderStatusBadge(s.roadmapStatus)}
                <button type="button" class="btn btn-secondary btn-sm" data-toggle-skill-status="${escapeHtml(s.id)}">
                  ${s.roadmapStatus === 'full' ? 'Set Coming soon' : 'Mark Full'}
                </button>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>

      <aside style="display:flex; flex-direction:column; gap:18px;">
        <div class="card">
          <h2 style="font-size:1.05rem; margin-bottom:12px;">Add new skill</h2>
          <form id="admin-skill-form" class="form-stack">
            <div class="field">
              <label class="field-label" for="skill-title">Skill title</label>
              <input class="input" id="skill-title" name="title" required placeholder="e.g. Data Visualization Ethics" />
            </div>
            <div class="lab-grid-2">
              <div class="field">
                <label class="field-label" for="skill-cat">Category</label>
                <select class="select" id="skill-cat" name="category">
                  <option value="Communication">Communication</option>
                  <option value="Data & Digital">Data &amp; Digital</option>
                  <option value="Product & Web">Product &amp; Web</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="skill-level">Level</label>
                <select class="select" id="skill-level" name="level">
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="skill-status">Roadmap status</label>
              <select class="select" id="skill-status" name="roadmapStatus">
                <option value="full">Full roadmap</option>
                <option value="coming_soon">Coming soon</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="skill-summary">Summary</label>
              <textarea class="textarea" id="skill-summary" name="summary" style="min-height:80px;" required placeholder="Concise description of what learners practise and prove…"></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Create skill</button>
          </form>
        </div>

        <div class="card-workspace">
          <h2 style="font-size:1.05rem; margin-bottom:12px;">Add activity to skill</h2>
          <form id="admin-activity-form" class="form-stack">
            <div class="field">
              <label class="field-label" for="act-skill">Target skill</label>
              <select class="select" id="act-skill" name="skillId">
                ${skills.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="act-title">Activity title</label>
              <input class="input" id="act-title" name="title" required placeholder="e.g. Auditing Form Labels" />
            </div>
            <div class="field">
              <label class="field-label" for="act-desc">Description</label>
              <input class="input" id="act-desc" name="description" required placeholder="Practical steps for the learner" />
            </div>
            <div class="lab-grid-2">
              <div class="field">
                <label class="field-label" for="act-mins">Est. minutes</label>
                <input class="input" id="act-mins" name="estMinutes" type="number" min="5" max="180" value="25" />
              </div>
              <div class="field">
                <label class="field-label" for="act-res-title">Resource label</label>
                <input class="input" id="act-res-title" name="resourceTitle" placeholder="MDN Guide" />
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="act-url">Resource URL</label>
              <input class="input" id="act-url" name="resourceUrl" type="url" placeholder="https://developer.mozilla.org/..." />
            </div>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px;">
              <input type="checkbox" name="verified" checked />
              <span>Mark external resource URL as verified</span>
            </label>
            <button type="submit" class="btn btn-primary btn-sm">Add activity</button>
          </form>
        </div>
      </aside>
    </div>
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    bind(root) {
      root.querySelectorAll('[data-toggle-skill-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (btn.disabled) return;
          const skill = skills.find((s) => s.id === btn.dataset.toggleSkillStatus);
          if (!skill) return;
          btn.disabled = true;
          try {
            await adminUpsertSkill({
              ...skill,
              roadmapStatus: skill.roadmapStatus === 'full' ? 'coming_soon' : 'full',
            });
            showToast(`Updated ${skill.title} status.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            btn.disabled = false;
            showToast(err?.message || 'Unable to update status.', 'error');
          }
        });
      });

      root.querySelector('#admin-skill-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;
        if (submitBtn) submitBtn.disabled = true;
        try {
          const fd = new FormData(form);
          await adminUpsertSkill({
            title: String(fd.get('title')),
            category: String(fd.get('category')),
            level: String(fd.get('level')),
            roadmapStatus: String(fd.get('roadmapStatus')),
            summary: String(fd.get('summary')),
          });
          showToast('Skill created.', 'success');
          rerender({ silent: true });
        } catch (err) {
          if (submitBtn) submitBtn.disabled = false;
          showToast(err?.message || 'Unable to create skill.', 'error');
        }
      });

      root.querySelector('#admin-activity-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;
        if (submitBtn) submitBtn.disabled = true;
        try {
          const fd = new FormData(form);
          await adminAddActivity({
            skillId: String(fd.get('skillId')),
            title: String(fd.get('title')),
            description: String(fd.get('description')),
            estMinutes: Number(fd.get('estMinutes') || 25),
            resourceTitle: String(fd.get('resourceTitle')),
            resourceUrl: String(fd.get('resourceUrl')),
            verified: fd.get('verified') === 'on',
          });
          showToast('Activity added to roadmap.', 'success');
          rerender({ silent: true });
        } catch (err) {
          if (submitBtn) submitBtn.disabled = false;
          showToast(err?.message || 'Unable to add activity.', 'error');
        }
      });
    },
  };
}
