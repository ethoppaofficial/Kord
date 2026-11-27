import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomHarness, flushMicrotasks } from './helpers/domHarness.mjs';
import { resetDemoState } from '../src/lib/demo/demoStore.js';
import {
  normalizeApprovedOrigin,
  resolveAuthRedirectUrl,
} from '../src/lib/supabase.js';
import { createAuthService } from '../src/lib/repositories/authRepository.js';
import { mountApp } from '../src/app/app.js';

/** @typedef {import('../src/types/kord.d.ts').AppSupabaseClient} AppSupabaseClient */
/** @typedef {import('../src/types/kord.d.ts').SupabaseAuthUserLike} SupabaseAuthUserLike */
/** @typedef {import('../src/types/kord.d.ts').SupabaseAuthSessionLike} SupabaseAuthSessionLike */

/** @type {ReturnType<typeof installDomHarness> | null} */
let harness = null;
/** @type {Array<ReturnType<typeof mountApp>>} */
const mountedApps = [];

/**
 * @param {string} fullPath
 * @param {string} [origin]
 */
function setUrl(fullPath, origin = 'http://localhost:3000') {
  const [pathPart, hashPart = ''] = fullPath.split('#');
  const [pathname, search = ''] = pathPart.split('?');
  /** @type {{ origin: string }} */ (/** @type {unknown} */ (window.location)).origin = origin;
  window.location.pathname = pathname || '/';
  window.location.search = search ? `?${search}` : '';
  window.location.hash = hashPart ? `#${hashPart}` : '';
}

/**
 * @typedef {{ provider: string; options: { redirectTo?: string; queryParams?: Record<string, string> } }} OAuthCallParams
 * @typedef {{ data: { session: SupabaseAuthSessionLike | null }; error: { message: string } | null }} ExchangeResultShape
 * @typedef {{ data: { url?: string | null; provider?: string } | null; error: { message: string } | null }} OAuthResultShape
 * @param {{
 *   initialSessionUser?: SupabaseAuthUserLike | null;
 *   oauthResult?: ((params: OAuthCallParams) => OAuthResultShape | Promise<OAuthResultShape>) | OAuthResultShape | null;
 *   exchangeResult?: ((code: string, options?: unknown) => ExchangeResultShape | Promise<ExchangeResultShape>) | ExchangeResultShape | null;
 *   role?: string;
 *   accountStatus?: string;
 *   profileExists?: boolean;
 * }} [opts]
 */
