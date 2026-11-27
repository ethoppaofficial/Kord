import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { installDomHarness, flushMicrotasks } from './helpers/domHarness.mjs';
import {
  resetDemoState,
  getDemoState,
  updateDemoState,
  subscribeDemoState,
  getDemoCurrentUserId,
  setDemoCurrentUserId,
  syncDemoStateFromStorage,
} from '../src/lib/demo/demoStore.js';
import {
  createAuthService,
  signIn,
  signOut,
  requestPasswordReset,
  getCurrentSession,
} from '../src/lib/repositories/authRepository.js';
import { enrollInCourse } from '../src/lib/repositories/progressRepository.js';
import { submitChallengeEvidence } from '../src/lib/repositories/submissionRepository.js';
import { getCourseBySlug } from '../src/lib/repositories/contentRepository.js';
import { registerSessionCleanup, runSessionCleanup } from '../src/lib/sessionLifecycle.js';
import { buildIdempotencyKey, runIdempotent } from '../src/lib/idempotency.js';
import { mountApp } from '../src/app/app.js';

const ADMIN_EMAIL = 'ethoppaofficial@gmail.com';
const ADMIN_PASS = 'admin@2026';
const LEARNER_EMAIL = 'maya.lin@example.com';
const LEARNER_PASS = 'password123';

/** @typedef {import('../src/types/kord.d.ts').AppSupabaseClient} AppSupabaseClient */
/** @typedef {import('../src/types/kord.d.ts').AuthService} AuthService */
/** @typedef {import('../src/types/kord.d.ts').SupabaseAuthSessionLike} SupabaseAuthSessionLike */

/** @type {ReturnType<typeof installDomHarness> | null} */
let harness = null;
/** @type {Array<ReturnType<typeof mountApp>>} */
const mountedApps = [];

function createIsolatedSessionStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    /** @param {string} key */
    getItem(key) {
      return map.get(key) ?? null;
    },
    /**
     * @param {string} key
     * @param {string} value
     */
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    /** @param {string} key */
    removeItem(key) {
      map.delete(key);
    },
  };
}

/** @param {ReturnType<typeof createIsolatedSessionStorage>} tabStorage */
function createTabAuthService(tabStorage) {
  return createAuthService({
    isDemo: true,
    demoStore: {
      getDemoState,
      updateDemoState,
      subscribeDemoState,
      getDemoCurrentUserId() {
        return tabStorage.getItem('kord_current_user_id') || null;
      },
      /** @param {string | null} userId */
      setDemoCurrentUserId(userId) {
        if (userId) tabStorage.setItem('kord_current_user_id', String(userId));
        else tabStorage.removeItem('kord_current_user_id');
      },
    },
  });
}

function resetLocation(pathname = '/') {
  window.location.pathname = pathname;
  window.location.search = '';
  window.location.hash = '';
}

/** @param {{ auth?: AuthService }} [options] */
function mountTestApp(options = {}) {
  assert.ok(harness, 'DOM harness installed');
  const rootEl = harness.createRoot();
  const ctrl = mountApp(/** @type {HTMLElement} */ (/** @type {unknown} */ (rootEl)), options);
  mountedApps.push(ctrl);
  return { rootEl, ctrl };
}

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  // Pre-seed timezone cache so dashboard/admin greeting renders deterministically offline
  globalThis.sessionStorage.setItem(
    'kord_ip_tz_v1',
    JSON.stringify({ timezone: 'UTC', cachedAt: Date.now() })
  );
  resetDemoState();
  resetLocation('/');
  harness = installDomHarness();
});

afterEach(() => {
  while (mountedApps.length > 0) {
    mountedApps.pop()?.destroy();
  }
  harness?.cleanup();
  harness = null;
});

