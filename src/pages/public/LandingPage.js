import { escapeHtml } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderProgressRail } from '../../components/Common.js';
import { renderSkillCoverHtml } from '../../lib/skillCovers.js';

const STAGES = [
  {
    key: 'learning',
    title: '1. Learning',
    summary: 'Complete curated activities and autosave practical notes.',
    previewTitle: 'Activity: Structuring Executive Memos (BLUF)',
    previewDetail: '25 min · Verified guide from MindTools · Reflection note saved',
    level: 'Practising',
  },
  {
    key: 'understanding',
    title: '2. Understanding',
    summary: 'Pass phase checks and skill-check quizzes with explanations after grading.',
    previewTitle: 'Skill Check: Structured Business Writing',
    previewDetail: 'Scored 3/3 (100%) · Explanations unlocked after submission',
    level: 'Demonstrated',
  },
  {
    key: 'demonstrating',
    title: '3. Demonstrating',
    summary: 'Submit real artifacts reviewed against a 20-point rubric to earn Verified status.',
    previewTitle: 'Challenge: 1-Page Executive Operations Brief',
    previewDetail: 'Rubric 19/20 · Approved by Reviewer · Skill verified',
    level: 'Verified',
  },
];

const FEATURED_PREVIEWS = [
  {
    category: 'Communication',
    level: 'Beginner',
    hours: '3.5h',
    title: 'Structured Business Writing',
    summary: 'Write concise BLUF memos, executive summaries, and action-oriented updates decision-makers can scan in 30 seconds.',
    pct: 100,
  },
  {
    category: 'Data & Digital',
    level: 'Intermediate',
    hours: '4.0h',
    title: 'Digital Analytics & Measurement',
    summary: 'Define outcome-driven KPIs, separate vanity counts from conversions, and author clean measurement plans.',
    pct: 65,
  },
  {
    category: 'Product & Web',
    level: 'Beginner',
    hours: '3.5h',
    title: 'Web Accessibility Fundamentals',
    summary: 'Audit semantic HTML, keyboard focus order, and WCAG AA contrast so public digital services work for everyone.',
    pct: 40,
  },
];