function createMockSupabaseForOAuth({
  initialSessionUser = null,
  oauthResult = null,
  exchangeResult = null,
  role = 'learner',
  accountStatus = 'active',
  profileExists = true,
} = {}) {
  /** @type {SupabaseAuthUserLike | null} */
  let activeUser = initialSessionUser;
  /** @type {OAuthCallParams[]} */
  const oauthCalls = [];
  /** @type {Array<{ code: string; options?: unknown }>} */
  const exchangeCalls = [];
  let signOutCount = 0;

  const client = {
    auth: {
      async getSession() {
        return {
          data: { session: activeUser ? { user: activeUser } : null },
          error: null,
        };
      },
      /** @param {OAuthCallParams} params */
      async signInWithOAuth(params) {
        oauthCalls.push(params);
        if (typeof oauthResult === 'function') {
          return oauthResult(params);
        }
        return (
          oauthResult || {
            data: {
              provider: params.provider,
              url: `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(params.options?.redirectTo || '')}`,
            },
            error: null,
          }
        );
      },
      /**
       * @param {string} code
       * @param {unknown} [options]
       */
      async exchangeCodeForSession(code, options) {
        exchangeCalls.push({ code, options });
        const res =
          typeof exchangeResult === 'function'
            ? await exchangeResult(code, options)
            : exchangeResult;
        if (res?.data?.session?.user) {
          activeUser = res.data.session.user;
        }
        return res || { data: { session: null }, error: { message: 'Invalid OAuth code' } };
      },
      async signOut() {
        signOutCount += 1;
        activeUser = null;
        return { error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  if (!activeUser || !profileExists) {
                    return { data: null, error: { message: 'No rows' } };
                  }
                  return {
                    data: {
                      id: activeUser.id,
                      email: activeUser.email,
                      first_name: activeUser.user_metadata?.first_name || '',
                      full_name: activeUser.user_metadata?.full_name || '',
                      role,
                      account_status: accountStatus,
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

  return {
    client: /** @type {AppSupabaseClient} */ (/** @type {unknown} */ (client)),
    getOAuthCalls: () => oauthCalls,
    getExchangeCalls: () => exchangeCalls,
    getSignOutCount: () => signOutCount,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  globalThis.sessionStorage.setItem(
    'kord_ip_tz_v1',
    JSON.stringify({ timezone: 'UTC', cachedAt: Date.now() })
  );
  resetDemoState();
  setUrl('/');
  harness = installDomHarness();
});

afterEach(() => {
  while (mountedApps.length > 0) {
    mountedApps.pop()?.destroy();
  }
  harness?.cleanup();
  harness = null;
  setUrl('/');
});

test('Explicit environment-aware redirect resolver allows approved origins and rejects untrusted inputs', () => {
  assert.equal(normalizeApprovedOrigin('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(normalizeApprovedOrigin('javascript:alert(1)'), null);
  assert.equal(normalizeApprovedOrigin('http://evil.example.com'), null);
  assert.equal(normalizeApprovedOrigin('https://user:pass@example.com'), null);
  assert.equal(normalizeApprovedOrigin('https://example.com/extra-path'), null);

  // Local development origin
  assert.equal(
    resolveAuthRedirectUrl('/reset-password', { currentOrigin: 'http://localhost:3000', env: {} }),
    'http://localhost:3000/reset-password'
  );
  // Approved AI Studio preview origin
  assert.equal(
    resolveAuthRedirectUrl('/auth/callback', {
      currentOrigin: 'https://ais-dev-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app',
      env: {},
    }),
    'https://ais-dev-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app/auth/callback'
  );

  // Confirmed production origin (https://kord-lcec.vercel.app) without explicit VITE_SITE_URL
  assert.equal(
    resolveAuthRedirectUrl('/auth/callback', {
      currentOrigin: 'https://kord-lcec.vercel.app',
      env: { PROD: true },
    }),
    'https://kord-lcec.vercel.app/auth/callback'
  );
  assert.equal(
    resolveAuthRedirectUrl('/reset-password', {
      currentOrigin: 'https://kord-lcec.vercel.app',
      env: { PROD: true },
    }),
    'https://kord-lcec.vercel.app/reset-password'
  );
  assert.equal(
    resolveAuthRedirectUrl('/auth/callback', {
      currentOrigin: '',
      env: { PROD: true },
    }),
    'https://kord-lcec.vercel.app/auth/callback'
  );
  assert.equal(
    resolveAuthRedirectUrl('/reset-password', {
      currentOrigin: 'https://attacker.example.com',
      env: { PROD: true },
    }),
    'https://kord-lcec.vercel.app/reset-password'
  );

  // Explicitly configured VITE_SITE_URL takes precedence over DEFAULT_PRODUCTION_ORIGIN
  assert.equal(
    resolveAuthRedirectUrl('/auth/callback', {
      currentOrigin: 'https://kord-lcec.vercel.app',
      env: { VITE_SITE_URL: 'https://kord.example.org', PROD: true },
    }),
    'https://kord.example.org/auth/callback'
  );
  assert.equal(
    resolveAuthRedirectUrl('/reset-password', {
      currentOrigin: 'https://attacker.example.com',
      env: { VITE_SITE_URL: 'https://kord.example.org', PROD: true },
    }),
    'https://kord.example.org/reset-password'
  );

  // Untrusted origin in non-prod without VITE_SITE_URL falls back to localhost
  assert.equal(
    resolveAuthRedirectUrl('/reset-password', {
      currentOrigin: 'https://attacker.example.com',
      env: { PROD: false },
    }),
    'http://localhost:3000/reset-password'
  );

  assert.throws(
    () => resolveAuthRedirectUrl('https://attacker.example.com/phish'),
    /Unsupported authentication redirect path/
  );
});

test('Password recovery calls resetPasswordForEmail with allowlisted redirectTo and never leaks account existence', async () => {
  /** @type {Array<{ email: string; options?: { redirectTo?: string } }>} */
  const resetCalls = [];
  const auth = createAuthService({
    supabaseClient: /** @type {AppSupabaseClient} */ (/** @type {unknown} */ ({
      auth: {
        /**
         * @param {string} email
         * @param {{ redirectTo?: string }} [options]
         */
        async resetPasswordForEmail(email, options) {
          resetCalls.push({ email, options });
          return { data: {}, error: null };
        },
        onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    })),
    isDemo: false,
  });

  setUrl('/login?redirectTo=https://evil.example.com', 'http://localhost:3000');
  const knownRes = await auth.recoverPassword('maya.lin@example.com');
  const unknownRes = await auth.recoverPassword('nonexistent@example.com');

  assert.equal(resetCalls.length, 2);
  assert.equal(resetCalls[0].options?.redirectTo, 'http://localhost:3000/reset-password');
  assert.equal(knownRes.note, unknownRes.note);
  assert.match(knownRes.note, /If an account exists for that email/i);

  const demoAuth = createAuthService({ isDemo: true });
  const demoKnown = await demoAuth.recoverPassword('maya.lin@example.com');
  const demoUnknown = await demoAuth.recoverPassword('nobody@example.com');
  assert.equal(demoKnown.note, demoUnknown.note);
});

test('Continue with Google appears on both Sign In and Create Account pages, guards duplicate clicks, and handles errors', async () => {
  /** @type {((value: OAuthResultShape) => void) | undefined} */
  let resolveOAuth;
  let rejectNext = false;
  const mock = createMockSupabaseForOAuth({
    oauthResult() {
      if (rejectNext) {
        return { data: null, error: { message: 'Google provider disabled' } };
      }
      return new Promise((resolve) => {
        resolveOAuth = resolve;
      });
    },
  });

  const auth = createAuthService({ supabaseClient: mock.client, isDemo: false });
  assert.ok(harness, 'DOM harness installed');

  // 1. Login page Google button
  setUrl('/login', 'https://ais-pre-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app');
  const rootLogin = harness.createRoot();
  const loginApp = mountApp(/** @type {HTMLElement} */ (/** @type {unknown} */ (rootLogin)), { auth });
  mountedApps.push(loginApp);
  await loginApp.ready;

  const loginGoogleBtn = rootLogin.querySelector('#login-google-btn');
  assert.ok(loginGoogleBtn, 'Continue with Google button renders on /login');

  // Double-click fires signInWithOAuth only once
  const firstClick = loginGoogleBtn.click();
  await loginGoogleBtn.click();
  assert.equal(loginGoogleBtn.disabled, true);
  assert.equal(mock.getOAuthCalls().length, 1);
  assert.equal(mock.getOAuthCalls()[0].provider, 'google');
  assert.equal(
    mock.getOAuthCalls()[0].options.redirectTo,
    'https://ais-pre-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app/auth/callback'
  );
  assert.equal(mock.getOAuthCalls()[0].options.queryParams?.prompt, 'select_account');

  assert.ok(resolveOAuth);
  resolveOAuth({
    data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth' },
    error: null,
  });
  await firstClick;
  loginApp.destroy();

  // 2. Signup page Google button + error surfacing
  rejectNext = true;
  setUrl('/signup', 'http://localhost:3000');
  const rootSignup = harness.createRoot();
  const signupApp = mountApp(/** @type {HTMLElement} */ (/** @type {unknown} */ (rootSignup)), { auth });
  mountedApps.push(signupApp);
  await signupApp.ready;

  const signupGoogleBtn = rootSignup.querySelector('#signup-google-btn');
  const signupGoogleErr = rootSignup.querySelector('#signup-google-error');
  assert.ok(signupGoogleBtn && signupGoogleErr, 'Continue with Google button renders on /signup');

  await signupGoogleBtn.click();
  await flushMicrotasks();
  assert.equal(mock.getOAuthCalls().length, 2);
  assert.equal(
    mock.getOAuthCalls()[1].options.redirectTo,
    'http://localhost:3000/auth/callback'
  );
  assert.match(signupGoogleErr.textContent, /Google provider disabled/i);
  assert.equal(signupGoogleBtn.disabled, false);
});

test('/auth/callback exchanges Google PKCE code, hydrates Google metadata, strips URL params, and routes to /dashboard', async () => {
  const googleUser = {
    id: 'supa-google-1',
    email: 'grace@example.com',
    user_metadata: {
      given_name: 'Grace',
      name: 'Grace Hopper',
    },
  };
  const mock = createMockSupabaseForOAuth({
    exchangeResult: async () => ({
      data: { session: { user: googleUser } },
      error: null,
    }),
    role: 'learner',
  });
  const auth = createAuthService({ supabaseClient: mock.client, isDemo: false });
  assert.ok(harness, 'DOM harness installed');

  setUrl('/auth/callback?code=oauth-pkce-code-123&state=opaque-state-xyz');
  const rootEl = harness.createRoot();
  const ctrl = mountApp(/** @type {HTMLElement} */ (/** @type {unknown} */ (rootEl)), { auth });
  mountedApps.push(ctrl);
  await ctrl.ready;

  assert.equal(mock.getExchangeCalls().length, 1);
  assert.equal(mock.getExchangeCalls()[0].code, 'oauth-pkce-code-123');
  assert.equal(window.location.pathname, '/dashboard');
  assert.equal(window.location.search, '');
  assert.ok(rootEl.innerHTML.includes('Grace'), 'Dashboard greeting uses Google given_name');
});

test('/auth/callback handles cancelled OAuth, missing params, and suspended Google accounts safely', async () => {
  assert.ok(harness, 'DOM harness installed');

  // 1. Cancelled OAuth preserves an existing unrelated session and shows recovery links
  const existingUser = {
    id: 'supa-existing-1',
    email: 'ada@example.com',
    user_metadata: { first_name: 'Ada', full_name: 'Ada Lovelace' },
  };
  const cancelledMock = createMockSupabaseForOAuth({ initialSessionUser: existingUser });
  const cancelledAuth = createAuthService({ supabaseClient: cancelledMock.client, isDemo: false });

  setUrl('/auth/callback?error=access_denied&error_description=User+denied+access');
  const rootCancelled = harness.createRoot();
  const appCancelled = mountApp(/** @type {HTMLElement} */ (/** @type {unknown} */ (rootCancelled)), { auth: cancelledAuth });
  mountedApps.push(appCancelled);
  await appCancelled.ready;

  assert.equal(window.location.pathname, '/auth/callback');
  assert.equal(window.location.search, '');
  assert.ok(rootCancelled.querySelector('#oauth-callback-error-state'));
  assert.match(rootCancelled.innerHTML, /cancelled/i);
  assert.ok(rootCancelled.querySelector('#oauth-existing-workspace'));
  appCancelled.destroy();

  // 2. Missing callback without session renders error card with login & signup recovery links
  const missingMock = createMockSupabaseForOAuth();
  const missingAuth = createAuthService({ supabaseClient: missingMock.client, isDemo: false });
  setUrl('/auth/callback');
  const rootMissing = harness.createRoot();
  const appMissing = mountApp(/** @type {HTMLElement} */ (/** @type {unknown} */ (rootMissing)), { auth: missingAuth });
  mountedApps.push(appMissing);
  await appMissing.ready;

  assert.ok(rootMissing.querySelector('#oauth-callback-error-state'));
  assert.ok(rootMissing.querySelector('#oauth-back-login'));
  assert.ok(rootMissing.querySelector('#oauth-create-account'));
  appMissing.destroy();

  // 3. Suspended Google user is signed out immediately and blocked
  const suspendedMock = createMockSupabaseForOAuth({
    exchangeResult: async () => ({
      data: {
        session: {
          user: {
            id: 'supa-suspended-1',
            email: 'blocked@example.com',
            user_metadata: { name: 'Blocked User' },
          },
        },
      },
      error: null,
    }),
    accountStatus: 'suspended',
  });
  const suspendedAuth = createAuthService({ supabaseClient: suspendedMock.client, isDemo: false });
  setUrl('/auth/callback?code=suspended-code-1');
  const rootSuspended = harness.createRoot();
  const appSuspended = mountApp(/** @type {HTMLElement} */ (/** @type {unknown} */ (rootSuspended)), { auth: suspendedAuth });
  mountedApps.push(appSuspended);
  await appSuspended.ready;

  assert.equal(suspendedMock.getSignOutCount(), 1);
  assert.equal(window.location.pathname, '/auth/callback');
  assert.ok(rootSuspended.querySelector('#oauth-callback-error-state'));
  assert.match(rootSuspended.innerHTML, /suspended/i);
});
