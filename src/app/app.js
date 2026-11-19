import { matchRoute } from './router.js';
import { getCurrentSession, signOut } from '../lib/repositories/authRepository.js';
import { renderAppLayout } from '../components/AppLayout.js';
import { renderErrorState, renderLoadingState } from '../components/Common.js';
import { showToast } from '../components/Toast.js';
import { closeModal } from '../components/Modal.js';

import { renderLandingPage } from '../pages/public/LandingPage.js';
import { renderLoginPage, renderSignupPage, renderForgotPasswordPage } from '../pages/public/AuthPages.js';
import { renderDashboardPage } from '../pages/learner/DashboardPage.js';
import { renderExplorePage } from '../pages/learner/ExplorePage.js';
import { renderSkillDetailPage } from '../pages/learner/SkillDetailPage.js';
import { renderCourseWorkspacePage } from '../pages/learner/CourseWorkspacePage.js';
import { renderRoadmapPage } from '../pages/learner/RoadmapPage.js';
import { renderQuizPage } from '../pages/learner/QuizPage.js';
import { renderChallengePage } from '../pages/learner/ChallengePage.js';
import { renderMySkillsPage } from '../pages/learner/MySkillsPage.js';
import { renderOpportunitiesPage } from '../pages/learner/OpportunitiesPage.js';
import { renderOpportunityDetailPage } from '../pages/learner/OpportunityDetailPage.js';
import { renderAdminOverviewPage } from '../pages/admin/AdminOverviewPage.js';
import { renderAdminSubmissionsPage } from '../pages/admin/AdminSubmissionsPage.js';
import { renderAdminContentPage } from '../pages/admin/AdminContentPage.js';
import { renderAdminQuizzesPage } from '../pages/admin/AdminQuizzesPage.js';
import { renderAdminOpportunitiesPage } from '../pages/admin/AdminOpportunitiesPage.js';

// Strict Access Policies:
// - 'public': '/' landing page (authenticated admins automatically stay in /admin)
// - 'auth_page': '/login', '/signup', '/forgot-password'
// - 'learner': strictly authenticated learner only (guests redirected to /login; admins isolated)
// - 'admin': strictly authenticated admin only (guests redirected to /login; learners blocked)
const ROUTES = [
  { pattern: '/', access: 'public', render: renderLandingPage },
  { pattern: '/login', access: 'auth_page', render: renderLoginPage },
  { pattern: '/signup', access: 'auth_page', render: renderSignupPage },
  { pattern: '/forgot-password', access: 'auth_page', render: renderForgotPasswordPage },

  { pattern: '/explore', access: 'learner', render: renderExplorePage },
  { pattern: '/skills/:slug', access: 'learner', render: renderSkillDetailPage },
  { pattern: '/courses/:slug', access: 'learner', render: renderCourseWorkspacePage },
  { pattern: '/opportunities', access: 'learner', render: renderOpportunitiesPage },
  { pattern: '/opportunities/:id', access: 'learner', render: renderOpportunityDetailPage },
  { pattern: '/dashboard', access: 'learner', render: renderDashboardPage },
  { pattern: '/skills', access: 'learner', render: renderMySkillsPage },
  { pattern: '/roadmap/:slug', access: 'learner', render: renderRoadmapPage },
  { pattern: '/quiz/:quizId', access: 'learner', render: renderQuizPage },
  { pattern: '/challenge/:challengeId', access: 'learner', render: renderChallengePage },

  { pattern: '/admin', access: 'admin', render: renderAdminOverviewPage },
  { pattern: '/admin/submissions', access: 'admin', render: renderAdminSubmissionsPage },
  { pattern: '/admin/content', access: 'admin', render: renderAdminContentPage },
  { pattern: '/admin/quizzes', access: 'admin', render: renderAdminQuizzesPage },
  { pattern: '/admin/opportunities', access: 'admin', render: renderAdminOpportunitiesPage },
];