export async function renderLandingPage({ session }) {
  const isSignedIn = Boolean(session?.user);

  return {
    html: `
      <section class="hero-grid">
        <div style="display:flex; flex-direction:column; gap:18px;">
          <div style="font-size:13px; font-weight:600; color:var(--color-blue);">
            Learn · Practise · Demonstrate
          </div>

          <h1 class="display-headline">Build evidence, not just intentions.</h1>

          <p style="font-size:1.05rem; color:var(--color-text-secondary); max-width:56ch;">
            Kord turns structured learning into verifiable proof. Sign in or create an account to unlock focused skill roadmaps, pass secure quizzes, submit challenge work, and match with real opportunities.
          </p>

          <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
            ${
              isSignedIn
                ? `
                  <a href="/dashboard" data-link class="btn btn-primary btn-lg">
                    Open your dashboard ${icon('arrowRight', 18)}
                  </a>
                  <a href="/explore" data-link class="btn btn-secondary btn-lg">
                    Explore skill roadmaps
                  </a>
                `
                : `
                  <a href="/signup" data-link class="btn btn-primary btn-lg">
                    Create free account ${icon('arrowRight', 18)}
                  </a>
                  <a href="/login" data-link class="btn btn-secondary btn-lg">
                    Sign in to unlock catalog
                  </a>
                `
            }
          </div>

          <p style="font-size:13px; color:var(--color-text-muted);">
            ${isSignedIn ? 'Your workspace is unlocked and ready.' : 'Sign in or register first to explore skills and opportunities.'}
          </p>
        </div>

        <aside class="card-navy" style="display:flex; flex-direction:column; gap:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="font-size:12px; font-weight:600; color:#93c5fd;">3-Stage Proof Engine</span>
            <span style="font-size:12px; color:#cbd5e1;">Select a stage</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;" id="hero-stage-list">
            ${STAGES.map(
              (st, idx) => `
              <button type="button" class="stage-btn ${idx === 2 ? 'is-active' : ''}" data-stage-btn="${st.key}">
                <div style="font-weight:700; font-size:14px;">${escapeHtml(st.title)}</div>
                <div style="font-size:13px; opacity:0.9; margin-top:2px;">${escapeHtml(st.summary)}</div>
              </button>
            `
            ).join('')}
          </div>

          <div id="hero-stage-preview" class="pop-in" style="padding:14px; border-radius:var(--radius-md); background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.16);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
              <span style="font-size:12px; color:#93c5fd; font-weight:600;">Resulting evidence</span>
              <span style="font-size:12px; color:#86efac; font-weight:600;" id="hero-stage-level">Verified</span>
            </div>
            <div style="font-size:14px; font-weight:700; color:#ffffff;" id="hero-stage-title">${escapeHtml(STAGES[2].previewTitle)}</div>
            <div style="font-size:12px; color:#cbd5e1; margin-top:3px;" id="hero-stage-detail">${escapeHtml(STAGES[2].previewDetail)}</div>
          </div>
        </aside>
      </section>

      <section style="margin-top:36px; padding-top:32px; border-top:1px solid var(--color-border);">
        <div class="page-header">
          <div>
            <h2 style="font-size:var(--text-section); font-weight:700;">How Kord tracks your mastery</h2>
            <p class="page-subtitle">Each skill track combines guided practice, secure knowledge checks, and rubric-reviewed proof.</p>
          </div>
          <a href="${isSignedIn ? '/explore' : '/signup'}" data-link class="btn btn-secondary btn-sm">
            ${isSignedIn ? 'Open full catalog' : 'Sign up to explore'}
          </a>
        </div>

        <div class="lab-grid-3">
          ${FEATURED_PREVIEWS.map(
            (item) => `
            <article class="skill-card">
              ${renderSkillCoverHtml(item)}
              <div class="skill-card-body">
                <div style="display:flex; flex-direction:column; gap:8px;">
                  <div class="meta-line">
                    <span>${escapeHtml(item.category)}</span>
                    <span class="meta-sep" aria-hidden="true">·</span>
                    <span>${escapeHtml(item.level)}</span>
                    <span class="meta-sep" aria-hidden="true">·</span>
                    <span class="mono-num">${escapeHtml(item.hours)}</span>
                  </div>
                  <h3 style="font-size:1.1rem;">${escapeHtml(item.title)}</h3>
                  <p class="line-clamp-2" style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(item.summary)}</p>
                </div>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  ${renderProgressRail({
                    label: 'Sample progression',
                    value: item.pct,
                    max: 100,
                    detail: `${item.pct}%`,
                  })}
                  <a href="${isSignedIn ? '/explore' : '/login'}" data-link class="btn btn-secondary btn-sm">
                    ${isSignedIn ? 'Open roadmap' : 'Sign in to start'} ${icon('arrowRight', 14)}
                  </a>
                </div>
              </div>
            </article>
          `
          ).join('')}
        </div>
      </section>
    `,
    bind(root) {
      const titleEl = root.querySelector('#hero-stage-title');
      const detailEl = root.querySelector('#hero-stage-detail');
      const levelEl = root.querySelector('#hero-stage-level');
      const previewEl = root.querySelector('#hero-stage-preview');

      root.querySelectorAll('[data-stage-btn]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const stage = STAGES.find((s) => s.key === btn.dataset.stageBtn);
          if (!stage) return;
          root.querySelectorAll('[data-stage-btn]').forEach((b) => b.classList.toggle('is-active', b === btn));
          titleEl.textContent = stage.previewTitle;
          detailEl.textContent = stage.previewDetail;
          levelEl.textContent = stage.level;
          previewEl.classList.remove('pop-in');
          void previewEl.offsetWidth;
          previewEl.classList.add('pop-in');
        });
      });
    },
  };
}
