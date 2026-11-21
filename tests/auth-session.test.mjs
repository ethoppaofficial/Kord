import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomHarness, flushMicrotasks } from './helpers/domHarness.mjs';
import {
  resetDemoState,
  getDemoState,
  updateDemoState,
} from '../src/lib/demo/demoStore.js';
import {
  createAuthService,
  signIn,
  signOut,
  requestPasswordReset,
  getCurrentSession,
} from '../src/lib/repositories/authRepository.js';
import { registerSessionCleanup } from '../src/lib/sessionLifecycle.js';
import { buildIdempotencyKey, runIdempotent } from '../src/lib/idempotency.js';
import { mountApp } from '../src/app/app.js';

const ADMIN_EMAIL = 'ethoppaofficial@gmail.com';
const ADMIN_PASS = 'admin@2026';
const LEARNER_EMAIL = 'maya.lin@example.com';
const LEARNER_PASS = 'password123';

let harness = null;
const mountedApps = [];

function resetLocation(pathname = '/') {
  window.location.pathname = pathname;
  window.location.search = '';
  window.location.hash = '';
}

function mountTestApp(options = {}) {
  const rootEl = harness.createRoot();
  const ctrl = mountApp(rootEl, options);
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
    mountedApps.pop().destroy();
  }
  harness?.cleanup();
  harness = null;
});

test('Scenario 1: Administrator logs in normally and accesses Admin Console only', async () => {
  resetLocation('/login');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  const form = rootEl.querySelector('#login-form');
  assert.ok(form, 'Login form rendered');
  rootEl.querySelector('#login-email').value = ADMIN_EMAIL;
  rootEl.querySelector('#login-password').value = ADMIN_PASS;
  await form.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/admin');
  assert.ok(rootEl.innerHTML.includes('Administrator console'));
  assert.ok(rootEl.innerHTML.includes('Pending reviews'));
  assert.ok(!rootEl.innerHTML.includes('href="/explore"'), 'Admin nav must not include learner Explore link');
});

test('Scenario 2: Learner logs in normally and accesses Learner Dashboard', async () => {
  resetLocation('/login');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  const form = rootEl.querySelector('#login-form');
  rootEl.querySelector('#login-email').value = LEARNER_EMAIL;
  rootEl.querySelector('#login-password').value = LEARNER_PASS;
  await form.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/dashboard');
  assert.ok(rootEl.innerHTML.includes('1. Learning'));
  assert.ok(rootEl.innerHTML.includes('href="/explore"'));
  assert.ok(!rootEl.innerHTML.includes('href="/admin"'), 'Learner nav must not include Admin link');
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

test('Scenario 5 & 6 (Demo Storage Sync): Second account logging in from another tab notifies Tab 1, clears caches, and updates UI cleanly', async () => {
  await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  resetLocation('/admin');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  assert.ok(rootEl.innerHTML.includes('Administrator console'));

  let staleUiStateCleared = false;
  const unregister = registerSessionCleanup(() => {
    staleUiStateCleared = true;
  });
  const idemKey = buildIdempotencyKey('test-tab-switch', 'admin-action');
  let callCount = 0;
  await runIdempotent(
    idemKey,
    async () => {
      callCount += 1;
      return 'admin-cached-result';
    },
    { cacheResult: true }
  );

  // Simulate Tab 2 logging in as Learner by updating shared localStorage and firing browser 'storage' event
  const raw = JSON.parse(globalThis.localStorage.getItem('kord_app_state_v5'));
  const learnerUser = raw.users.find((u) => u.role === 'learner');
  assert.ok(learnerUser);
  raw.currentUserId = learnerUser.id;
  globalThis.localStorage.setItem('kord_app_state_v5', JSON.stringify(raw));

  window.dispatchEvent({
    type: 'storage',
    key: 'kord_app_state_v5',
    newValue: JSON.stringify(raw),
  });
  await flushMicrotasks();

  assert.equal(staleUiStateCleared, true, 'Module-level UI caches must clear on cross-tab account change');
  assert.equal(window.location.pathname, '/dashboard');
  assert.ok(rootEl.innerHTML.includes('1. Learning'));
  assert.ok(!rootEl.innerHTML.includes('Administrator console'), 'Stale admin UI must be removed');
  assert.ok(
    harness.document.querySelector('.toast')?.textContent.includes('Active account changed in another tab'),
    'User should see session-change toast'
  );

  await runIdempotent(
    idemKey,
    async () => {
      callCount += 1;
      return 'fresh-result';
    },
    { cacheResult: true }
  );
  assert.equal(callCount, 2, 'Idempotency cache must reset across account switch');
  unregister();
});

test('Scenario 5 & 6 (Supabase onAuthStateChange Sync): Cross-tab Supabase SIGNED_IN and SIGNED_OUT events update Tab 1 without deadlock or stale role', async () => {
  let authCallback = null;
  let activeAuthUser = {
    id: 'supa-admin-1',
    email: ADMIN_EMAIL,
    user_metadata: { first_name: 'Admin', full_name: 'Kord Admin', role: 'learner' }, // tampered metadata ignored
  };
  const profilesById = {
    'supa-admin-1': {
      id: 'supa-admin-1',
      email: ADMIN_EMAIL,
      first_name: 'Admin',
      full_name: 'Kord Admin',
      role: 'admin',
    },
    'supa-learner-2': {
      id: 'supa-learner-2',
      email: 'ada@kord.app',
      first_name: 'Ada',
      full_name: 'Ada Lovelace',
      role: 'learner',
    },
  };

  const mockSupabase = {
    auth: {
      async getSession() {
        return { data: { session: activeAuthUser ? { user: activeAuthUser } : null }, error: null };
      },
      onAuthStateChange(cb) {
        authCallback = cb;
        return { data: { subscription: { unsubscribe() { authCallback = null; } } } };
      },
      async signOut() {
        activeAuthUser = null;
        authCallback?.('SIGNED_OUT', null);
      },
    },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() {
          return {
            eq(_col, id) {
              return {
                async single() {
                  const row = profilesById[id];
                  return row
                    ? { data: row, error: null }
                    : { data: null, error: { code: 'PGRST116', message: 'Not found' } };
                },
              };
            },
          };
        },
      };
    },
  };

  const supaAuth = createAuthService({ supabaseClient: mockSupabase, isDemo: false });
  resetLocation('/admin/content');
  const { rootEl, ctrl } = mountTestApp({ auth: supaAuth });
  await ctrl.ready;

  assert.equal(window.location.pathname, '/admin/content');
  assert.ok(rootEl.innerHTML.includes('Administrator console'));

  // Tab 2 signs in as Learner via Supabase -> fires onAuthStateChange('SIGNED_IN', learnerSession)
  activeAuthUser = {
    id: 'supa-learner-2',
    email: 'ada@kord.app',
    user_metadata: { first_name: 'Ada', full_name: 'Ada Lovelace', role: 'admin' }, // tampered metadata ignored
  };
  authCallback('SIGNED_IN', { user: activeAuthUser });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/dashboard');
  assert.ok(rootEl.innerHTML.includes('Good '), 'Learner dashboard greeting rendered');
  assert.ok(rootEl.innerHTML.includes('Ada'), 'New learner name rendered');
  assert.ok(!rootEl.innerHTML.includes('Administrator console'), 'Admin console must not remain visible');

  // Tab 2 signs out -> fires onAuthStateChange('SIGNED_OUT', null)
  activeAuthUser = null;
  authCallback('SIGNED_OUT', null);
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/login');
  assert.ok(rootEl.innerHTML.includes('Sign in to Kord'));
  assert.ok(!rootEl.innerHTML.includes('Ada'), 'Previous learner name cleared on sign-out');
});