export function mountApp(rootEl) {
  let renderSeq = 0;

  function navigate(path) {
    closeModal();
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderCurrentRoute({ animateRoute: true });
  }

  async function renderCurrentRoute({ silent = false, animateRoute = false } = {}) {
    const seq = ++renderSeq;
    const pathname = window.location.pathname || '/';
    const matched = matchRoute(ROUTES, pathname);

    let session = null;
    try {
      session = await getCurrentSession();
    } catch {
      session = null;
    }

    if (seq !== renderSeq) return;

    const role = session?.user?.role || null;

    if (matched) {
      // 1. Authenticated user hitting login/signup/forgot-password goes straight to their home
      if (matched.route.access === 'auth_page' && session) {
        const dest = role === 'admin' ? '/admin' : '/dashboard';
        window.history.replaceState({}, '', dest);
        return renderCurrentRoute({ animateRoute: true });
      }

      // 2. Keep signed-in Admin strictly inside the /admin workspace even from '/'
      if (matched.route.access === 'public' && role === 'admin') {
        window.history.replaceState({}, '', '/admin');
        return renderCurrentRoute({ animateRoute: true });
      }

      // 3. Guest user hitting ANY protected route (Explore, Opportunities, Skills, Dashboard, Admin)
      if ((matched.route.access === 'learner' || matched.route.access === 'admin') && !session) {
        showToast('Please sign in or create an account to continue.', 'info');
        window.history.replaceState({}, '', '/login');
        return renderCurrentRoute({ animateRoute: true });
      }

      // 4. Learner attempting to access Admin route
      if (matched.route.access === 'admin' && role !== 'admin') {
        rootEl.innerHTML = renderAppLayout({
          session,
          currentPath: pathname,
          contentHtml:
            renderErrorState({
              title: 'Administrator access required',
              message: 'Learner accounts cannot view or access Administrator pages.',
            }) +
            `<div style="text-align:center; margin-top:16px;"><a href="/dashboard" data-link class="btn btn-primary btn-sm">Return to Learner Dashboard</a></div>`,
        });
        bindShellEvents();
        return;
      }

      // 5. Admin attempting to access Learner-only routes (Explore, Opportunities, Dashboard, etc.)
      if (matched.route.access === 'learner' && role === 'admin') {
        rootEl.innerHTML = renderAppLayout({
          session,
          currentPath: pathname,
          contentHtml:
            renderErrorState({
              title: 'Administrator workspace isolation',
              message: 'Administrator accounts cannot view Learner accounts, Explore Skills, or Opportunities pages.',
            }) +
            `<div style="text-align:center; margin-top:16px;"><a href="/admin" data-link class="btn btn-primary btn-sm">Return to Admin Console</a></div>`,
        });
        bindShellEvents();
        return;
      }
    } else if (!session) {
      // Unknown route for guest -> send to login
      window.history.replaceState({}, '', '/login');
      return renderCurrentRoute({ animateRoute: true });
    }

    if (!silent && !rootEl.innerHTML) {
      rootEl.innerHTML = renderAppLayout({
        session,
        currentPath: pathname,
        contentHtml: renderLoadingState(),
      });
    }

    try {
      let view;
      if (!matched) {
        view = {
          html:
            renderErrorState({
              title: 'Page not found',
              message: `No route matches "${pathname}".`,
            }) +
            `<div style="text-align:center; margin-top:16px;"><a href="${role === 'admin' ? '/admin' : session ? '/dashboard' : '/'}" data-link class="btn btn-primary btn-sm">Go home</a></div>`,
          bind() {},
        };
      } else {
        view = await matched.route.render({
          params: matched.params,
          session,
          currentPath: matched.path,
          navigate,
          rerender: (opts = { silent: true }) => renderCurrentRoute(opts),
        });
      }

      if (seq !== renderSeq) return;

      const wrappedContent = animateRoute
        ? `<div class="view-enter">${view.html}</div>`
        : view.html;

      rootEl.innerHTML = renderAppLayout({
        session,
        currentPath: matched?.path || pathname,
        contentHtml: wrappedContent,
      });

      bindShellEvents();
      if (typeof view.bind === 'function') {
        view.bind(rootEl);
      }
    } catch (err) {
      if (seq !== renderSeq) return;
      rootEl.innerHTML = renderAppLayout({
        session,
        currentPath: pathname,
        contentHtml: renderErrorState({
          title: 'Something went wrong',
          message: err?.message || 'An unexpected error occurred while rendering this view.',
          retryAction: true,
        }),
      });
      bindShellEvents();
      rootEl.querySelector('[data-retry]')?.addEventListener('click', () => renderCurrentRoute({ animateRoute: true }));
    }
  }

  function bindShellEvents() {
    rootEl.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
      await signOut();
      showToast('Signed out.', 'info');
      navigate('/login');
    });
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http')) return;
    e.preventDefault();
    if (link.hasAttribute('data-modal-close')) {
      closeModal();
    }
    navigate(href);
  });

  window.addEventListener('popstate', () => {
    closeModal();
    renderCurrentRoute({ animateRoute: true });
  });

  renderCurrentRoute({ animateRoute: true });
}
