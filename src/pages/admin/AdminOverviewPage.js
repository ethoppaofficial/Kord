import { listSkills } from '../../lib/repositories/contentRepository.js';
import { adminListSubmissions } from '../../lib/repositories/submissionRepository.js';
import { listOpportunities } from '../../lib/repositories/opportunityRepository.js';
import { adminListAllQuizzes } from '../../lib/repositories/quizRepository.js';
import { getDemoState } from '../../lib/demo/demoStore.js';
import { hasSupabaseEnv, supabase } from '../../lib/supabase.js';
import { escapeHtml } from '../../lib/formatters.js';
import { buildUserGreeting } from '../../lib/greeting.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';

export async function renderAdminOverviewPage({ session, currentPath }) {
  const [skills, submissions, opportunities, quizzes, greetingInfo] = await Promise.all([
    listSkills(),
    adminListSubmissions(),
    listOpportunities(),
    adminListAllQuizzes(),
    buildUserGreeting(session?.user),
  ]);

  let learnerCount = getDemoState().users.filter((u) => u.role === 'learner').length;
  if (hasSupabaseEnv && supabase) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'learner');
    if (typeof count === 'number') learnerCount = count;
  }

  const pendingCount = submissions.filter((s) => s.status === 'pending').length;
  const approvedCount = submissions.filter((s) => s.status === 'approved').length;
  const fullRoadmaps = skills.filter((s) => s.roadmapStatus === 'full').length;

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${escapeHtml(greetingInfo.text)}</h1>
        <p class="page-subtitle">Review learner challenge submissions, manage roadmap content, maintain quiz keys, and publish opportunities.</p>
      </div>
      <a href="/admin/submissions" data-link class="btn btn-primary btn-sm">Review pending queue (${pendingCount})</a>
    </div>

    <div class="kpi-strip" style="margin-bottom:24px;">
      <div class="kpi-box">
        <div class="kpi-label">Pending submissions</div>
        <div class="kpi-value mono-num">${pendingCount}</div>
        <div class="kpi-meta">${approvedCount} approved total</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Skills catalog</div>
        <div class="kpi-value mono-num">${skills.length}</div>
        <div class="kpi-meta">${fullRoadmaps} full roadmaps</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Active quizzes</div>
        <div class="kpi-value mono-num">${quizzes.length}</div>
        <div class="kpi-meta">Phase &amp; skill checks</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Opportunities</div>
        <div class="kpi-value mono-num">${opportunities.length}</div>
        <div class="kpi-meta">${learnerCount} registered learners</div>
      </div>
    </div>

    <div class="lab-grid-2">
      <div class="card">
        <h2 style="font-size:1.15rem; margin-bottom:8px;">Submission Review Queue</h2>
        <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:16px;">
          Assess learner evidence against the 20-point challenge rubric. Approving a submission automatically upgrades the learner's skill to Verified.
        </p>
        <a href="/admin/submissions" data-link class="btn btn-secondary btn-sm">Open review queue →</a>
      </div>

      <div class="card">
        <h2 style="font-size:1.15rem; margin-bottom:8px;">Content, Quizzes &amp; Opportunities</h2>
        <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:16px;">
          Update roadmap statuses, add verified external activities, edit quiz answer keys securely, and publish new opportunities.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <a href="/admin/content" data-link class="btn btn-secondary btn-sm">Content</a>
          <a href="/admin/quizzes" data-link class="btn btn-secondary btn-sm">Quizzes</a>
          <a href="/admin/opportunities" data-link class="btn btn-secondary btn-sm">Opportunities</a>
        </div>
      </div>
    </div>
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    bind() {},
  };
}
