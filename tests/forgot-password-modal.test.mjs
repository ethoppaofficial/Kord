import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomHarness, flushMicrotasks } from './helpers/domHarness.mjs';
import { resetDemoState } from '../src/lib/demo/demoStore.js';
import { createAuthService } from '../src/lib/repositories/authRepository.js';
import { validateForgotPasswordForm } from '../src/lib/validators.js';
import { openForgotPasswordModal } from '../src/components/ForgotPasswordModal.js';
import { closeModal } from '../src/components/Modal.js';
import { mountApp } from '../src/app/app.js';

let harness = null;
const mountedApps = [];

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  globalThis.sessionStorage.setItem(
    'kord_ip_tz_v1',
    JSON.stringify({ timezone: 'UTC', cachedAt: Date.now() })
  );
  resetDemoState();
  window.location.pathname = '/';
  window.location.search = '';
  window.location.hash = '';
  harness = installDomHarness();
});

afterEach(() => {
  closeModal();
  while (mountedApps.length > 0) {
    mountedApps.pop().destroy();
  }
  harness?.cleanup();
});

test('validateForgotPasswordForm validates empty, malformed, oversized, and valid emails', () => {
  assert.equal(validateForgotPasswordForm({ email: '' }).email, 'Enter your email address.');
  assert.equal(validateForgotPasswordForm({ email: '   ' }).email, 'Enter your email address.');
  assert.equal(
    validateForgotPasswordForm({ email: 'not-an-email' }).email,
    'Enter a valid email address.'
  );
  assert.equal(
    validateForgotPasswordForm({ email: `${'a'.repeat(245)}@example.com` }).email,
    'Email address must be 254 characters or fewer.'
  );
  assert.deepEqual(validateForgotPasswordForm({ email: 'learner@example.com' }), {});
});

test('createAuthService().recoverPassword interfaces with Supabase recoverPassword and resetPasswordForEmail', async () => {
  let recoverCalls = [];
  const recoverClient = {
    auth: {
      async recoverPassword(email, options) {
        recoverCalls.push({ email, options });
        return { data: {}, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  };
  const recoverAuth = createAuthService({ supabaseClient: recoverClient, isDemo: false });
  const res1 = await recoverAuth.recoverPassword('  Ada@Example.COM ');
  assert.equal(res1.sent, true);
  assert.equal(res1.email, 'ada@example.com');
  assert.equal(recoverCalls.length, 1);
  assert.equal(recoverCalls[0].email, 'ada@example.com');
  assert.match(recoverCalls[0].options.redirectTo, /\/reset-password$/);

  let resetCalls = [];
  const resetClient = {
    auth: {
      async resetPasswordForEmail(email, options) {
        resetCalls.push({ email, options });
        return { data: {}, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  };
  const resetAuth = createAuthService({ supabaseClient: resetClient, isDemo: false });
  const res2 = await resetAuth.recoverPassword('learner@kord.app');
  assert.equal(res2.sent, true);
  assert.equal(resetCalls.length, 1);
  assert.equal(resetCalls[0].email, 'learner@kord.app');

  await assert.rejects(() => resetAuth.recoverPassword('invalid'), /valid email address/i);

  const errorAuth = createAuthService({
    supabaseClient: {
      auth: {
        async resetPasswordForEmail() {
          return { data: null, error: { message: 'Rate limit exceeded' } };
        },
      },
    },
    isDemo: false,
  });
  await assert.rejects(() => errorAuth.recoverPassword('learner@kord.app'), /Rate limit exceeded/);
});

test('ForgotPasswordModal validates input, handles errors, and renders success feedback', async () => {
  const calls = [];
  let failNext = true;
  const mockSupabaseAuth = createAuthService({
    supabaseClient: {
      auth: {
        async recoverPassword(email, options) {
          calls.push({ email, options });
          if (failNext) {
            failNext = false;
            return { data: null, error: { message: 'Recovery service unavailable' } };
          }
          return { data: {}, error: null };
        },
        onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    },
    isDemo: false,
  });

  let successPayload = null;
  openForgotPasswordModal({
    initialEmail: 'maya@example.com',
    auth: mockSupabaseAuth,
    onSuccess: (payload) => {
      successPayload = payload;
    },
  });

  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, 'Forgot Password modal dialog mounts in document');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');

  const form = document.querySelector('#forgot-password-modal-form');
  const emailInput = document.querySelector('#forgot-modal-email');
  const emailErr = document.querySelector('[data-error-for="email"]');
  const formErr = document.querySelector('#forgot-modal-form-error');
  assert.equal(emailInput.value, 'maya@example.com');

  // Invalid email blocks submission without calling Supabase
  emailInput.value = 'bad-email';
  await form.dispatchEvent({ type: 'submit' });
  assert.equal(emailErr.textContent, 'Enter a valid email address.');
  assert.equal(emailInput.getAttribute('aria-invalid'), 'true');
  assert.equal(calls.length, 0);

  // Typing clears inline validation error
  await emailInput.dispatchEvent({ type: 'input' });
  assert.equal(emailErr.textContent, '');
  assert.equal(emailInput.getAttribute('aria-invalid'), 'false');

  // Valid email surfaces Supabase error and allows retry
  emailInput.value = 'maya@example.com';
  await form.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();
  assert.equal(calls.length, 1);
  assert.equal(formErr.textContent, 'Recovery service unavailable');
  assert.equal(document.querySelector('#forgot-modal-submit').disabled, false);

  // Retry succeeds and renders success confirmation panel
  await form.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();
  assert.equal(calls.length, 2);
  const successBox = document.querySelector('#forgot-modal-success');
  assert.ok(successBox, 'Success feedback panel is rendered');
  assert.ok(successBox.textContent.includes('Reset instructions sent'));
  assert.ok(successBox.textContent.includes('maya@example.com'));
  assert.equal(successPayload?.email, 'maya@example.com');

  // "Try a different email" returns to the form cleanly
  const tryAnotherBtn = document.querySelector('#forgot-modal-try-another');
  assert.ok(tryAnotherBtn);
  await tryAnotherBtn.click();
  assert.ok(document.querySelector('#forgot-password-modal-form'));
  assert.equal(document.querySelector('#forgot-modal-email').value, '');

  // Escape closes the modal
  await document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('Login page "Forgot password?" button opens ForgotPasswordModal with pre-filled email', async () => {
  let calledWith = null;
  const mockAuth = {
    async getCurrentSession() {
      return null;
    },
    subscribeAuthChanges() {
      return () => {};
    },
    async recoverPassword(email) {
      calledWith = email;
      return { sent: true, email };
    },
  };

  window.location.pathname = '/login';
  const rootEl = harness.createRoot();
  const ctrl = mountApp(rootEl, { auth: mockAuth });
  mountedApps.push(ctrl);
  await ctrl.ready;

  const loginEmail = rootEl.querySelector('#login-email');
  const forgotBtn = rootEl.querySelector('#open-forgot-password-btn');
  assert.ok(loginEmail && forgotBtn, 'Login email and Forgot password trigger exist');

  loginEmail.value = 'ada@kord.app';
  await forgotBtn.click();

  const modalInput = document.querySelector('#forgot-modal-email');
  const modalForm = document.querySelector('#forgot-password-modal-form');
  assert.ok(modalInput && modalForm, 'Forgot password modal opens from login page');
  assert.equal(modalInput.value, 'ada@kord.app');

  await modalForm.dispatchEvent({ type: 'submit' });
  await flushMicrotasks();
  assert.equal(calledWith, 'ada@kord.app');
  assert.ok(document.querySelector('#forgot-modal-success'));
});