test('Scenario 1: Administrator logs in normally and accesses Admin Console only', async () => {
  resetLocation('/login');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  const form = rootEl.querySelector('#login-form');
  const emailInput = rootEl.querySelector('#login-email');
  const passwordInput = rootEl.querySelector('#login-password');
  assert.ok(form && emailInput && passwordInput, 'Login form rendered');
  emailInput.value = ADMIN_EMAIL;
  passwordInput.value = ADMIN_PASS;
  await form.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/admin');
  assert.ok(rootEl.innerHTML.includes('Administrator console'));
  assert.ok(rootEl.innerHTML.includes('Pending reviews'));
  assert.ok(!rootEl.innerHTML.includes('href="/explore"'), 'Admin nav must not include learner Explore link');
  assert.equal(getDemoCurrentUserId(), 'user-admin-ethoppa');
  const rawPersisted = globalThis.localStorage.getItem('kord_app_state_v5');
  assert.ok(rawPersisted);
  const persistedShared = JSON.parse(rawPersisted);
  assert.equal(
    Object.prototype.hasOwnProperty.call(persistedShared, 'currentUserId'),
    false,
    'localStorage shared state must not store currentUserId'
  );
});

test('Scenario 2: Learner logs in normally and accesses Learner Dashboard', async () => {
  resetLocation('/login');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  const form = rootEl.querySelector('#login-form');
  const emailInput = rootEl.querySelector('#login-email');
  const passwordInput = rootEl.querySelector('#login-password');
  assert.ok(form && emailInput && passwordInput, 'Login form rendered');
  emailInput.value = LEARNER_EMAIL;
  passwordInput.value = LEARNER_PASS;
  await form.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/dashboard');
  assert.ok(rootEl.innerHTML.includes('1. Learning'));
  assert.ok(rootEl.innerHTML.includes('href="/explore"'));
  assert.ok(!rootEl.innerHTML.includes('href="/admin"'), 'Learner nav must not include Admin link');
  assert.equal(getDemoCurrentUserId(), 'user-learner-maya');
});

test('Scenario 3: Administrator opening learner-only routes is strictly blocked', async () => {
  await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASS });

  for (const learnerPath of [
    '/explore',
    '/dashboard',
    '/skills',
    '/opportunities',
    '/courses/frontend-development-foundations',
  ]) {
    resetLocation(learnerPath);
    const { rootEl, ctrl } = mountTestApp();
    await ctrl.ready;
    assert.ok(
      rootEl.innerHTML.includes('Administrator workspace isolation'),
      `Expected isolation block on ${learnerPath}`
    );
    assert.ok(!rootEl.innerHTML.includes('1. Learning'), 'Learner dashboard content must never render for admin');
    assert.ok(!rootEl.innerHTML.includes('href="/explore"'), 'Learner nav must never render for admin');
    ctrl.destroy();
  }
});

test('Scenario 4: Learner opening administrator-only routes is strictly blocked', async () => {
  await signIn({ email: LEARNER_EMAIL, password: LEARNER_PASS });

  for (const adminPath of [
    '/admin',
    '/admin/submissions',
    '/admin/content',
    '/admin/quizzes',
    '/admin/opportunities',
  ]) {
    resetLocation(adminPath);
    const { rootEl, ctrl } = mountTestApp();
    await ctrl.ready;
    assert.ok(
      rootEl.innerHTML.includes('Administrator access required'),
      `Expected admin block on ${adminPath}`
    );
    assert.ok(!rootEl.innerHTML.includes('Administrator console'), 'Admin console must never render for learner');
    ctrl.destroy();
  }
});

