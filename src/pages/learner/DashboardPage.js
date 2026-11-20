import { getDashboardData } from '../../dashboard/dashboardData.js';
import { listAllCourses } from '../../lib/repositories/contentRepository.js';
import { escapeHtml, formatMinutes, formatDate } from '../../lib/formatters.js';
import { buildUserGreeting } from '../../lib/greeting.js';
import { renderOpportunityCard, renderCourseCard, renderStatusBadge, renderEmptyState, renderProgressRail } from '../../components/Common.js';
import { getSavedOpportunityIds, toggleSavedOpportunity } from './OpportunitiesPage.js';
import { showToast } from '../../components/Toast.js';

export async function renderDashboardPage({ session }) {
  const user = session.user;
  const [data, greetingInfo, publishedCourses] = await Promise.all([
    getDashboardData(user.id),
    buildUserGreeting(user),
    listAllCourses({ includeDrafts: false }),
  ]);
  const savedIds = getSavedOpportunityIds(user.id);

  const maxWeekly = Math.max(30, ...data.weeklyMinutes.map((w) => w.minutes));
  const maxHourly = Math.max(20, ...data.hourlyDistribution.map((h) => h.minutes));

  const latestWeek = data.weeklyMinutes[data.weeklyMinutes.length - 1];
  const topHour = data.hourlyDistribution.reduce(
    (best, cur) => (cur.minutes > best.minutes ? cur : best),
    data.hourlyDistribution[0]
  );

  return {
    html: `
      <div class="page-header">
        <div>
          <h1 class="page-title">${escapeHtml(greetingInfo.text)}</h1>
          <p class="page-subtitle">Track active courses, completed lessons, assessment mastery, and verified skills.</p>
        </div>
        <a href="/explore" data-link class="btn btn-primary btn-sm">Explore skills &amp; courses</a>
      </div>

      <!-- 1. LEARNING -->
      <section aria-labelledby="dash-learning-heading" style="margin-bottom:28px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h2 id="dash-learning-heading" class="section-heading" style="margin:0;">1. Learning</h2>
          <span style="font-size:13px; color:var(--color-text-muted);">Click any chart bar to inspect totals</span>
        </div>

        <div class="kpi-strip" style="margin-bottom:18px;">
          <div class="kpi-box">
            <div class="kpi-label">Active courses</div>
            <div class="kpi-value mono-num">${data.learning.activeCourses ?? data.learning.activeRoadmaps ?? 0}</div>
            <div class="kpi-meta">${data.learning.completedCourses || 0} completed · ${data.learning.pausedCourses || 0} paused</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Completed lessons</div>
            <div class="kpi-value mono-num">${data.learning.completedLessons ?? data.learning.completedActivities ?? 0}</div>
            <div class="kpi-meta">Earned from self-contained modules</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Assessments passed</div>
            <div class="kpi-value mono-num">${data.understanding.passedQuizzes}</div>
            <div class="kpi-meta">${data.understanding.averageScore}% average score</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Time learned</div>
            <div class="kpi-value mono-num">${formatMinutes(data.learning.minutesLearned)}</div>
            <div class="kpi-meta">Across completed lessons</div>
          </div>
        </div>

        ${
          (data.enrolledCourses || []).length > 0
            ? `
          <div class="card" style="margin-bottom:18px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <h3 style="font-size:1rem;">Your active &amp; completed courses</h3>
              <a href="/skills" data-link style="font-size:13px; font-weight:600;">View all courses →</a>
            </div>
            <div class="lab-grid-2">
              ${data.enrolledCourses
                .slice(0, 4)
                .map(
                  (c) => `
                <div style="padding:12px; border:1px solid var(--color-border); border-radius:var(--radius-sm); display:flex; flex-direction:column; gap:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <a href="/courses/${escapeHtml(c.slug)}" data-link style="font-weight:600; color:var(--color-navy);">${escapeHtml(c.title)}</a>
                    ${renderStatusBadge(c.progress?.isCompleted ? 'completed' : c.status)}
                  </div>
                  ${renderProgressRail({
                    label: `${c.skillTitle} · ${c.difficulty}`,
                    value: c.progress?.progressPercent || 0,
                    max: 100,
                    detail: `${c.progress?.progressPercent || 0}%`,
                  })}
                  <div style="font-size:12px; color:var(--color-text-muted);">
                    ${c.progress?.isCompleted ? 'Course completed' : `Projected completion: ${formatDate(c.progress?.projectedCompletionAt)}`}
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
            : publishedCourses.length > 0
              ? `
          <div class="card" style="margin-bottom:18px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
              <div>
                <h3 style="font-size:1.05rem;">Available Flagship Courses (${publishedCourses.length})</h3>
                <p style="font-size:13px; color:var(--color-text-muted); margin-top:2px;">Start any multi-module course below to track lessons, practical exercises, assessments, and verified mastery.</p>
              </div>
              <a href="/explore" data-link style="font-size:13px; font-weight:600;">Browse all ${publishedCourses.length} courses &amp; 99 skills →</a>
            </div>
            <div class="course-catalog-grid">
              ${publishedCourses
                .slice(0, 4)
                .map((course, idx) => renderCourseCard(course, { index: idx }))
                .join('')}
            </div>
          </div>
        `
              : ''
        }

        <div class="lab-grid-2">
          <div class="card">
            <h3 style="font-size:1rem; margin-bottom:4px;">Weekly learning minutes (last 9 weeks)</h3>
            <p style="font-size:13px; color:var(--color-text-muted);">Hover or click a week bar to inspect logged minutes.</p>
            <div class="chart-bars" role="group" aria-label="Weekly learning minutes chart">
              ${data.weeklyMinutes
                .map((w, idx) => {
                  const hPct = Math.round((w.minutes / maxWeekly) * 100);
                  const isLast = idx === data.weeklyMinutes.length - 1;
                  return `
                    <button type="button" class="chart-col ${isLast ? 'is-active' : ''}" data-week-idx="${idx}" title="${escapeHtml(w.label)}: ${w.minutes} mins">
                      <span class="mono-num" style="font-size:11px; color:var(--color-text-muted);">${w.minutes > 0 ? w.minutes : ''}</span>
                      <div class="chart-bar ${w.minutes === 0 ? 'is-muted' : ''}" style="height:${Math.max(5, hPct)}%; animation-delay:${idx * 25}ms;"></div>
                      <span class="chart-label">${escapeHtml(w.label)}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
            <div class="chart-callout" id="weekly-chart-callout">
              <span>Week of <strong>${escapeHtml(latestWeek?.label || '—')}</strong></span>
              <strong class="mono-num">${latestWeek?.minutes || 0} mins</strong>
            </div>
          </div>

          <div class="card">
            <h3 style="font-size:1rem; margin-bottom:4px;">Time-of-day study distribution</h3>
            <p style="font-size:13px; color:var(--color-text-muted);">Local hours when lessons were completed.</p>
            <div class="chart-bars" role="group" aria-label="Hourly study distribution chart">
              ${data.hourlyDistribution
                .map((b, idx) => {
                  const hPct = Math.round((b.minutes / maxHourly) * 100);
                  const isTop = b.label === topHour?.label;
                  return `
                    <button type="button" class="chart-col ${isTop ? 'is-active' : ''}" data-hour-idx="${idx}" title="${escapeHtml(b.label)}: ${b.minutes} mins">
                      <span class="mono-num" style="font-size:11px; color:var(--color-text-muted);">${b.minutes > 0 ? b.minutes : ''}</span>
                      <div class="chart-bar ${b.minutes === 0 ? 'is-muted' : ''}" style="height:${Math.max(5, hPct)}%; animation-delay:${idx * 30}ms;"></div>
                      <span class="chart-label">${escapeHtml(b.label)}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
            <div class="chart-callout" id="hourly-chart-callout">
              <span>Window <strong>${escapeHtml(topHour?.label || '—')}</strong></span>
              <strong class="mono-num">${topHour?.minutes || 0} mins</strong>
            </div>
          </div>
        </div>
      </section>

      <!-- 2. UNDERSTANDING & 3. DEMONSTRATING -->
      <div class="lab-grid-2" style="margin-bottom:28px;">
        <section class="card" aria-labelledby="dash-understanding-heading">
          <h2 id="dash-understanding-heading" class="section-heading">2. Understanding</h2>
          <p style="font-size:13px; color:var(--color-text-muted); margin-bottom:14px;">Multi-format assessments graded securely.</p>
          <div style="margin-bottom:14px;">
            ${renderProgressRail({
              label: 'Average assessment mastery',
              value: data.understanding.averageScore,
              max: 100,
              detail: `${data.understanding.averageScore}%`,
            })}
          </div>
          <div class="divider-list">
            <div class="divider-row">
              <span>Assessments passed</span>
              <strong class="mono-num" style="font-size:1.1rem;">${data.understanding.passedQuizzes}</strong>
            </div>
            <div class="divider-row">
              <span>Total attempts submitted</span>
              <strong class="mono-num" style="font-size:1.1rem;">${data.understanding.totalAttempts}</strong>
            </div>
            <div class="divider-row">
              <span>Average score</span>
              <strong class="mono-num" style="font-size:1.1rem;">${data.understanding.averageScore}%</strong>
            </div>
          </div>
        </section>

        <section class="card" aria-labelledby="dash-demonstrating-heading">
          <h2 id="dash-demonstrating-heading" class="section-heading">3. Demonstrating</h2>
          <p style="font-size:13px; color:var(--color-text-muted); margin-bottom:14px;">Practical deliverables assessed against rubrics.</p>
          <div class="divider-list">
            <div class="divider-row">
              <span>Approved submissions</span>
              <strong class="mono-num" style="color:var(--color-green); font-size:1.1rem;">${data.demonstrating.approvedSubmissions}</strong>
            </div>
            <div class="divider-row">
              <span>Pending review</span>
              <strong class="mono-num" style="color:var(--color-amber); font-size:1.1rem;">${data.demonstrating.pendingSubmissions}</strong>
            </div>
            <div class="divider-row">
              <span>Needs revision</span>
              <strong class="mono-num" style="color:var(--color-text-secondary); font-size:1.1rem;">${data.demonstrating.needsRevisionSubmissions}</strong>
            </div>
          </div>
        </section>
      </div>

      <!-- SKILL LEVELS & TOP OPPORTUNITY RECOMMENDATIONS -->
      <div class="lab-split">
        <section aria-labelledby="dash-opps-heading">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h2 id="dash-opps-heading" class="section-heading" style="margin:0;">Top opportunity recommendations</h2>
            <a href="/opportunities" data-link style="font-size:14px; font-weight:600;">See all →</a>
          </div>
          <div style="display:flex; flex-direction:column; gap:16px;">
            ${data.recommendations.map((opp) => renderOpportunityCard(opp, { isSaved: savedIds.has(opp.id) })).join('')}
          </div>
        </section>

        <aside class="card" aria-labelledby="dash-skills-heading">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h2 id="dash-skills-heading" class="section-heading" style="margin:0;">Your skill levels</h2>
            <a href="/skills" data-link style="font-size:13px; font-weight:600;">Manage</a>
          </div>
          ${
            data.skillLevels.length > 0
              ? `
            <div class="divider-list">
              ${data.skillLevels
                .map(
                  (s) => `
                <div class="divider-row">
                  <div>
                    <a href="/skills/${escapeHtml(s.slug)}" data-link style="font-weight:600; color:var(--color-navy);">${escapeHtml(s.title)}</a>
                    <div style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(s.category)}</div>
                  </div>
                  ${renderStatusBadge(s.level)}
                </div>
              `
                )
                .join('')}
            </div>
          `
              : renderEmptyState({
                  title: 'No skills tracked yet',
                  message: 'Enroll in a course under any skill to begin building verified mastery.',
                  actionHtml: `<a href="/explore" data-link class="btn btn-primary btn-sm">Explore skills</a>`,
                })
          }
        </aside>
      </div>
    `,
    bind(root) {
      const weeklyCallout = root.querySelector('#weekly-chart-callout');
      root.querySelectorAll('[data-week-idx]').forEach((col) => {
        const selectWeek = () => {
          const w = data.weeklyMinutes[Number(col.dataset.weekIdx)];
          if (!w) return;
          root.querySelectorAll('[data-week-idx]').forEach((c) => c.classList.toggle('is-active', c === col));
          weeklyCallout.innerHTML = `<span>Week of <strong>${escapeHtml(w.label)}</strong></span><strong class="mono-num">${w.minutes} mins</strong>`;
        };
        col.addEventListener('click', selectWeek);
        col.addEventListener('mouseenter', selectWeek);
      });

      const hourlyCallout = root.querySelector('#hourly-chart-callout');
      root.querySelectorAll('[data-hour-idx]').forEach((col) => {
        const selectHour = () => {
          const b = data.hourlyDistribution[Number(col.dataset.hourIdx)];
          if (!b) return;
          root.querySelectorAll('[data-hour-idx]').forEach((c) => c.classList.toggle('is-active', c === col));
          hourlyCallout.innerHTML = `<span>Window <strong>${escapeHtml(b.label)}</strong></span><strong class="mono-num">${b.minutes} mins</strong>`;
        };
        col.addEventListener('click', selectHour);
        col.addEventListener('mouseenter', selectHour);
      });

      root.querySelectorAll('[data-save-opp]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const saved = toggleSavedOpportunity(user.id, btn.dataset.saveOpp);
          btn.textContent = saved ? 'Saved' : 'Save';
          btn.setAttribute('aria-pressed', String(saved));
          showToast(saved ? 'Opportunity saved to shortlist.' : 'Removed from shortlist.', 'info');
        });
      });
    },
  };
}