test('Scenario 6b (Focus Sync): Tab regaining focus detects background storage session change and blocks stale actions', async () => {
  await signIn({ email: LEARNER_EMAIL, password: LEARNER_PASS });
  resetLocation('/dashboard');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  assert.ok(rootEl.innerHTML.includes('Maya'));

  // Simulate another tab clearing session without firing storage event yet (e.g. throttled background tab)
  const raw = JSON.parse(globalThis.localStorage.getItem('kord_app_state_v5'));
  raw.currentUserId = null;
  globalThis.localStorage.setItem('kord_app_state_v5', JSON.stringify(raw));

  window.dispatchEvent({ type: 'focus' });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/login');
  assert.ok(rootEl.innerHTML.includes('Sign in to Kord'));
  assert.ok(!rootEl.innerHTML.includes('1. Learning'));
});

test('Scenario 7: Refreshing either tab reads current persisted session and never displays stale account info', async () => {
  await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialSession = await getCurrentSession();
  assert.equal(initialSession.user.role, 'admin');

  // Switch active user to Learner in shared storage (simulating Tab 2)
  const learner = getDemoState().users.find((u) => u.role === 'learner');
  updateDemoState((draft) => {
    draft.currentUserId = learner.id;
    return draft;
  });

  // Simulate refreshing Tab 1 while its URL was previously /admin
  resetLocation('/admin');
  const { rootEl, ctrl } = mountTestApp();
  await ctrl.ready;

  assert.ok(
    rootEl.innerHTML.includes('Administrator access required'),
    'Refreshed /admin tab under learner session must immediately deny admin access'
  );
  assert.ok(!rootEl.innerHTML.includes('Administrator console'));
});

test('Scenario 8: Logging out clears protected DOM and blocks subsequent navigation or popstate back-navigation', async () => {
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
  assert.ok(rootEl.innerHTML.includes('Sign in to Kord'));
  assert.ok(!rootEl.innerHTML.includes('1. Learning'));

  // Simulate browser Back button (popstate) back to /dashboard after logout
  window.location.pathname = '/dashboard';
  await window.dispatchEvent({ type: 'popstate' });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/login');
  assert.ok(rootEl.innerHTML.includes('Sign in to Kord'));
  assert.ok(!rootEl.innerHTML.includes('1. Learning'), 'Protected content must remain inaccessible after logout');
});

test('Scenario 9: Password reset request and PASSWORD_RECOVERY update flow continue working cleanly', async () => {
  const res = await requestPasswordReset(LEARNER_EMAIL);
  assert.equal(res.sent, true);

  let authCallback = null;
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
      onAuthStateChange(cb) {
        authCallback = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async updateUser({ password }) {
        currentPassUpdatedTo = password;
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

  const supaAuth = createAuthService({ supabaseClient: mockSupabase, isDemo: false });
  resetLocation('/login');
  const { rootEl, ctrl } = mountTestApp({ auth: supaAuth });
  await ctrl.ready;

  authCallback('PASSWORD_RECOVERY', { user: recoveryUser });
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/reset-password');
  assert.ok(rootEl.innerHTML.includes('Set a new password'));

  const resetForm = rootEl.querySelector('#update-password-form');
  rootEl.querySelector('#new-password').value = 'newSecurePass99';
  rootEl.querySelector('#confirm-new-password').value = 'newSecurePass99';
  await resetForm.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.equal(currentPassUpdatedTo, 'newSecurePass99');
  assert.equal(window.location.pathname, '/dashboard');

  ctrl.destroy();
  await signOut();
  assert.equal(await getCurrentSession(), null);
});