test('Per-Tab Isolation: Admin in Tab 1 and Learner in Tab 2 stay logged in simultaneously, keep accounts on refresh, and Tab 2 sign-out leaves Tab 1 logged in', async () => {
  const tab1Storage = createIsolatedSessionStorage();
  const tab2Storage = createIsolatedSessionStorage();
  const tab1Auth = createTabAuthService(tab1Storage);
  const tab2Auth = createTabAuthService(tab2Storage);

  // Tab 1 logs in as Admin
  const adminSession = await tab1Auth.signIn({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  assert.ok(adminSession);
  assert.equal(adminSession.user.role, 'admin');

  // Tab 2 logs in as Learner concurrently (same localStorage, distinct sessionStorage)
  const learnerSession = await tab2Auth.signIn({ email: LEARNER_EMAIL, password: LEARNER_PASS });
  assert.ok(learnerSession);
  assert.equal(learnerSession.user.role, 'learner');

  // Both tabs remain authenticated as their respective accounts
  assert.equal((await tab1Auth.getCurrentSession())?.user?.role, 'admin');
  assert.equal((await tab2Auth.getCurrentSession())?.user?.role, 'learner');
  assert.equal(tab1Storage.getItem('kord_current_user_id'), adminSession.user.id);
  assert.equal(tab2Storage.getItem('kord_current_user_id'), learnerSession.user.id);

  // Render Tab 1 as Admin and verify Admin Console renders
  resetLocation('/admin');
  const tab1Mount = mountTestApp({ auth: tab1Auth });
  await tab1Mount.ctrl.ready;
  assert.ok(tab1Mount.rootEl.innerHTML.includes('Administrator console'));

  // Render Tab 2 as Learner and verify Learner Dashboard renders
  resetLocation('/dashboard');
  const tab2Mount = mountTestApp({ auth: tab2Auth });
  await tab2Mount.ctrl.ready;
  assert.ok(tab2Mount.rootEl.innerHTML.includes('1. Learning'));

  // Refreshing Tab 1 retains Admin; refreshing Tab 2 retains Learner
  tab1Mount.ctrl.destroy();
  tab2Mount.ctrl.destroy();
  resetLocation('/admin');
  const tab1Refreshed = mountTestApp({ auth: tab1Auth });
  await tab1Refreshed.ctrl.ready;
  assert.ok(tab1Refreshed.rootEl.innerHTML.includes('Administrator console'));

  resetLocation('/dashboard');
  const tab2Refreshed = mountTestApp({ auth: tab2Auth });
  await tab2Refreshed.ctrl.ready;
  assert.ok(tab2Refreshed.rootEl.innerHTML.includes('1. Learning'));

  // Signing out in Tab 2 clears only Tab 2's session; Tab 1 remains Admin
  await tab2Auth.signOut();
  assert.equal(await tab2Auth.getCurrentSession(), null);
  assert.equal(tab2Storage.getItem('kord_current_user_id'), null);
  assert.equal((await tab1Auth.getCurrentSession())?.user?.role, 'admin');
  assert.equal(tab1Storage.getItem('kord_current_user_id'), adminSession.user.id);
});

test('Shared Demo Data Sync: Learner submission saved in Tab 2 appears in Admin Tab 1 after refresh without breaking Admin session', async () => {
  const tab1Storage = createIsolatedSessionStorage();
  const tab2Storage = createIsolatedSessionStorage();
  const tab1Auth = createTabAuthService(tab1Storage);
  const tab2Auth = createTabAuthService(tab2Storage);

  const adminSession = await tab1Auth.signIn({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const learnerSession = await tab2Auth.signIn({ email: LEARNER_EMAIL, password: LEARNER_PASS });
  assert.ok(adminSession && learnerSession);

  // Learner enrolls and submits challenge evidence (sync active user for progress/submission guards)
  setDemoCurrentUserId(learnerSession.user.id);
  const course = await getCourseBySlug('frontend-development-foundations');
  assert.ok(course);
  await enrollInCourse(learnerSession.user.id, course.id);
  const challenge = getDemoState().challenges.find((c) => c.courseId === course.id);
  assert.ok(challenge, 'Frontend course challenge exists');
  const challengeId = challenge.id;
  const explanationText = 'Submitted refactored HTML structure with accessible landmarks and responsive grid.';
  await submitChallengeEvidence({
    userId: learnerSession.user.id,
    challengeId,
    courseId: course.id,
    explanation: explanationText,
    evidenceUrl: 'https://example.com/portfolio',
  });

  // Switch active global test session back to Admin's isolated storage & simulate shared storage refresh in Tab 1
  setDemoCurrentUserId(adminSession.user.id);
  syncDemoStateFromStorage({ emit: false, forceEmit: true });

  resetLocation('/admin/submissions');
  const { rootEl, ctrl } = mountTestApp({ auth: tab1Auth });
  await ctrl.ready;

  assert.equal((await tab1Auth.getCurrentSession())?.user?.role, 'admin');
  assert.ok(rootEl.innerHTML.includes('Administrator console'));
  assert.ok(
    rootEl.innerHTML.includes(explanationText),
    'Learner submission from shared localStorage should appear in Admin review queue after refresh'
  );
});

test('Supabase Auth Configuration uses sessionStorage with storageKey kord-auth and clean lifecycle', async () => {
  const supaSrc = fs.readFileSync(path.resolve('src/lib/supabase.js'), 'utf8');
  assert.match(supaSrc, /storage:\s*typeof window !== 'undefined' \? window\.sessionStorage : undefined/);
  assert.match(supaSrc, /storageKey:\s*['"]kord-auth['"]/);
  assert.match(supaSrc, /persistSession:\s*true/);
  assert.match(supaSrc, /autoRefreshToken:\s*true/);

  // Verify idempotency & module cleanup helper still works on explicit signOut
  let cleaned = false;
  const unreg = registerSessionCleanup(() => {
    cleaned = true;
  });
  const key = buildIdempotencyKey('k', 'a');
  let count = 0;
  await runIdempotent(key, async () => ++count, { cacheResult: true });
  await signOut();
  assert.equal(cleaned, true);
  await runIdempotent(key, async () => ++count, { cacheResult: true });
  assert.equal(count, 2);
  unreg();
  runSessionCleanup();
});

test('Logging out clears protected DOM and blocks subsequent navigation or popstate back-navigation', async () => {
  await signIn({ email: LEARNER_EMAIL, password: LEARNER_PASS });
  resetLocation('/dashboard');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  assert.ok(rootEl.innerHTML.includes('1. Learning'));

  const signOutBtn = rootEl.querySelector('[data-sign-out]');
  assert.ok(signOutBtn, 'Sign out button present');
  await signOutBtn.click();
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/login');
  assert.equal(getDemoCurrentUserId(), null);
  assert.ok(rootEl.innerHTML.includes('Sign in to Kord'));
  assert.ok(!rootEl.innerHTML.includes('1. Learning'));

  window.location.pathname = '/dashboard';
  await window.dispatchEvent(/** @type {Event} */ (/** @type {unknown} */ ({ type: 'popstate' })));
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/login');
  assert.ok(rootEl.innerHTML.includes('Sign in to Kord'));
  assert.ok(!rootEl.innerHTML.includes('1. Learning'), 'Protected content must remain inaccessible after logout');
});

test('Password reset request and PASSWORD_RECOVERY update flow continue working cleanly', async () => {
  const res = await requestPasswordReset(LEARNER_EMAIL);
  assert.equal(res.sent, true);

  /** @type {{ cb: ((event: string, session: SupabaseAuthSessionLike | null) => void) | null }} */
  const authListener = { cb: null };
  /** @type {string | null} */
  let currentPassUpdatedTo = null;
  const recoveryUser = {
    id: 'supa-learner-2',
    email: 'ada@kord.app',
    user_metadata: { first_name: 'Ada', full_name: 'Ada Lovelace' },
  };
  const mockSupabase = {
    auth: {
      async getSession() {
        return { data: { session: { user: recoveryUser } }, error: null };
      },
      /** @param {(event: string, session: SupabaseAuthSessionLike | null) => void} cb */
      onAuthStateChange(cb) {
        authListener.cb = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      /** @param {{ password?: string }} attrs */
      async updateUser({ password }) {
        currentPassUpdatedTo = password ?? null;
        return { data: { user: recoveryUser }, error: null };
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  return {
                    data: {
                      id: 'supa-learner-2',
                      email: 'ada@kord.app',
                      first_name: 'Ada',
                      full_name: 'Ada Lovelace',
                      role: 'learner',
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const supaAuth = createAuthService({
    supabaseClient: /** @type {AppSupabaseClient} */ (/** @type {unknown} */ (mockSupabase)),
    isDemo: false,
  });
  resetLocation('/login');
  const { rootEl, ctrl } = mountTestApp({ auth: supaAuth });
  await ctrl.ready;

  assert.ok(authListener.cb);
  authListener.cb('PASSWORD_RECOVERY', { user: recoveryUser });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/reset-password');
  assert.ok(rootEl.innerHTML.includes('Set a new password'));

  const resetForm = rootEl.querySelector('#update-password-form');
  const newPassInput = rootEl.querySelector('#new-password');
  const confirmPassInput = rootEl.querySelector('#confirm-new-password');
  assert.ok(resetForm && newPassInput && confirmPassInput);
  newPassInput.value = 'newSecurePass99';
  confirmPassInput.value = 'newSecurePass99';
  await resetForm.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.equal(currentPassUpdatedTo, 'newSecurePass99');
  assert.ok(rootEl.querySelector('#reset-password-success'));
  const continueBtn = rootEl.querySelector('#reset-continue-workspace');
  assert.ok(continueBtn);
  await continueBtn.click();
  await flushMicrotasks();
  assert.equal(window.location.pathname, '/dashboard');

  ctrl.destroy();
  await signOut();
  assert.equal(await getCurrentSession(), null);
});

test('Dashboard Cleanup: Unenrolled learner sees no Available Flagship Courses card, while enrolled learner sees active courses', async () => {
  const session = await signIn({ email: LEARNER_EMAIL, password: LEARNER_PASS });
  assert.ok(session);

  // 1. Unenrolled learner dashboard
  resetLocation('/dashboard');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  assert.ok(rootEl.innerHTML.includes('1. Learning'));
  assert.ok(rootEl.innerHTML.includes('Weekly learning minutes'));
  assert.ok(
    !rootEl.innerHTML.includes('Available Flagship Courses'),
    'Dashboard must not render Available Flagship Courses card when learner has no enrolled courses'
  );
  assert.ok(
    !rootEl.innerHTML.includes('course-catalog-grid'),
    'Dashboard must not render course catalog grid'
  );
  ctrl.destroy();

  // 2. Enroll learner in a course and re-render dashboard
  const course = await getCourseBySlug('frontend-development-foundations');
  assert.ok(course);
  await enrollInCourse(session.user.id, course.id);

  resetLocation('/dashboard');
  const enrolledMount = mountTestApp();
  await enrolledMount.ctrl.ready;

  assert.ok(
    enrolledMount.rootEl.innerHTML.includes('Your active &amp; completed courses'),
    'Dashboard must still show Your active & completed courses for enrolled learners'
  );
  assert.ok(enrolledMount.rootEl.innerHTML.includes(course.title));
});

test('Auth Pages: Password fields allow users to view and hide passwords across login, signup, and reset forms', async () => {
  // 1. Login page
  resetLocation('/login');
  const loginMount = mountTestApp();
  await loginMount.ctrl.ready;

  const loginInput = loginMount.rootEl.querySelector('#login-password');
  const loginToggle = loginMount.rootEl.querySelector('[data-password-toggle="login-password"]');
  assert.ok(loginInput && loginToggle, 'Login password input and toggle exist');
  assert.equal(loginInput.getAttribute('type'), 'password');
  assert.equal(loginToggle.getAttribute('aria-pressed'), 'false');

  await loginToggle.click();
  assert.equal(loginInput.getAttribute('type'), 'text');
  assert.equal(loginToggle.getAttribute('aria-pressed'), 'true');
  assert.equal(loginToggle.getAttribute('aria-label'), 'Hide password');

  await loginToggle.click();
  assert.equal(loginInput.getAttribute('type'), 'password');
  assert.equal(loginToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(loginToggle.getAttribute('aria-label'), 'Show password');
  loginMount.ctrl.destroy();

  // 2. Sign up page (both password and confirm password)
  resetLocation('/signup');
  const signupMount = mountTestApp();
  await signupMount.ctrl.ready;

  for (const fieldId of ['signup-password', 'signup-confirm']) {
    const input = signupMount.rootEl.querySelector(`#${fieldId}`);
    const toggle = signupMount.rootEl.querySelector(`[data-password-toggle="${fieldId}"]`);
    assert.ok(input && toggle, `Signup toggle exists for ${fieldId}`);
    assert.equal(input.getAttribute('type'), 'password');
    await toggle.click();
    assert.equal(input.getAttribute('type'), 'text');
    await toggle.click();
    assert.equal(input.getAttribute('type'), 'password');
  }
  signupMount.ctrl.destroy();

  // 3. Reset password page (new password and confirm new password)
  await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  resetLocation('/reset-password');
  const resetMount = mountTestApp();
  await resetMount.ctrl.ready;

  for (const fieldId of ['new-password', 'confirm-new-password']) {
    const input = resetMount.rootEl.querySelector(`#${fieldId}`);
    const toggle = resetMount.rootEl.querySelector(`[data-password-toggle="${fieldId}"]`);
    assert.ok(input && toggle, `Reset password toggle exists for ${fieldId}`);
    assert.equal(input.getAttribute('type'), 'password');
    await toggle.click();
    assert.equal(input.getAttribute('type'), 'text');
    await toggle.click();
    assert.equal(input.getAttribute('type'), 'password');
  }
  resetMount.ctrl.destroy();
});

