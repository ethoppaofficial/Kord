import { getOpportunityByIdForUser } from '../../lib/repositories/opportunityRepository.js';
import { escapeHtml } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderErrorState } from '../../components/Common.js';
import { getSavedOpportunityIds, toggleSavedOpportunity } from './OpportunitiesPage.js';
import { showToast } from '../../components/Toast.js';

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderOpportunityDetailPage({ params, session }) {
  const userId = session?.user?.id || null;
  const opp = await getOpportunityByIdForUser(params.id, userId);

  if (!opp) {
    return {
      html: renderErrorState({
        title: 'Opportunity not found',
        message: 'We could not find an opportunity matching that listing.',
      }) + `<div style="text-align:center; margin-top:16px;"><a href="/opportunities" data-link class="btn btn-primary btn-sm">Back to opportunities</a></div>`,
      bind() {},
    };
  }

  const savedSet = getSavedOpportunityIds(userId);
  const isSaved = savedSet.has(opp.id);
  const breakdown = opp.breakdown || [];
  const focus = opp.focusSkill;
  const otherInfo = opp.otherInfo || {};
  const orgTips = opp.orgTips || {};

  // Build personalized next steps for "Get closer to this role"
  const nextSteps = [];
  if (focus) {
    if (focus.skillCheckQuizId) {
      nextSteps.push(
        `Pass the ${focus.title} skill-check quiz with 70% or more to reach <strong>Demonstrated</strong>.`
      );
    } else {
      nextSteps.push(
        `Explore the ${focus.title} roadmap and complete the core learning activities.`
      );
    }
    if (focus.challengeId) {
      nextSteps.push(
        `Submit the ${focus.title} practical challenge. A reviewed score of 70% or more reaches <strong>Verified</strong>.`
      );
    }
  } else {
    nextSteps.push('Keep your verified evidence up to date and tailor your cover note to the role brief.');
  }

  return {
    html: `
      <div style="margin-bottom:14px;">
        <a href="/opportunities" data-link style="font-size:14px; font-weight:500;">← Back to opportunities</a>
      </div>

      <!-- Header Banner -->
      <div class="page-header" style="align-items:flex-start; margin-bottom:22px;">
        <div>
          <h1 style="font-size:clamp(1.6rem, 2.8vw, 2.1rem); font-weight:800; letter-spacing:-0.025em; color:var(--color-navy);">
            ${escapeHtml(opp.title)}
          </h1>
          <div style="font-size:15px; color:var(--color-text-secondary); margin-top:4px;">
            ${escapeHtml(opp.organization)}
          </div>
          <div class="meta-line" style="margin-top:10px;">
            <span class="status-tag status-blue">${escapeHtml(opp.opportunityType)}</span>
            <span class="status-tag status-neutral">${escapeHtml(
              opp.location.toLowerCase().includes((opp.workMode || '').toLowerCase())
                ? opp.location
                : `${opp.location} · ${opp.workMode}`
            )}</span>
            ${opp.isSample ? `<span class="status-tag status-amber">Sample listing</span>` : ''}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:18px; flex-shrink:0;">
          <button type="button" class="btn btn-secondary btn-sm" id="opp-detail-save" aria-pressed="${isSaved}">
            ${isSaved ? 'Saved' : 'Save listing'}
          </button>
          <div style="text-align:right;">
            <div class="mono-num" style="font-size:2.1rem; font-weight:800; line-height:1; color:var(--color-navy);">
              ${opp.matchPercent}%
            </div>
            <div style="font-size:13px; font-weight:600; color:var(--color-blue); margin-top:4px;">
              ${escapeHtml(opp.matchTier)}
            </div>
          </div>
        </div>
      </div>

      <div class="lab-split">
        <!-- LEFT COLUMN: Score Calculation, Your Evidence, Full Role & Org Details -->
        <div style="display:flex; flex-direction:column; gap:20px;">
          <!-- How the X% is calculated -->
          <section class="card">
            <h2 class="section-heading">How the ${opp.matchPercent}% is calculated</h2>

            <div style="overflow-x:auto;">
              <table class="calc-table" style="width:100%; border-collapse:collapse; font-size:14px;">
                <thead>
                  <tr style="border-bottom:1px solid var(--color-border); text-align:left; color:var(--color-text-muted); font-size:12px;">
                    <th style="padding:8px 10px 8px 0;">Required skill</th>
                    <th style="padding:8px 10px;">Needed</th>
                    <th style="padding:8px 10px;">Your level</th>
                    <th style="padding:8px 10px;">Level (70%)</th>
                    <th style="padding:8px 10px;">Evidence (30%)</th>
                    <th style="padding:8px 0 8px 10px; text-align:right;">Skill score</th>
                  </tr>
                </thead>
                <tbody>
                  ${breakdown
                    .map(
                      (row) => `
                    <tr style="border-bottom:1px solid var(--color-border);">
                      <td style="padding:11px 10px 11px 0; font-weight:600; color:var(--color-navy);">${escapeHtml(row.title)}</td>
                      <td style="padding:11px 10px; color:var(--color-text-secondary);">${escapeHtml(row.neededLabel)}</td>
                      <td style="padding:11px 10px; color:${row.isMissing ? 'var(--color-amber)' : 'var(--color-text)'}; font-weight:${row.isMissing ? '600' : '500'};">
                        ${escapeHtml(row.userLabel)}
                      </td>
                      <td class="mono-num" style="padding:11px 10px;">${row.levelPart.toFixed(2)}</td>
                      <td class="mono-num" style="padding:11px 10px;">${row.evidencePart.toFixed(2)}</td>
                      <td class="mono-num" style="padding:11px 0 11px 10px; text-align:right; font-weight:700; color:${row.skillScore > 0 ? 'var(--color-navy)' : 'var(--color-text-muted)'};">
                        ${row.skillScore}%
                      </td>
                    </tr>
                  `
                    )
                    .join('')}
                  <tr>
                    <td colspan="5" style="padding:12px 10px 4px 0; font-weight:700; color:var(--color-navy);">
                      Average of required skills
                    </td>
                    <td class="mono-num" style="padding:12px 0 4px 10px; text-align:right; font-weight:700; color:var(--color-navy);">
                      ${opp.matchPercent}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p style="margin-top:14px; font-size:13px; color:var(--color-text-muted); line-height:1.5;">
              Level score is 70% of the level weight: Declared 0.3, Practising 0.6, Demonstrated 0.8, Verified 1.0. Evidence is 30% of the average of your best quiz and best reviewed practical work. A skill below the level the job needs scores 0 and is listed as missing.
            </p>
          </section>

          <!-- Your evidence -->
          <section class="card">
            <h2 class="section-heading">Your evidence</h2>
            ${
              userId
                ? `
              <div style="display:flex; flex-direction:column; gap:8px; font-size:14px;">
                ${breakdown
                  .map(
                    (row) => `
                  <div>
                    <strong style="color:var(--color-navy);">${escapeHtml(row.title)}:</strong>
                    <span style="color:var(--color-text-secondary);">
                      ${row.bestQuizPct > 0 ? `best quiz ${row.bestQuizPct}%` : 'no quiz attempt yet'},
                      ${row.bestReviewedPct > 0 ? `best reviewed work ${row.bestReviewedPct}%` : 'no reviewed work yet'}
                    </span>
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
                : `<p style="font-size:14px; color:var(--color-text-muted);">
                    <a href="/login" data-link>Sign in as a learner</a> to see your personal quiz and challenge evidence breakdown for this role.
                  </p>`
            }
          </section>

          <!-- About the role & position -->
          <section class="card">
            <h2 class="section-heading">About the opportunity &amp; role</h2>
            <p style="font-size:15px; color:var(--color-text-secondary); line-height:1.65;">
              ${escapeHtml(opp.aboutRole || opp.summary)}
            </p>

            ${
              opp.responsibilities?.length
                ? `
              <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--color-border);">
                <h3 style="font-size:1.05rem; margin-bottom:10px;">Responsibilities</h3>
                <ul style="margin:0; padding-left:20px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:8px; font-size:14px;">
                  ${opp.responsibilities.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
              </div>
            `
                : ''
            }

            ${
              opp.requirements?.length
                ? `
              <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--color-border);">
                <h3 style="font-size:1.05rem; margin-bottom:10px;">Requirements</h3>
                <ul style="margin:0; padding-left:20px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:8px; font-size:14px;">
                  ${opp.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
              </div>
            `
                : ''
            }
          </section>

          <!-- Other information & Tips about the organization & how to apply -->
          <section class="card">
            <h2 class="section-heading">Other information &amp; organization tips</h2>

            <div class="lab-grid-2" style="margin-bottom:18px;">
              <div style="padding:12px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:8px;">
                <div style="font-size:12px; color:var(--color-text-muted);">Compensation</div>
                <div style="font-size:14px; font-weight:600; color:var(--color-navy); margin-top:2px;">${escapeHtml(otherInfo.compensation || 'To be confirmed')}</div>
              </div>
              <div style="padding:12px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:8px;">
                <div style="font-size:12px; color:var(--color-text-muted);">Duration &amp; commitment</div>
                <div style="font-size:14px; font-weight:600; color:var(--color-navy); margin-top:2px;">${escapeHtml(otherInfo.duration || 'Standard term')}</div>
              </div>
              <div style="padding:12px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:8px;">
                <div style="font-size:12px; color:var(--color-text-muted);">Schedule &amp; location</div>
                <div style="font-size:14px; font-weight:600; color:var(--color-navy); margin-top:2px;">${escapeHtml(otherInfo.schedule || opp.workMode)}</div>
              </div>
              <div style="padding:12px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:8px;">
                <div style="font-size:12px; color:var(--color-text-muted);">Application window</div>
                <div style="font-size:14px; font-weight:600; color:var(--color-navy); margin-top:2px;">${escapeHtml(otherInfo.deadline || 'Open')}</div>
              </div>
            </div>

            ${
              orgTips.aboutOrg
                ? `
              <div style="margin-bottom:14px;">
                <h3 style="font-size:1rem; margin-bottom:6px;">About ${escapeHtml(opp.organization)}</h3>
                <p style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(orgTips.aboutOrg)}</p>
              </div>
            `
                : ''
            }

            ${
              orgTips.howToApply
                ? `
              <div style="margin-bottom:14px;">
                <h3 style="font-size:1rem; margin-bottom:6px;">How to apply</h3>
                <p style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(orgTips.howToApply)}</p>
              </div>
            `
                : ''
            }

            ${
              orgTips.tips?.length
                ? `
              <div class="card-workspace" style="padding:14px 16px;">
                <div style="font-size:13px; font-weight:700; color:var(--color-navy); margin-bottom:6px;">Tips for standing out</div>
                <ul style="margin:0; padding-left:18px; font-size:13px; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:6px;">
                  ${orgTips.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}
                </ul>
              </div>
            `
                : ''
            }
          </section>
        </div>

        <!-- RIGHT COLUMN: Get closer to this role & Quick Apply Card -->
        <aside style="display:flex; flex-direction:column; gap:18px;">
          <section class="card" style="display:flex; flex-direction:column; gap:14px;">
            <h2 style="font-size:1.15rem;">Get closer to this role</h2>

            <ol style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; font-size:14px; color:var(--color-text-secondary);">
              ${nextSteps.map((st) => `<li>${st}</li>`).join('')}
            </ol>

            ${
              focus && opp.projectedMatchPercent > opp.matchPercent
                ? `
              <div class="card-workspace" style="padding:12px 14px; font-size:13px; color:var(--color-navy);">
                With your current evidence, reaching <strong>${escapeHtml(opp.projectedTargetLabel)}</strong> in ${escapeHtml(focus.title)} would lift this match to about <strong class="mono-num">${opp.projectedMatchPercent}%</strong>.
              </div>
            `
                : ''
            }

            <div style="display:flex; flex-direction:column; gap:10px;">
              ${
                focus?.skillCheckQuizId
                  ? `<a href="/quiz/${escapeHtml(focus.skillCheckQuizId)}" data-link class="btn btn-primary">Take the skill-check quiz</a>`
                  : `<a href="/explore" data-link class="btn btn-primary">Explore skill roadmaps</a>`
              }
              ${
                focus?.slug
                  ? `<a href="/roadmap/${escapeHtml(focus.slug)}" data-link class="btn btn-secondary">Open the ${escapeHtml(focus.title)} roadmap</a>`
                  : ''
              }
            </div>
          </section>

          <section class="card" style="display:flex; flex-direction:column; gap:12px;">
            <h2 style="font-size:1.15rem;">About this role</h2>
            <p style="font-size:14px; color:var(--color-text-secondary);">
              ${escapeHtml(opp.summary)}
            </p>
            <div>
              <a href="${escapeHtml(opp.applyUrl || 'https://example.org/apply')}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
                Apply on original listing ${icon('externalLink', 14)}
              </a>
            </div>
            <p style="font-size:12px; color:var(--color-text-muted);">
              Opens the employer's page in a new tab. Never pay anyone to get a job.
            </p>
          </section>
        </aside>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      root.querySelector('#opp-detail-save')?.addEventListener('click', (e) => {
        const saved = toggleSavedOpportunity(userId, opp.id);
        const btn = /** @type {HTMLElement | null} */ (e.currentTarget);
        if (btn) {
          btn.textContent = saved ? 'Saved' : 'Save listing';
          btn.setAttribute('aria-pressed', String(saved));
        }
        showToast(saved ? 'Opportunity saved to your shortlist.' : 'Removed from shortlist.', 'info');
      });
    },
  };
}
