import { matchRoute } from './router.js';
import * as defaultAuthRepository from '../lib/repositories/authRepository.js';
import { runSessionCleanup } from '../lib/sessionLifecycle.js';
import { renderAppLayout } from '../components/AppLayout.js';
import { renderErrorState, renderLoadingState } from '../components/Common.js';
import { showToast } from '../components/Toast.js';
import { closeModal } from '../components/Modal.js';

import { renderLandingPage } from '../pages/public/LandingPage.js';
import {
  renderLoginPage,
  renderSignupPage,
  renderForgotPasswordPage,
  renderResetPasswordPage,
} from '../pages/public/AuthPages.js';
import { renderDashboardPage } from '../pages/learner/DashboardPage.js';
import { renderExplorePage } from '../pages/learner/ExplorePage.js';
import { renderSkillDetailPage } from '../pages/learner/SkillDetailPage.js';
import { renderCourseDetailsPage } from '../pages/learner/CourseDetailsPage.js';
import { renderCoursePhasePage } from '../pages/learner/CoursePhasePage.js';
import { renderCourseLessonPage } from '../pages/learner/CourseLessonPage.js';
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
// - 'recovery': '/reset-password' (accessible during PASSWORD_RECOVERY or active session)
// - 'learner': strictly authenticated learner only (guests redirected to /login; admins isolated)
// - 'admin': strictly authenticated admin only (guests redirected to /login; learners blocked)
const ROUTES = [
  { pattern: '/', access: 'public', render: renderLandingPage },
  { pattern: '/login', access: 'auth_page', render: renderLoginPage },
  { pattern: '/signup', access: 'auth_page', render: renderSignupPage },
  { pattern: '/forgot-password', access: 'auth_page', render: renderForgotPasswordPage },
  { pattern: '/reset-password', access: 'recovery', render: renderResetPasswordPage },

  { pattern: '/explore', access: 'learner', render: renderExplorePage },
  { pattern: '/skills/:slug', access: 'learner', render: renderSkillDetailPage },
  { pattern: '/courses/:slug', access: 'learner', render: renderCourseDetailsPage },
  { pattern: '/courses/:slug/phases/:phaseId', access: 'learner', render: renderCoursePhasePage },
  { pattern: '/courses/:slug/phases/:phaseId/lessons/:lessonId', access: 'learner', render: renderCourseLessonPage },
  { pattern: '/courses/:slug/assessments/:assessmentId', access: 'learner', render: renderQuizPage },
  { pattern: '/courses/:slug/challenges/:challengeId', access: 'learner', render: renderChallengePage },
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

export function mountApp(rootEl, options = {}) {
  const auth = options.auth || defaultAuthRepository;

  let renderSeq = 0;
  let destroyed = false;
  let localSignOutInProgress = false;
  let lastKnownAuth = {
    initialized: false,
    userId: null,
    role: null,
  };

  function getHomePathForRole(role) {
    return role === 'admin' ? '/admin' : '/dashboard';
  }

  function navigate(path) {
    if (destroyed) return Promise.resolve();
    closeModal();
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return renderCurrentRoute({ animateRoute: true });
  }

  async function handleAuthChange({ event, session: incomingSession, crossTab = true } = {}) {
    if (destroyed || localSignOutInProgress) return;

    if (event === 'PASSWORD_RECOVERY') {
      lastKnownAuth = {
        initialized: true,
        userId: incomingSession?.user?.id || null,
        role: incomingSession?.user?.role || null,
      };
      closeModal();
      window.history.replaceState({}, '', '/reset-password');
      await renderCurrentRoute({ animateRoute: true });
      return;
    }

    if (!lastKnownAuth.initialized) {
      return;
    }

    const prevUserId = lastKnownAuth.userId;
    const prevRole = lastKnownAuth.role;
    const nextUserId = incomingSession?.user?.id || null;
    const nextRole = incomingSession?.user?.role || null;

    if (prevUserId && !nextUserId) {
      lastKnownAuth = { initialized: true, userId: null, role: null };
      closeModal();
      runSessionCleanup();
      rootEl.innerHTML = '';
      if (crossTab) {
        showToast('Your session ended in another tab. Please sign in again.', 'info');
      }
      if (window.location.pathname !== '/login') {
        window.history.replaceState({}, '', '/login');
      }
      await renderCurrentRoute({ animateRoute: true });
      return;
    }

    if (prevUserId && nextUserId && prevUserId !== nextUserId) {
      lastKnownAuth = { initialized: true, userId: nextUserId, role: nextRole };
      closeModal();
      runSessionCleanup();
      rootEl.innerHTML = '';
      showToast(
        'Active account changed in another tab. Updating view to match the current session.',
        'info'
      );
      const dest = getHomePathForRole(nextRole);
      window.history.replaceState({}, '', dest);
      await renderCurrentRoute({ animateRoute: true });
      return;
    }

    if (prevUserId && prevUserId === nextUserId && prevRole !== nextRole) {
      lastKnownAuth = { initialized: true, userId: nextUserId, role: nextRole };
      closeModal();
      runSessionCleanup();
      rootEl.innerHTML = '';
      showToast('Account role updated. Redirecting to your authorized workspace.', 'info');
      const dest = getHomePathForRole(nextRole);
      window.history.replaceState({}, '', dest);
      await renderCurrentRoute({ animateRoute: true });
      return;
    }

    if (!prevUserId && nextUserId) {
      lastKnownAuth = { initialized: true, userId: nextUserId, role: nextRole };
      closeModal();
      runSessionCleanup();
      const pathname = window.location.pathname || '/';
      const matched = matchRoute(ROUTES, pathname);
      if (
        crossTab &&
        (matched?.route.access === 'auth_page' ||
          (matched?.route.access === 'public' && nextRole === 'admin'))
      ) {
        showToast('Signed in from another tab. Opening your workspace.', 'info');
        const dest = getHomePathForRole(nextRole);
        window.history.replaceState({}, '', dest);
        await renderCurrentRoute({ animateRoute: true });
      } else if (crossTab && matched?.route.access === 'public') {
        await renderCurrentRoute({ silent: true });
      }
    }
  }

  async function verifyActiveSession() {
    if (destroyed || localSignOutInProgress || !lastKnownAuth.initialized) return;
    let freshSession = null;
    try {
      freshSession = await auth.getCurrentSession();
    } catch {
      freshSession = null;
    }
    if (destroyed || localSignOutInProgress) return;
    const freshUserId = freshSession?.user?.id || null;
    const freshRole = freshSession?.user?.role || null;
    if (freshUserId !== lastKnownAuth.userId || freshRole !== lastKnownAuth.role) {
      await handleAuthChange({
        event: freshUserId ? 'SIGNED_IN' : 'SIGNED_OUT',
        session: freshSession,
        crossTab: true,
      });
    }
  }

  async function renderCurrentRoute({ silent = false, animateRoute = false } = {}) {
    if (destroyed) return;
    const seq = ++renderSeq;
    const pathname = window.location.pathname || '/';
    const matched = matchRoute(ROUTES, pathname);

    let session = null;
    try {
      session = await auth.getCurrentSession();
    } catch {
      session = null;
    }

    if (seq !== renderSeq || destroyed) return;

    const resolvedUserId = session?.user?.id || null;
    const resolvedRole = session?.user?.role || null;

    if (lastKnownAuth.initialized) {
      if (lastKnownAuth.userId && !resolvedUserId) {
        lastKnownAuth = { initialized: true, userId: null, role: null };
        closeModal();
        runSessionCleanup();
        rootEl.innerHTML = '';
        if (!localSignOutInProgress) {
          showToast('Your session ended. Please sign in again.', 'info');
        }
        if (pathname !== '/login') {
          window.history.replaceState({}, '', '/login');
          return renderCurrentRoute({ animateRoute: true });
        }
      } else if (
        lastKnownAuth.userId &&
        resolvedUserId &&
        (lastKnownAuth.userId !== resolvedUserId || lastKnownAuth.role !== resolvedRole)
      ) {
        lastKnownAuth = { initialized: true, userId: resolvedUserId, role: resolvedRole };
        closeModal();
        runSessionCleanup();
        rootEl.innerHTML = '';
        showToast(
          'Active account changed. Updating view to match the current session.',
          'info'
        );
        const dest = getHomePathForRole(resolvedRole);
        window.history.replaceState({}, '', dest);
        return renderCurrentRoute({ animateRoute: true });
      }
    }

    lastKnownAuth = {
      initialized: true,
      userId: resolvedUserId,
      role: resolvedRole,
    };

    const role = resolvedRole;

    if (matched) {
      if (matched.route.access === 'auth_page' && session) {
        if (auth.isPasswordRecoveryMode?.()) {
          window.history.replaceState({}, '', '/reset-password');
          return renderCurrentRoute({ animateRoute: true });
        }
        const dest = getHomePathForRole(role);
        window.history.replaceState({}, '', dest);
        return renderCurrentRoute({ animateRoute: true });
      }

      // Keep signed-in Admin strictly inside the /admin workspace even from '/'
      if (matched.route.access === 'public' && role === 'admin') {
        window.history.replaceState({}, '', '/admin');
        return renderCurrentRoute({ animateRoute: true });
      }

      // Guest user hitting ANY protected route (Explore, Opportunities, Skills, Dashboard, Admin)
      if ((matched.route.access === 'learner' || matched.route.access === 'admin') && !session) {
        rootEl.innerHTML = '';
        showToast('Please sign in or create an account to continue.', 'info');
        window.history.replaceState({}, '', '/login');
        return renderCurrentRoute({ animateRoute: true });
      }

      // Learner attempting to access Admin route
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

      // Admin attempting to access Learner-only routes (Explore, Opportunities, Dashboard, etc.)
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
      rootEl.innerHTML = '';
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
          auth,
          currentPath: matched.path,
          navigate,
          rerender: (opts = { silent: true }) => renderCurrentRoute(opts),
        });
      }

      if (seq !== renderSeq || destroyed) return;

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
      if (seq !== renderSeq || destroyed) return;
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
      if (localSignOutInProgress || destroyed) return;
      localSignOutInProgress = true;
      try {
        closeModal();
        rootEl.innerHTML = '';
        runSessionCleanup();
        await auth.signOut();
        lastKnownAuth = { initialized: true, userId: null, role: null };
        showToast('Signed out.', 'info');
        window.history.replaceState({}, '', '/login');
        await renderCurrentRoute({ animateRoute: true });
      } finally {
        localSignOutInProgress = false;
      }
    });
  }

  const onDocumentClick = (e) => {
    const link = e.target?.closest?.('a[data-link]');
    if (!link) return;
    if (!rootEl.contains(link) && !link.closest?.('.modal-backdrop')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http')) return;
    e.preventDefault();
    if (link.hasAttribute('data-modal-close')) {
      closeModal();
    }
    navigate(href);
  };

  const onPopState = () => {
    closeModal();
    renderCurrentRoute({ animateRoute: true });
  };

  const onWindowFocus = () => {
    verifyActiveSession();
  };

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      verifyActiveSession();
    }
  };

  document.addEventListener('click', onDocumentClick);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('focus', onWindowFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const unsubscribeAuth =
    typeof auth.subscribeAuthChanges === 'function'
      ? auth.subscribeAuthChanges((payload) => {
          handleAuthChange(payload);
        })
      : () => {};

  const ready = renderCurrentRoute({ animateRoute: true });

  return {
    ready,
    navigate,
    verifyActiveSession,
    renderCurrentRoute,
    destroy() {
      destroyed = true;
      unsubscribeAuth();
      document.removeEventListener('click', onDocumentClick);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
