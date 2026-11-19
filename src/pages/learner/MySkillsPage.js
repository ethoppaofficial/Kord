import { listSkills } from '../../lib/repositories/contentRepository.js';
import { getUserSkills, declareUserSkill } from '../../lib/repositories/skillsRepository.js';
import { PROGRESSION_LADDER, PROGRESSION_WEIGHT } from '../../lib/constants.js';
import { escapeHtml, formatDate } from '../../lib/formatters.js';
import { renderStatusBadge, renderEmptyState, renderProgressRail } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

export async function renderMySkillsPage({ session, rerender }) {
  const userId = session.user.id;
  const [skills, userSkills] = await Promise.all([listSkills(), getUserSkills(userId)]);

  const userSkillById = new Map(userSkills.map((us) => [us.skillId, us]));
  const undeclaredSkills = skills.filter((s) => !userSkillById.has(s.id));

  return {
    html: `
      <div class="page-header">
        <div>
          <h1 class="page-title">My Skills &amp; Evidence Progression</h1>
          <p class="page-subtitle">Skill levels upgrade only when backed by completed activities, passed quizzes, or approved challenge evidence.</p>
        </div>
      </div>

      <section class="card" style="margin-bottom:24px;">
        <h2 style="font-size:1rem; margin-bottom:12px;">How skill levels are earned</h2>
        <div class="kpi-strip">
          ${PROGRESSION_LADDER.map(
            (step) => `
            <div class="kpi-box" style="padding:14px;">
              <div style="margin-bottom:6px;">${renderStatusBadge(step.key)}</div>
              <div style="font-size:13px; color:var(--color-text-secondary);">${escapeHtml(step.hint)}</div>
            </div>
          `
          ).join('')}
        </div>
      </section>

      <div class="lab-split">
        <section>
          <h2 class="section-heading">Your tracked skills (${userSkills.length})</h2>
          ${
            userSkills.length > 0
              ? `
            <div style="display:flex; flex-direction:column; gap:14px;">
              ${userSkills
                .map((us) => {
                  const skill = skills.find((s) => s.id === us.skillId);
                  if (!skill) return '';
                  const pct = Math.round((PROGRESSION_WEIGHT[us.level] || 0.3) * 100);
                  return `
                    <article class="card pop-in" style="display:flex; flex-direction:column; gap:12px;">
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                        <div>
                          <div class="meta-line" style="margin-bottom:4px;">
                            <span>${escapeHtml(skill.category)}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>Updated ${formatDate(us.updatedAt)}</span>
                          </div>
                          <a href="/skills/${escapeHtml(skill.slug)}" data-link style="font-size:1.1rem; font-weight:700; color:var(--color-navy);">
                            ${escapeHtml(skill.title)}
                          </a>
                          <p class="line-clamp-2" style="font-size:13px; color:var(--color-text-secondary); margin-top:4px;">${escapeHtml(skill.summary)}</p>
                        </div>
                        ${renderStatusBadge(us.level)}
                      </div>

                      ${renderProgressRail({
                        label: 'Skill mastery progression',
                        value: pct,
                        max: 100,
                        detail: `${pct}%`,
                      })}

                      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <a href="/skills/${escapeHtml(skill.slug)}" data-link class="btn btn-secondary btn-sm">Open roadmap</a>
                        ${
                          skill.skillCheckQuizId
                            ? `<a href="/quiz/${escapeHtml(skill.skillCheckQuizId)}" data-link class="btn btn-secondary btn-sm">Skill check</a>`
                            : ''
                        }
                        ${
                          skill.challengeId
                            ? `<a href="/challenge/${escapeHtml(skill.challengeId)}" data-link class="btn btn-primary btn-sm">Challenge</a>`
                            : ''
                        }
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>
          `
              : renderEmptyState({
                  title: 'No skills declared yet',
                  message: 'Declare a skill on the right or enroll in a roadmap to start tracking progression.',
                })
          }
        </section>

        <aside class="card-workspace">
          <h2 style="font-size:1.05rem; margin-bottom:8px;">Declare a skill</h2>
          <p style="font-size:13px; color:var(--color-text-secondary); margin-bottom:14px;">
            Declaring adds a skill at <strong>Declared</strong> level so you can benchmark yourself via Skill Check quizzes and see opportunity matches.
          </p>
          ${
            undeclaredSkills.length > 0
              ? `
            <form id="declare-skill-form" class="form-stack">
              <div class="field">
                <label class="field-label" for="declare-select">Select skill</label>
                <select class="select" id="declare-select" name="skillId">
                  ${undeclaredSkills
                    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)} (${escapeHtml(s.level)})</option>`)
                    .join('')}
                </select>
              </div>
              <button type="submit" class="btn btn-primary">Declare skill</button>
            </form>
          `
              : '<p style="font-size:13px; color:var(--color-green); font-weight:600;">All catalog skills are already in your profile.</p>'
          }
        </aside>
      </div>
    `,
    bind(root) {
      root.querySelector('#declare-skill-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const btn = form.querySelector('button[type="submit"]');
        if (btn?.disabled) return;
        if (btn) btn.disabled = true;
        const skillId = root.querySelector('#declare-select').value;
        try {
          await declareUserSkill(userId, skillId);
          showToast('Skill declared! Complete activities, quizzes, or a challenge to level up.', 'success');
          rerender({ silent: true });
        } catch (err) {
          if (btn) btn.disabled = false;
          showToast(err?.message || 'Unable to declare skill.', 'error');
        }
      });
    },
  };
}
