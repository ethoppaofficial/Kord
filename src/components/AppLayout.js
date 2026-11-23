import { escapeHtml } from '../lib/formatters.js';
import { icon, kordLogoSvg } from '../lib/icons.js';

export function renderAppLayout({ session, currentPath, contentHtml }) {
  const user = session?.user || null;
  const isAdmin = user?.role === 'admin';
  const isLearner = user?.role === 'learner';

  // Strict actor separation & guest gate:
  // - Guests only see Sign in / Create account (cannot browse Explore or Opportunities until signed in)
  // - Learners see Learner navigation
  // - Admins see Admin navigation only
  const navItems = isAdmin
    ? [
        { path: '/admin', label: 'Overview', icon: 'shield', exact: true },
        { path: '/admin/submissions', label: 'Submissions', icon: 'fileText' },
        { path: '/admin/content', label: 'Content', icon: 'book' },
        { path: '/admin/quizzes', label: 'Quizzes', icon: 'award' },
        { path: '/admin/opportunities', label: 'Opportunities', icon: 'briefcase' },
        { path: '/admin/governance', label: 'Governance', icon: 'shield' },
      ]
    : isLearner
      ? [
          { path: '/explore', label: 'Explore', icon: 'compass' },
          { path: '/skills', label: 'My Skills', icon: 'award' },
          { path: '/opportunities', label: 'Opportunities', icon: 'briefcase' },
          { path: '/dashboard', label: 'Dashboard', icon: 'layout' },
        ]
      : [
          { path: '/', label: 'Home', icon: 'compass', exact: true },
          { path: '/login', label: 'Sign in', icon: 'arrowRight' },
        ];

  const isActive = (item) =>
    item.exact
      ? currentPath === item.path
      : item.path === '/'
        ? currentPath === '/'
        : currentPath === item.path || currentPath.startsWith(`${item.path}/`);

  const brandDestination = isAdmin ? '/admin' : isLearner ? '/dashboard' : '/';

  return `
    <div class="app-shell">
      <header class="site-header">
        <div class="container header-inner">
          <a href="${brandDestination}" data-link class="brand-link">
            <span class="brand-mark">${kordLogoSvg()}</span>
            <span>Kord</span>
          </a>

          <nav class="header-nav" aria-label="Primary navigation">
            ${navItems
              .map(
                (item) => `
                  <a href="${item.path}" data-link class="nav-link ${isActive(item) ? 'is-active' : ''}">
                    ${escapeHtml(item.label)}
                  </a>
                `
              )
              .join('')}
          </nav>

          <div class="header-actions">
            ${
              user
                ? `<button type="button" class="btn btn-secondary btn-sm" data-sign-out>Sign out</button>`
                : `<a href="/signup" data-link class="btn btn-primary btn-sm">Get started</a>`
            }
          </div>
        </div>
      </header>

      <main class="app-main" id="main-content">
        <div class="container">
          ${contentHtml}
        </div>
      </main>

      <footer class="site-footer">
        <div class="container" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
          <span>Kord — Learn. Practise. Demonstrate.</span>
          <span>Evidence-first skills &amp; opportunity lab</span>
        </div>
      </footer>

      ${
        user
          ? `
        <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
          ${navItems
            .slice(0, 5)
            .map(
              (item) => `
                <a href="${item.path}" data-link class="mobile-nav-item ${isActive(item) ? 'is-active' : ''}">
                  ${icon(item.icon, 18)}
                  <span>${escapeHtml(item.label)}</span>
                </a>
              `
            )
            .join('')}
        </nav>
      `
          : ''
      }
    </div>
  `;
}
