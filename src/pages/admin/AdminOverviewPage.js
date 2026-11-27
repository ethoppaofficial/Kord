import { listCategories, listSkills, listAllCourses } from '../../lib/repositories/contentRepository.js';
import { adminListSubmissions } from '../../lib/repositories/submissionRepository.js';
import { listOpportunities } from '../../lib/repositories/opportunityRepository.js';
import { adminListAllQuizzes, adminListPendingAssessmentAttempts } from '../../lib/repositories/quizRepository.js';
import { getDemoState } from '../../lib/demo/demoStore.js';
import { isDemoMode, supabase } from '../../lib/supabase.js';
import { escapeHtml } from '../../lib/formatters.js';
import { buildUserGreeting } from '../../lib/greeting.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderAdminOverviewPage({ session, currentPath }) {
  const [categories, skills, courses, submissions, opportunities, quizzes, writtenAttempts, greetingInfo] =
    await Promise.all([
      listCategories(),
      listSkills({ includeDrafts: true }),
      listAllCourses({ includeDrafts: true }),
      adminListSubmissions(),
      listOpportunities(),
      adminListAllQuizzes(),
      adminListPendingAssessmentAttempts(),
      buildUserGreeting(session?.user),
    ]);

  let learnerCount = 0;
  if (!isDemoMode && supabase) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'learner');
    if (typeof count === 'number') learnerCount = count;
  } else {
    learnerCount = (getDemoState().users || []).filter((u) => u.role === 'learner').length;
  }

  const pendingChallenges = submissions.filter((s) => s.status === 'pending').length;
  const pendingWritten = writtenAttempts.filter((a) => a.reviewStatus === 'pending_review').length;
  const totalPending = pendingChallenges + pendingWritten;
  const publishedCourses = courses.filter((c) => c.publicationStatus === 'published').length;

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${escapeHtml(greetingInfo.text)}</h1>
        <p class="page-subtitle">Manage categories, multi-course pathways, visual JSON lesson blocks, 10-format assessments, and learner reviews.</p>
      </div>
      <a href="/admin/submissions" data-link class="btn btn-primary btn-sm">Review pending queue (${totalPending})</a>
    </div>

    <div class="kpi-strip" style="margin-bottom:24px;">
      <div class="kpi-box">
        <div class="kpi-label">Pending reviews</div>
        <div class="kpi-value mono-num">${totalPending}</div>
        <div class="kpi-meta">${pendingChallenges} challenges · ${pendingWritten} written exams</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Skills &amp; categories</div>
        <div class="kpi-value mono-num">${skills.length}</div>
        <div class="kpi-meta">Across ${categories.length} categories</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Courses &amp; assessments</div>
        <div class="kpi-value mono-num">${publishedCourses}</div>
        <div class="kpi-meta">${courses.length} total courses · ${quizzes.length} assessments</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Opportunities</div>
        <div class="kpi-value mono-num">${opportunities.length}</div>
        <div class="kpi-meta">${learnerCount} registered learners</div>
      </div>
    </div>

    <div class="lab-grid-2">
      <div class="card">
        <h2 style="font-size:1.15rem; margin-bottom:8px;">Challenge &amp; Written Exam Reviews</h2>
        <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:16px;">
          Score practical submissions with rubric sliders and grade short-answer or long-form assessment items. Parent skills verify once all published courses for that skill are completed.
        </p>
        <a href="/admin/submissions" data-link class="btn btn-secondary btn-sm">Open review queue →</a>
      </div>

      <div class="card">
        <h2 style="font-size:1.15rem; margin-bottom:8px;">Course Engine, Lessons &amp; Assessments</h2>
        <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:16px;">
          Add dynamic categories and skills, structure multi-phase courses, author JSON block lessons with validated YouTube videos, and manage 10-format assessments.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <a href="/admin/content" data-link class="btn btn-secondary btn-sm">Courses &amp; Lessons</a>
          <a href="/admin/quizzes" data-link class="btn btn-secondary btn-sm">Assessments</a>
          <a href="/admin/opportunities" data-link class="btn btn-secondary btn-sm">Opportunities</a>
          <a href="/admin/governance" data-link class="btn btn-secondary btn-sm">Governance &amp; Audit</a>
        </div>
      </div>
    </div>
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    bind() {},
  };
}
