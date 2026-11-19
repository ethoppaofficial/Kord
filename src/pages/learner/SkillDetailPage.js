import { getSkillBySlug } from '../../lib/repositories/contentRepository.js';
import { getUserEnrollments, enrollInSkill, setEnrollmentStatus, getUserActivityProgress } from '../../lib/repositories/progressRepository.js';
import { getUserSkills, declareUserSkill } from '../../lib/repositories/skillsRepository.js';
import { listRankedOpportunities } from '../../lib/repositories/opportunityRepository.js';
import { escapeHtml } from '../../lib/formatters.js';
import { renderProgressRail, renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

export async function renderSkillDetailPage({ params, session, navigate, rerender }) {
  const skill = await getSkillBySlug(params.slug);
  if (!skill) {
    return {
      html: renderErrorState({
        title: 'Skill not found',
        message: 'We could not find a roadmap matching that slug.',
      }),
      bind() {},
    };
  }

  const userId = session?.user?.id || null;
  const [enrollments, progress, userSkills, opportunities] = await Promise.all([
    userId ? getUserEnrollments(userId) : Promise.resolve([]),
    userId ? getUserActivityProgress(userId) : Promise.resolve([]),
    userId ? getUserSkills(userId) : Promise.resolve([]),
    listRankedOpportunities(userId),
  ]);

  const enrollment = enrollments.find((e) => e.skillId === skill.id) || null;
  const userSkill = userSkills.find((us) => us.skillId === skill.id) || null;
  const allActivities = (skill.phases || []).flatMap((p) => p.activities || []);
  const completedCount = allActivities.filter((a) =>
    progress.some((ap) => ap.activityId === a.id && ap.completed)
  ).length;
  const relatedOpps = opportunities
    .filter((o) => (o.requiredSkillSlugs || []).includes(skill.slug))
    .slice(0, 3);

  const isFull = skill.roadmapStatus === 'full';

  return {
    html: `
      <div style="margin-bottom:16px;">
        <a href="/explore" data-link style="font-size:14px; font-weight:500;">← Back to Explore Skills</a>
      </div>

      <div class="lab-split">
        <div style="display:flex; flex-direction:column; gap:20px;">
          <section class="card">
            <div class="meta-line" style="margin-bottom:8px;">
              <span>${escapeHtml(skill.category)}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span>${escapeHtml(skill.level)}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">${skill.estHours}h estimated</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
              <h1 class="page-title">${escapeHtml(skill.title)}</h1>
              ${renderStatusBadge(skill.roadmapStatus)}
            </div>
            <p style="margin-top:12px; color:var(--color-text-secondary);">${escapeHtml(skill.summary)}</p>

            ${
              skill.outcomes?.length
                ? `
              <div style="margin-top:18px; padding-top:16px; border-top:1px solid var(--color-border);">
                <h2 style="font-size:1rem; margin-bottom:10px;">What you will prove</h2>
                <ul style="margin:0; padding-left:18px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:6px;">
                  ${skill.outcomes.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
                </ul>
              </div>
            `
                : ''
            }
          </section>

          <section class="card">
            <h2 class="section-heading">Roadmap curriculum</h2>
            ${
              isFull && skill.phases.length > 0
                ? `
              <div style="display:flex; flex-direction:column; gap:18px;">
                ${skill.phases
                  .map(
                    (phase) => `
                  <div style="padding-bottom:14px; border-bottom:1px solid var(--color-border);">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px;">
                      <h3 style="font-size:1.05rem;">Phase ${phase.position}: ${escapeHtml(phase.title)}</h3>
                      <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${phase.activities.length} activities</span>
                    </div>
                    <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:10px;">${escapeHtml(phase.summary)}</p>
                    <ul style="margin:0; padding-left:18px; font-size:14px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:4px;">
                      ${phase.activities
                        .map((a) => {
                          const done = progress.some((ap) => ap.activityId === a.id && ap.completed);
                          return `<li>${escapeHtml(a.title)} (${a.estMinutes}m) ${done ? '<strong style="color:var(--color-green);">· Completed</strong>' : ''}</li>`;
                        })
                        .join('')}
                    </ul>
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
                : `
              <p style="color:var(--color-text-muted); font-size:14px;">
                This skill roadmap is currently in curation (Coming soon). You can still declare your interest from My Skills while activities are prepared.
              </p>
            `
            }
          </section>
        </div>

        <aside style="display:flex; flex-direction:column; gap:18px;">
          <div class="card-workspace" style="display:flex; flex-direction:column; gap:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:var(--color-navy);">Your status</strong>
              ${userSkill ? renderStatusBadge(userSkill.level) : '<span style="font-size:13px; color:var(--color-text-muted);">Not tracked yet</span>'}
            </div>

            ${
              isFull
                ? renderProgressRail({
                    label: 'Activities completed',
                    value: completedCount,
                    max: Math.max(1, allActivities.length),
                    detail: `${completedCount}/${allActivities.length}`,
                  })
                : ''
            }

            ${
              !userId
                ? `<a href="/login" data-link class="btn btn-primary">Sign in to enroll</a>`
                : isFull
                  ? `
                  ${
                    !enrollment
                      ? `<button type="button" class="btn btn-primary" id="enroll-btn">Enroll in roadmap</button>`
                      : `
                        <a href="/roadmap/${escapeHtml(skill.slug)}" data-link class="btn btn-primary">
                          ${enrollment.status === 'paused' ? 'View paused roadmap' : 'Open roadmap workspace'}
                        </a>
                        <button type="button" class="btn btn-secondary btn-sm" id="toggle-pause-btn">
                          ${enrollment.status === 'paused' ? 'Resume enrollment' : 'Pause enrollment'}
                        </button>
                      `
                  }
                  ${
                    skill.skillCheckQuizId
                      ? `<a href="/quiz/${escapeHtml(skill.skillCheckQuizId)}" data-link class="btn btn-secondary btn-sm">Take Skill Check quiz</a>`
                      : ''
                  }
                  ${
                    skill.challengeId
                      ? `<a href="/challenge/${escapeHtml(skill.challengeId)}" data-link class="btn btn-secondary btn-sm">Open practical challenge</a>`
                      : ''
                  }
                `
                  : `<button type="button" class="btn btn-secondary" id="declare-btn" ${userSkill ? 'disabled' : ''}>
                      ${userSkill ? 'Skill declared' : 'Declare interest in skill'}
                    </button>`
            }
          </div>

          ${
            relatedOpps.length > 0
              ? `
            <div class="card">
              <h3 style="font-size:1rem; margin-bottom:10px;">Related opportunities</h3>
              <div class="divider-list">
                ${relatedOpps
                  .map(
                    (o) => `
                  <a href="/opportunities/${escapeHtml(o.id)}" data-link class="divider-row" style="align-items:flex-start; text-decoration:none;">
                    <div>
                      <div style="font-weight:600; font-size:14px; color:var(--color-navy);">${escapeHtml(o.title)}</div>
                      <div style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(o.organization)} · ${escapeHtml(o.workMode)}</div>
                    </div>
                    <span class="mono-num" style="font-size:13px; font-weight:600; color:var(--color-blue);">${o.matchPercent}%</span>
                  </a>
                `
                  )
                  .join('')}
              </div>
              <div style="margin-top:12px;">
                <a href="/opportunities" data-link style="font-size:13px; font-weight:600;">Explore all matches →</a>
              </div>
            </div>
          `
              : ''
          }
        </aside>
      </div>
    `,
    bind(root) {
      root.querySelector('#enroll-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = 'Enrolling…';
        try {
          await enrollInSkill(userId, skill.id);
          await declareUserSkill(userId, skill.id);
          showToast(`Enrolled in ${skill.title}.`, 'success');
          navigate(`/roadmap/${skill.slug}`);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Enroll in roadmap';
          showToast(err?.message || 'Unable to enroll.', 'error');
        }
      });

      root.querySelector('#toggle-pause-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          const nextStatus = enrollment?.status === 'paused' ? 'active' : 'paused';
          await setEnrollmentStatus(userId, skill.id, nextStatus);
          showToast(nextStatus === 'paused' ? 'Roadmap paused.' : 'Roadmap resumed.', 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          showToast(err?.message || 'Unable to update enrollment.', 'error');
        }
      });

      root.querySelector('#declare-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          await declareUserSkill(userId, skill.id);
          showToast(`${skill.title} added as Declared.`, 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          showToast(err?.message || 'Unable to declare skill.', 'error');
        }
      });
    },
  };
}
