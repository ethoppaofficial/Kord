import { getSkillBySlug } from '../../lib/repositories/contentRepository.js';
import {
  getUserEnrollments,
  enrollInSkill,
  setEnrollmentStatus,
  getUserActivityProgress,
  saveActivityNotes,
  toggleActivityComplete,
} from '../../lib/repositories/progressRepository.js';
import { declareUserSkill } from '../../lib/repositories/skillsRepository.js';
import { escapeHtml } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderProgressRail, renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let selectedActivityBySlug = {};

export async function renderRoadmapPage({ params, session, rerender }) {
  const skill = await getSkillBySlug(params.slug);
  if (!skill || skill.roadmapStatus !== 'full') {
    return {
      html: renderErrorState({
        title: 'Roadmap unavailable',
        message: 'This skill does not have an active roadmap yet.',
      }),
      bind() {},
    };
  }

  const userId = session.user.id;
  const [enrollments, progress] = await Promise.all([
    getUserEnrollments(userId),
    getUserActivityProgress(userId),
  ]);

  let enrollment = enrollments.find((e) => e.skillId === skill.id);
  if (!enrollment) {
    await enrollInSkill(userId, skill.id);
    await declareUserSkill(userId, skill.id);
    enrollment = { status: 'active' };
  }

  const progressByAct = new Map(progress.map((p) => [p.activityId, p]));
  const allActivities = (skill.phases || []).flatMap((p) => p.activities || []);
  const completedCount = allActivities.filter((a) => progressByAct.get(a.id)?.completed).length;

  const activeActId =
    selectedActivityBySlug[skill.slug] && allActivities.some((a) => a.id === selectedActivityBySlug[skill.slug])
      ? selectedActivityBySlug[skill.slug]
      : allActivities[0]?.id || null;

  const activeIdx = allActivities.findIndex((a) => a.id === activeActId);
  const activeActivity = activeIdx >= 0 ? allActivities[activeIdx] : null;
  const nextActivity = activeIdx >= 0 && activeIdx + 1 < allActivities.length ? allActivities[activeIdx + 1] : null;
  const activeProgress = activeActivity ? progressByAct.get(activeActivity.id) : null;

  const wordCount = (activeProgress?.notes || '').trim().split(/\s+/).filter(Boolean).length;

  return {
    html: `
      <div style="margin-bottom:14px;">
        <a href="/skills/${escapeHtml(skill.slug)}" data-link style="font-size:14px; font-weight:500;">← Skill overview</a>
      </div>

      <div class="page-header">
        <div>
          <div class="meta-line" style="margin-bottom:4px;">
            <span>${escapeHtml(skill.category)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(skill.level)}</span>
          </div>
          <h1 class="page-title">${escapeHtml(skill.title)}</h1>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          ${renderStatusBadge(enrollment.status)}
          <button type="button" class="btn btn-secondary btn-sm" id="roadmap-pause-btn">
            ${enrollment.status === 'paused' ? 'Resume roadmap' : 'Pause roadmap'}
          </button>
          ${
            skill.challengeId
              ? `<a href="/challenge/${escapeHtml(skill.challengeId)}" data-link class="btn btn-primary btn-sm">Practical challenge</a>`
              : ''
          }
        </div>
      </div>

      <div class="card" style="margin-bottom:24px;">
        ${renderProgressRail({
          id: 'roadmap-progress-rail',
          label: 'Overall roadmap completion',
          value: completedCount,
          max: Math.max(1, allActivities.length),
          detail: `${completedCount} of ${allActivities.length} activities completed`,
        })}
      </div>

      <div class="lab-split">
        <!-- Left: Phases & Activity Selector -->
        <div style="display:flex; flex-direction:column; gap:18px;">
          ${skill.phases
            .map((phase) => {
              const phaseDone = phase.activities.filter((a) => progressByAct.get(a.id)?.completed).length;
              return `
                <section class="card">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <h2 style="font-size:1.05rem;">Phase ${phase.position}: ${escapeHtml(phase.title)}</h2>
                    <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${phaseDone}/${phase.activities.length} done</span>
                  </div>
                  <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:12px;">${escapeHtml(phase.summary)}</p>

                  <div class="divider-list">
                    ${phase.activities
                      .map((act) => {
                        const ap = progressByAct.get(act.id);
                        const isSelected = act.id === activeActivity?.id;
                        return `
                          <div class="divider-row activity-row-item ${isSelected ? 'is-selected' : ''}" data-select-act="${escapeHtml(act.id)}">
                            <div style="min-width:0;">
                              <div style="font-weight:600; color:var(--color-navy);">
                                ${escapeHtml(act.title)}
                              </div>
                              <div style="font-size:12px; color:var(--color-text-muted); margin-top:2px;">
                                ${act.estMinutes} min ${ap?.notes ? '· Notes saved' : ''}
                              </div>
                            </div>
                            <div style="flex-shrink:0;">
                              ${
                                ap?.completed
                                  ? `<span class="status-tag status-green pop-in">${icon('check', 13)} Done</span>`
                                  : `<span class="btn btn-secondary btn-sm">${isSelected ? 'Viewing' : 'Open'}</span>`
                              }
                            </div>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>

                  ${
                    phase.quizId
                      ? `
                    <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                      <span style="font-size:13px; color:var(--color-text-secondary);">Confirm your understanding of Phase ${phase.position}</span>
                      <a href="/quiz/${escapeHtml(phase.quizId)}" data-link class="btn btn-secondary btn-sm">Take Phase ${phase.position} quiz →</a>
                    </div>
                  `
                      : ''
                  }
                </section>
              `;
            })
            .join('')}
        </div>

        <!-- Right: Active Activity Reading & Autosaved Notes Workspace -->
        <aside class="card-workspace pop-in" style="position:sticky; top:84px;">
          ${
            activeActivity
              ? `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">
              <div>
                <div style="font-size:12px; font-weight:600; color:var(--color-blue);">Active activity · ${activeActivity.estMinutes} min</div>
                <h2 style="font-size:1.15rem; margin-top:2px;">${escapeHtml(activeActivity.title)}</h2>
              </div>
              ${activeProgress?.completed ? '<span class="status-tag status-green pop-in">Completed</span>' : ''}
            </div>

            <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:14px;">${escapeHtml(activeActivity.description)}</p>

            <div style="margin-bottom:16px;">
              <div style="font-size:13px; font-weight:600; color:var(--color-navy); margin-bottom:6px;">Learning resources</div>
              ${(activeActivity.resources || [])
                .map(
                  (res) => `
                <a href="${escapeHtml(res.url)}" target="_blank" rel="noopener noreferrer" class="card card-interactive" style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; margin-bottom:8px; text-decoration:none;">
                  <div>
                    <div style="font-size:13px; font-weight:600; color:var(--color-blue);">${escapeHtml(res.title)}</div>
                    <div style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(res.source || 'External guide')} · ${res.verified ? 'Verified link' : 'Needs link check'}</div>
                  </div>
                  ${icon('externalLink', 15)}
                </a>
              `
                )
                .join('')}
            </div>

            <div class="field" style="margin-bottom:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <label class="field-label" for="activity-notes">Practice notes (autosaved)</label>
                <span id="notes-save-status" style="font-size:12px; color:var(--color-text-muted);">
                  ${wordCount} words · ${activeProgress?.notes ? 'Saved' : 'Ready'}
                </span>
              </div>
              <textarea class="textarea" id="activity-notes" placeholder="Summarize what you learned and one concrete change you will apply…">${escapeHtml(activeProgress?.notes || '')}</textarea>
            </div>

            <div style="display:flex; flex-direction:column; gap:10px;">
              <button type="button" class="btn ${activeProgress?.completed ? 'btn-secondary' : 'btn-primary'}" id="toggle-complete-btn">
                ${activeProgress?.completed ? 'Mark as incomplete' : 'Mark activity complete'}
              </button>
              ${
                activeProgress?.completed && nextActivity
                  ? `<button type="button" class="btn btn-navy btn-sm" id="next-activity-btn">Next: ${escapeHtml(nextActivity.title)} →</button>`
                  : ''
              }
              ${
                skill.skillCheckQuizId
                  ? `<a href="/quiz/${escapeHtml(skill.skillCheckQuizId)}" data-link class="btn btn-secondary btn-sm">Ready? Take Skill Check quiz</a>`
                  : ''
              }
            </div>
          `
              : '<p>Select an activity to begin.</p>'
          }
        </aside>
      </div>
    `,
    bind(root) {
      root.querySelectorAll('[data-select-act]').forEach((el) => {
        el.addEventListener('click', () => {
          selectedActivityBySlug[skill.slug] = el.dataset.selectAct;
          rerender({ silent: true });
        });
      });

      root.querySelector('#next-activity-btn')?.addEventListener('click', () => {
        if (nextActivity) {
          selectedActivityBySlug[skill.slug] = nextActivity.id;
          rerender({ silent: true });
        }
      });

      root.querySelector('#roadmap-pause-btn')?.addEventListener('click', async () => {
        const nextStatus = enrollment.status === 'paused' ? 'active' : 'paused';
        await setEnrollmentStatus(userId, skill.id, nextStatus);
        showToast(nextStatus === 'paused' ? 'Roadmap paused.' : 'Roadmap resumed.', 'success');
        rerender({ silent: true });
      });

      const notesEl = root.querySelector('#activity-notes');
      const statusEl = root.querySelector('#notes-save-status');
      let saveTimer = null;
      notesEl?.addEventListener('input', () => {
        if (!activeActivity) return;
        const words = notesEl.value.trim().split(/\s+/).filter(Boolean).length;
        statusEl.textContent = `${words} words · Saving…`;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(async () => {
          await saveActivityNotes(userId, activeActivity.id, notesEl.value);
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          statusEl.textContent = `${words} words · Saved at ${timeStr}`;
        }, 300);
      });

      root.querySelector('#toggle-complete-btn')?.addEventListener('click', async (e) => {
        if (!activeActivity) return;
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        const nextDone = !activeProgress?.completed;
        try {
          await toggleActivityComplete(
            userId,
            skill.id,
            activeActivity.id,
            activeActivity.estMinutes,
            nextDone
          );
          showToast(nextDone ? 'Activity marked complete.' : 'Activity marked incomplete.', 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          showToast(err?.message || 'Unable to update activity.', 'error');
        }
      });
    },
  };
}
