import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomHarness, flushMicrotasks } from './helpers/domHarness.mjs';
import { resetDemoState } from '../src/lib/demo/demoStore.js';
import { createAuthService } from '../src/lib/repositories/authRepository.js';
import { validateResetPasswordForm } from '../src/lib/validators.js';
import { mountApp } from '../src/app/app.js';

let harness = null;
const mountedApps = [];

function createMockSupabaseForRecovery({
  initialSessionUser = null,
  exchangeResult = null,
  verifyOtpResult = null,
  updateUserHandler = null,
  role = 'learner',
} = {}) {
  let activeUser = initialSessionUser;
  const exchangeCalls = [];
  const verifyOtpCalls = [];
  const updateCalls = [];
  let signOutCount = 0;

  const client = {
    auth: {
      async getSession() {
        return {
          data: { session: activeUser ? { user: activeUser } : null },
          error: null,
        };
      },
      async exchangeCodeForSession(code, options) {
        exchangeCalls.push({ code, options });
        const res =
          typeof exchangeResult === 'function'
            ? await exchangeResult(code, options)
            : exchangeResult;
        if (res?.data?.session?.user) {
          activeUser = res.data.session.user;
        }
        return res || { data: { session: null }, error: { message: 'Invalid code' } };
      },
      async verifyOtp(params) {
        verifyOtpCalls.push(params);
        const res =
          typeof verifyOtpResult === 'function'
            ? await verifyOtpResult(params)
            : verifyOtpResult;
        if (res?.data?.session?.user) {
          activeUser = res.data.session.user;
        }
        return res || { data: { session: null }, error: { message: 'Invalid token' } };
      },
      async updateUser(attrs) {
        updateCalls.push(attrs);
        if (typeof updateUserHandler === 'function') {
          return updateUserHandler(attrs, activeUser);
        }
        return { data: { user: activeUser }, error: null };
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
                  if (!activeUser) {
                    return { data: null, error: { message: 'No rows' } };
                  }
                  return {
                    data: {
                      id: activeUser.id,
                      email: activeUser.email,
                      first_name: activeUser.user_metadata?.first_name || 'Ada',
                      full_name: activeUser.user_metadata?.full_name || 'Ada Lovelace',
                      role,
                      account_status: 'active',
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
    client,
    getActiveUser: () => activeUser,
    getExchangeCalls: () => exchangeCalls,
    getVerifyOtpCalls: () => verifyOtpCalls,
    getUpdateCalls: () => updateCalls,
    getSignOutCount: () => signOutCount,
  };
}

function setUrl(fullPath) {
  const [pathPart, hashPart = ''] = fullPath.split('#');
  const [pathname, search = ''] = pathPart.split('?');
  window.location.pathname = pathname || '/';
  window.location.search = search ? `?${search}` : '';
  window.location.hash = hashPart ? `#${hashPart}` : '';
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
    mountedApps.pop().destroy();
  }
  harness?.cleanup();
});

test('validateResetPasswordForm enforces length bounds and confirmation match', () => {
  assert.equal(
    validateResetPasswordForm({ password: '', confirmPassword: '' }).password,
    'Password must be at least 6 characters.'
  );
  assert.equal(
    validateResetPasswordForm({ password: '12345', confirmPassword: '12345' }).password,
    'Password must be at least 6 characters.'
  );
  assert.equal(
    validateResetPasswordForm({
      password: 'a'.repeat(129),
      confirmPassword: 'a'.repeat(129),
    }).password,
    'Password must be 128 characters or fewer.'
  );
  assert.equal(
    validateResetPasswordForm({ password: 'secret99', confirmPassword: '' }).confirmPassword,
    'Confirm your new password.'
  );
  assert.equal(
    validateResetPasswordForm({ password: 'secret99', confirmPassword: 'different99' })
      .confirmPassword,
    'Passwords do not match.'
  );
  assert.deepEqual(
    validateResetPasswordForm({ password: 'secret99', confirmPassword: 'secret99' }),
    {}
  );
});

test('Valid PKCE recovery callback (?code=...) exchanges session, strips URL, updates password, and supports navigation to login', async () => {
  const recoveryUser = {
    id: 'supa-pkce-1',
    email: 'ada@kord.app',
    user_metadata: { first_name: 'Ada', full_name: 'Ada Lovelace' },
  };
  const mock = createMockSupabaseForRecovery({
    exchangeResult: {
      data: { session: { user: recoveryUser } },
      error: null,
    },
  });
  const auth = createAuthService({ supabaseClient: mock.client, isDemo: false });

  setUrl('/reset-password?code=pkce-code-123&type=recovery');
  const rootEl = harness.createRoot();
  const ctrl = mountApp(rootEl, { auth });
  mountedApps.push(ctrl);
  await ctrl.ready;

  assert.equal(mock.getExchangeCalls().length, 1);
  assert.equal(mock.getExchangeCalls()[0].code, 'pkce-code-123');
  assert.equal(window.location.search, '', 'Callback code must be stripped from URL');
  assert.ok(rootEl.querySelector('#update-password-form'), 'Password update form renders');

  rootEl.querySelector('#new-password').value = 'newStrongPass42';
  rootEl.querySelector('#confirm-new-password').value = 'newStrongPass42';
  await rootEl.querySelector('#update-password-form').dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.equal(mock.getUpdateCalls().length, 1);
  assert.equal(mock.getUpdateCalls()[0].password, 'newStrongPass42');
  assert.ok(rootEl.querySelector('#reset-password-success'), 'Success confirmation renders');
  assert.equal(auth.isPasswordRecoveryMode(), false);

  const returnLoginBtn = rootEl.querySelector('#reset-return-login');
  assert.ok(returnLoginBtn);
  await returnLoginBtn.click();
  await flushMicrotasks();

  assert.equal(mock.getSignOutCount(), 1);
  assert.equal(window.location.pathname, '/login');
  assert.ok(rootEl.querySelector('#login-form'));
});

test('Valid OTP token_hash recovery callback verifies via verifyOtp and navigates to workspace when chosen', async () => {
  const recoveryUser = {
    id: 'supa-otp-1',
    email: 'ada@kord.app',
    user_metadata: { first_name: 'Ada', full_name: 'Ada Lovelace' },
  };
  const mock = createMockSupabaseForRecovery({
    verifyOtpResult: {
      data: { session: { user: recoveryUser } },
      error: null,
    },
  });
  const auth = createAuthService({ supabaseClient: mock.client, isDemo: false });

  setUrl('/reset-password?token_hash=hash-xyz-999&type=recovery');
  const rootEl = harness.createRoot();
  const ctrl = mountApp(rootEl, { auth });
  mountedApps.push(ctrl);
  await ctrl.ready;

  assert.equal(mock.getVerifyOtpCalls().length, 1);
  assert.deepEqual(mock.getVerifyOtpCalls()[0], {
    token_hash: 'hash-xyz-999',
    type: 'recovery',
  });
  assert.equal(window.location.search, '');
  assert.ok(rootEl.querySelector('#update-password-form'));

  rootEl.querySelector('#new-password').value = 'updatedPass77';
  rootEl.querySelector('#confirm-new-password').value = 'updatedPass77';
  await rootEl.querySelector('#update-password-form').dispatchEvent({ type: 'submit' });
  await flushMicrotasks();

  assert.ok(rootEl.querySelector('#reset-password-success'));
  const continueBtn = rootEl.querySelector('#reset-continue-workspace');
  assert.ok(continueBtn);
  await continueBtn.click();
  await flushMicrotasks();

  assert.equal(window.location.pathname, '/dashboard');
});

test('Invalid, expired, reused, or missing recovery links block the password update form and preserve existing login sessions', async () => {
  // 1. Missing session (direct visit)
  const emptyMock = createMockSupabaseForRecovery();
  const emptyAuth = createAuthService({ supabaseClient: emptyMock.client, isDemo: false });
  setUrl('/reset-password');
  const root1 = harness.createRoot();
  const ctrl1 = mountApp(root1, { auth: emptyAuth });
  mountedApps.push(ctrl1);
  await ctrl1.ready;
  assert.equal(root1.querySelector('#update-password-form'), null);
  assert.ok(root1.querySelector('#reset-missing-state'));
  ctrl1.destroy();

  // 2. Bare ?type=recovery URL param without a real session must NOT unlock the form
  setUrl('/reset-password?type=recovery');
  const root2 = harness.createRoot();
  const ctrl2 = mountApp(root2, { auth: emptyAuth });
  mountedApps.push(ctrl2);
  await ctrl2.ready;
  assert.equal(root2.querySelector('#update-password-form'), null);
  assert.ok(root2.querySelector('#reset-invalid-state'));
  ctrl2.destroy();

  // 3. Expired URL error (?error=access_denied&error_code=otp_expired) preserves existing session without granting reset form
  const signedInUser = {
    id: 'supa-existing-1',
    email: 'maya@kord.app',
    user_metadata: { first_name: 'Maya', full_name: 'Maya Lin' },
  };
  const existingMock = createMockSupabaseForRecovery({
    initialSessionUser: signedInUser,
    exchangeResult: {
      data: { session: null },
      error: { message: 'AuthApiError: invalid or already used code' },
    },
  });
  const existingAuth = createAuthService({ supabaseClient: existingMock.client, isDemo: false });

  setUrl(
    '/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
  );
  const root3 = harness.createRoot();
  const ctrl3 = mountApp(root3, { auth: existingAuth });
  mountedApps.push(ctrl3);
  await ctrl3.ready;

  assert.equal(root3.querySelector('#update-password-form'), null);
  const invalidCard = root3.querySelector('#reset-invalid-state');
  assert.ok(invalidCard);
  assert.match(invalidCard.textContent, /expired/i);
  assert.ok(existingMock.getActiveUser(), 'Existing valid session must not be destroyed');
  assert.equal(existingMock.getSignOutCount(), 0);
  ctrl3.destroy();

  // 4. Failed PKCE code exchange blocks form and preserves existing session
  setUrl('/reset-password?code=reused-or-bad-code');
  const root4 = harness.createRoot();
  const ctrl4 = mountApp(root4, { auth: existingAuth });
  mountedApps.push(ctrl4);
  await ctrl4.ready;

  assert.equal(existingMock.getExchangeCalls().length, 1);
  assert.equal(root4.querySelector('#update-password-form'), null);
  assert.ok(root4.querySelector('#reset-invalid-state'));
  assert.ok(existingMock.getActiveUser(), 'Failed code exchange must not destroy existing session');
});

test('Password reset form enforces validation, handles failed updateUser calls, and blocks duplicate submissions', async () => {
  const recoveryUser = {
    id: 'supa-dup-1',
    email: 'ada@kord.app',
    user_metadata: { first_name: 'Ada', full_name: 'Ada Lovelace' },
  };

  let resolveFirstUpdate;
  let attemptNumber = 0;
  const mock = createMockSupabaseForRecovery({
    exchangeResult: {
      data: { session: { user: recoveryUser } },
      error: null,
    },
    updateUserHandler() {
      attemptNumber += 1;
      if (attemptNumber === 1) {
        return new Promise((resolve) => {
          resolveFirstUpdate = resolve;
        });
      }
      return Promise.resolve({ data: { user: recoveryUser }, error: null });
    },
  });
  const auth = createAuthService({ supabaseClient: mock.client, isDemo: false });

  setUrl('/reset-password?code=valid-dup-code');
  const rootEl = harness.createRoot();
  const ctrl = mountApp(rootEl, { auth });
  mountedApps.push(ctrl);
  await ctrl.ready;

  const form = rootEl.querySelector('#update-password-form');
  const passInput = rootEl.querySelector('#new-password');
  const confirmInput = rootEl.querySelector('#confirm-new-password');
  const submitBtn = rootEl.querySelector('#update-password-submit');
  const formErr = rootEl.querySelector('#update-password-error');

  // Mismatched confirmation blocks submission
  passInput.value = 'validPass123';
  confirmInput.value = 'mismatchPass';
  await form.dispatchEvent({ type: 'submit' });
  assert.equal(
    rootEl.querySelector('[data-error-for="confirmPassword"]').textContent,
    'Passwords do not match.'
  );
  assert.equal(mock.getUpdateCalls().length, 0);

  // Too-short password blocks submission
  passInput.value = '123';
  confirmInput.value = '123';
  await form.dispatchEvent({ type: 'submit' });
  assert.equal(
    rootEl.querySelector('[data-error-for="password"]').textContent,
    'Password must be at least 6 characters.'
  );
  assert.equal(mock.getUpdateCalls().length, 0);

  // Valid submission while in-flight rejects duplicate submit
  passInput.value = 'securePass2026';
  confirmInput.value = 'securePass2026';
  const firstSubmitPromise = form.dispatchEvent({ type: 'submit' });
  assert.equal(submitBtn.disabled, true);
  await form.dispatchEvent({ type: 'submit' });
  assert.equal(mock.getUpdateCalls().length, 1, 'Duplicate submission must be blocked');

  // First attempt fails -> error message shown, form re-enabled for retry
  resolveFirstUpdate({ data: null, error: { message: 'New password should be different from old password.' } });
  await firstSubmitPromise;
  await flushMicrotasks();

  assert.match(formErr.textContent, /different from old password/i);
  assert.equal(submitBtn.disabled, false);
  assert.equal(rootEl.querySelector('#reset-password-success'), null);

  // Retry succeeds
  await form.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();
  assert.equal(mock.getUpdateCalls().length, 2);
  assert.ok(rootEl.querySelector('#reset-password-success'));
});
