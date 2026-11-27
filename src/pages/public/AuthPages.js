import {
  signIn,
  signUp,
  signInWithGoogle,
  recoverPassword,
  updatePassword,
  isPasswordRecoveryMode,
} from '../../lib/repositories/authRepository.js';
import {
  validateForgotPasswordForm,
  validateLoginForm,
  validateResetPasswordForm,
  validateSignupForm,
} from '../../lib/validators.js';
import { showToast } from '../../components/Toast.js';
import { openForgotPasswordModal } from '../../components/ForgotPasswordModal.js';
import { escapeHtml } from '../../lib/formatters.js';

const EYE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;
const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"/><path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"/></svg>`;

/**
 * @param {{
 *   id: string;
 *   name: string;
 *   label: string;
 *   autocomplete: string;
 *   placeholder?: string;
 *   errorKey: string;
 * }} params
 */
function renderPasswordField({
  id,
  name,
  label,
  autocomplete,
  placeholder = 'At least 6 characters',
  errorKey,
}) {
  return `
    <div class="field">
      <label class="field-label" for="${id}">${label}</label>
      <div class="password-input-wrap">
        <input class="input password-input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}" required />
        <button
          type="button"
          class="password-toggle-btn"
          data-password-toggle="${id}"
          aria-label="Show password"
          aria-pressed="false"
          aria-controls="${id}"
          title="Show password"
        >
          <span class="password-toggle-icon" aria-hidden="true">${EYE_ICON}</span>
          <span class="password-toggle-text">Show</span>
        </button>
      </div>
      <div class="field-error" data-error-for="${errorKey}"></div>
    </div>
  `;
}

/** @param {HTMLElement} root */
function bindPasswordToggles(root) {
  const buttons = root.querySelectorAll('[data-password-toggle]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-password-toggle');
      const input = /** @type {HTMLInputElement | null} */ (
        targetId ? root.querySelector(`#${targetId}`) : null
      );
      if (!input) return;

      const currentType = input.getAttribute('type') || input.type || 'password';
      const isHidden = currentType === 'password';
      const nextType = isHidden ? 'text' : 'password';

      input.type = nextType;
      input.setAttribute('type', nextType);
      btn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
      btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      btn.setAttribute('title', isHidden ? 'Hide password' : 'Show password');

      const iconEl = btn.querySelector('.password-toggle-icon');
      const textEl = btn.querySelector('.password-toggle-text');
      if (iconEl) iconEl.innerHTML = isHidden ? EYE_OFF_ICON : EYE_ICON;
      if (textEl) textEl.textContent = isHidden ? 'Hide' : 'Show';
    });
  });
}

/**
 * @param {{ buttonId: string; errorId: string }} params
 */
function renderGoogleSignInBlock({ buttonId, errorId }) {
  return `
    <div class="auth-oauth-divider" role="separator" aria-label="or">
      <span>or</span>
    </div>
    <button type="button" class="btn btn-google" id="${buttonId}">
      <span class="google-mark" aria-hidden="true">${GOOGLE_ICON}</span>
      <span class="google-btn-label">Continue with Google</span>
    </button>
    <div class="field-error" id="${errorId}" role="alert" style="margin-top:8px;"></div>
  `;
}

/**
 * @param {{
 *   root: HTMLElement;
 *   buttonId: string;
 *   errorId: string;
 *   auth?: Partial<import('../../types/kord.d.ts').AuthService> | null;
 * }} params
 */
function bindGoogleSignInButton({ root, buttonId, errorId, auth = null }) {
  const btn = /** @type {HTMLButtonElement | null} */ (root.querySelector(`#${buttonId}`));
  const errEl = root.querySelector(`#${errorId}`);
  if (!btn) return;
  const doGoogleSignIn = auth?.signInWithGoogle || signInWithGoogle;
  let pending = false;

  btn.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    if (errEl) errEl.textContent = '';
    const labelEl = btn.querySelector('.google-btn-label');
    btn.disabled = true;
    if (labelEl) {
      labelEl.textContent = 'Redirecting to Google…';
    } else {
      btn.textContent = 'Redirecting to Google…';
    }

    try {
      await doGoogleSignIn();
    } catch (err) {
      if (errEl) {
        errEl.textContent =
          err instanceof Error && err.message ? err.message : 'Unable to start Google Sign-In.';
      }
      btn.disabled = false;
      if (labelEl) {
        labelEl.textContent = 'Continue with Google';
      } else {
        btn.textContent = 'Continue with Google';
      }
      pending = false;
    }
  });
}

/**
 * @param {{
 *   navigate: (path: string) => unknown;
 *   auth?: Partial<import('../../types/kord.d.ts').AuthService> | null;
 * }} params
 * @returns {import('../../types/kord.d.ts').PageView}
 */
export function renderLoginPage({ navigate, auth = null }) {
  const doSignIn = auth?.signIn || signIn;
  return {
    html: `
      <div class="auth-wrap">
        <div class="card">
          <h1 class="page-title">Sign in to Kord</h1>
          <p class="page-subtitle" style="margin-bottom:20px;">Sign in to access skill roadmaps, quizzes, practical challenges, and matched opportunities.</p>

          <form id="login-form" class="form-stack" novalidate>
            <div class="field">
              <label class="field-label" for="login-email">Email address</label>
              <input class="input" id="login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
              <div class="field-error" data-error-for="email"></div>
            </div>

            ${renderPasswordField({
              id: 'login-password',
              name: 'password',
              label: 'Password',
              autocomplete: 'current-password',
              placeholder: 'At least 6 characters',
              errorKey: 'password',
            })}

            <div class="field-error" id="login-form-error" role="alert"></div>

            <button type="submit" class="btn btn-primary" id="login-submit">Sign in</button>
          </form>

          ${renderGoogleSignInBlock({
            buttonId: 'login-google-btn',
            errorId: 'login-google-error',
          })}

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:18px; font-size:14px;">
            <button type="button" class="link-btn" id="open-forgot-password-btn">Forgot password?</button>
            <a href="/signup" data-link>Create account</a>
          </div>
        </div>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindPasswordToggles(root);
      bindGoogleSignInButton({
        root,
        buttonId: 'login-google-btn',
        errorId: 'login-google-error',
        auth,
      });
      const form = /** @type {HTMLFormElement | null} */ (root.querySelector('#login-form'));
      const submitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#login-submit'));
      const formErr = root.querySelector('#login-form-error');
      const forgotBtn = root.querySelector('#open-forgot-password-btn');

      forgotBtn?.addEventListener('click', () => {
        const emailInput = /** @type {HTMLInputElement | null} */ (root.querySelector('#login-email'));
        openForgotPasswordModal({
          initialEmail: String(emailInput?.value || '').trim(),
          auth,
        });
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (formErr) formErr.textContent = '';
        const fd = new FormData(form);
        const payload = {
          email: String(fd.get('email') || ''),
          password: String(fd.get('password') || ''),
        };

        const errors = validateLoginForm(payload);
        const emailErr = root.querySelector('[data-error-for="email"]');
        const passErr = root.querySelector('[data-error-for="password"]');
        if (emailErr) emailErr.textContent = errors.email || '';
        if (passErr) passErr.textContent = errors.password || '';
        if (Object.keys(errors).length > 0) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Signing in…';
        }
        try {
          const session = await doSignIn(payload);
          showToast('Signed in successfully.', 'success');
          navigate(session?.user?.role === 'admin' ? '/admin' : '/dashboard');
        } catch (err) {
          if (formErr) {
            formErr.textContent = err instanceof Error && err.message ? err.message : 'Sign in failed.';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign in';
          }
        }
      });
    },
  };
}

/**
 * @param {{
 *   navigate: (path: string) => unknown;
 *   auth?: Partial<import('../../types/kord.d.ts').AuthService> | null;
 * }} params
 * @returns {import('../../types/kord.d.ts').PageView}
 */
export function renderSignupPage({ navigate, auth = null }) {
  const doSignUp = auth?.signUp || signUp;
  return {
    html: `
      <div class="auth-wrap">
        <div class="card">
          <h1 class="page-title">Create your Kord account</h1>
          <p class="page-subtitle" style="margin-bottom:20px;">Start building visible skill evidence and unlock matched opportunities.</p>

          <form id="signup-form" class="form-stack" novalidate>
            <div class="lab-grid-2">
              <div class="field">
                <label class="field-label" for="signup-first-name">First name</label>
                <input class="input" id="signup-first-name" name="firstName" type="text" autocomplete="given-name" placeholder="e.g. Mr. Ibrahim" required />
                <div class="field-error" data-error-for="firstName"></div>
              </div>

              <div class="field">
                <label class="field-label" for="signup-last-name">Last name</label>
                <input class="input" id="signup-last-name" name="lastName" type="text" autocomplete="family-name" placeholder="e.g. Musa" required />
                <div class="field-error" data-error-for="lastName"></div>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="signup-email">Email address</label>
              <input class="input" id="signup-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
              <div class="field-error" data-error-for="email"></div>
            </div>

            ${renderPasswordField({
              id: 'signup-password',
              name: 'password',
              label: 'Password',
              autocomplete: 'new-password',
              placeholder: 'At least 6 characters',
              errorKey: 'password',
            })}

            ${renderPasswordField({
              id: 'signup-confirm',
              name: 'confirmPassword',
              label: 'Confirm password',
              autocomplete: 'new-password',
              placeholder: 'Repeat password',
              errorKey: 'confirmPassword',
            })}

            <div class="field-error" id="signup-form-error" role="alert"></div>

            <button type="submit" class="btn btn-primary" id="signup-submit">Create account</button>
          </form>

          ${renderGoogleSignInBlock({
            buttonId: 'signup-google-btn',
            errorId: 'signup-google-error',
          })}

          <div style="margin-top:18px; font-size:14px; text-align:center;">
            Already have an account? <a href="/login" data-link>Sign in</a>
          </div>
        </div>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindPasswordToggles(root);
      bindGoogleSignInButton({
        root,
        buttonId: 'signup-google-btn',
        errorId: 'signup-google-error',
        auth,
      });
      const form = /** @type {HTMLFormElement | null} */ (root.querySelector('#signup-form'));
      const submitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#signup-submit'));
      const formErr = root.querySelector('#signup-form-error');

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (formErr) formErr.textContent = '';
        const fd = new FormData(form);
        const payload = {
          firstName: String(fd.get('firstName') || ''),
          lastName: String(fd.get('lastName') || ''),
          email: String(fd.get('email') || ''),
          password: String(fd.get('password') || ''),
          confirmPassword: String(fd.get('confirmPassword') || ''),
        };

        const errors = /** @type {Record<string, string>} */ (validateSignupForm(payload));
        ['firstName', 'lastName', 'email', 'password', 'confirmPassword'].forEach((k) => {
          const el = root.querySelector(`[data-error-for="${k}"]`);
          if (el) el.textContent = errors[k] || '';
        });
        if (Object.keys(errors).length > 0) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating account…';
        }
        try {
          const session = await doSignUp(payload);
          showToast('Account created.', 'success');
          navigate(session?.user?.role === 'admin' ? '/admin' : '/dashboard');
        } catch (err) {
          if (formErr) {
            formErr.textContent =
              err instanceof Error && err.message ? err.message : 'Unable to create account.';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create account';
          }
        }
      });
    },
  };
}

/**
 * @param {{ auth?: Partial<import('../../types/kord.d.ts').AuthService> | null }} [params]
 * @returns {import('../../types/kord.d.ts').PageView}
 */
export function renderForgotPasswordPage({ auth = null } = {}) {
  const doRecover =
    auth?.recoverPassword || auth?.requestPasswordReset || recoverPassword;

  return {
    html: `
      <div class="auth-wrap">
        <div class="card">
          <h1 class="page-title">Reset your password</h1>
          <p class="page-subtitle" style="margin-bottom:20px;">Enter your email address and we will prepare password reset instructions.</p>

          <form id="reset-form" class="form-stack" novalidate>
            <div class="field">
              <label class="field-label" for="reset-email">Email address</label>
              <input class="input" id="reset-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
              <div class="field-error" data-error-for="email"></div>
            </div>

            <div id="reset-feedback" style="font-size:14px;" role="status" aria-live="polite"></div>

            <button type="submit" class="btn btn-primary" id="reset-submit">Send reset link</button>
          </form>

          <div style="margin-top:16px; font-size:14px;">
            <a href="/login" data-link>← Back to sign in</a>
          </div>
        </div>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      const form = /** @type {HTMLFormElement | null} */ (root.querySelector('#reset-form'));
      const submitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#reset-submit'));
      const feedback = /** @type {HTMLElement | null} */ (root.querySelector('#reset-feedback'));

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = String(new FormData(form).get('email') || '').trim();
        const errEl = root.querySelector('[data-error-for="email"]');
        const errors = validateForgotPasswordForm({ email });
        if (errEl) errEl.textContent = errors.email || '';
        if (errors.email) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending…';
        }
        try {
          const res = await doRecover(email);
          if (feedback) {
            feedback.style.color = 'var(--color-green)';
            feedback.textContent = res.note || 'Reset instructions sent. Check your inbox.';
          }
          showToast('Reset request processed.', 'success');
        } catch (err) {
          if (feedback) {
            feedback.style.color = 'var(--color-red)';
            feedback.textContent =
              err instanceof Error && err.message ? err.message : 'Unable to process request.';
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send reset link';
          }
        }
      });
    },
  };
}

/**
 * @param {{
 *   navigate: (path: string) => unknown;
 *   session: import('../../types/kord.d.ts').AuthSession | null;
 *   auth?: Partial<import('../../types/kord.d.ts').AuthService> | null;
 *   recoveryState?: import('../../types/kord.d.ts').RecoveryState | null;
 *   signOut?: ((opts?: { redirectTo?: string; toastMessage?: string }) => Promise<void>) | null;
 * }} params
 * @returns {import('../../types/kord.d.ts').PageView}
 */
export function renderResetPasswordPage({
  navigate,
  session,
  auth = null,
  recoveryState = null,
  signOut = null,
}) {
  const checkRecovery = auth?.isPasswordRecoveryMode || isPasswordRecoveryMode;
  const doUpdatePassword = auth?.updatePassword || updatePassword;
  const doSignOut = signOut || auth?.signOut;
  const status = recoveryState?.status;

  if (status === 'invalid_link') {
    const errorMsg =
      recoveryState?.error ||
      'This password reset link is invalid, expired, or has already been used.';
    const workspaceHref = session?.user?.role === 'admin' ? '/admin' : '/dashboard';

    return {
      html: `
        <div class="auth-wrap">
          <div class="card" id="reset-invalid-state" role="alert">
            <h1 class="page-title">Reset link invalid or expired</h1>
            <p class="page-subtitle" style="margin-bottom:16px;">${escapeHtml(errorMsg)}</p>
            ${
              session
                ? `<p style="font-size:13.5px; color:var(--color-text-secondary); margin-bottom:18px;">Your existing signed-in session was preserved.</p>`
                : ''
            }
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary" id="reset-request-new-link">Request new reset link</button>
              ${
                session
                  ? `<a href="${workspaceHref}" data-link class="btn btn-secondary" id="reset-existing-workspace">Return to workspace</a>`
                  : `<a href="/login" data-link class="btn btn-secondary">Back to sign in</a>`
              }
            </div>
          </div>
        </div>
      `,
      /** @param {HTMLElement} root */
      bind(root) {
        root.querySelector('#reset-request-new-link')?.addEventListener('click', () => {
          openForgotPasswordModal({ auth });
        });
      },
    };
  }

  const canUpdate =
    status === 'ready'
      ? Boolean(session)
      : Boolean(session || checkRecovery());

  if (!canUpdate || status === 'missing_session') {
    return {
      html: `
        <div class="auth-wrap">
          <div class="card" id="reset-missing-state">
            <h1 class="page-title">Reset password link required</h1>
            <p class="page-subtitle" style="margin-bottom:20px;">Open this page from a valid password recovery link or request a new reset email.</p>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary" id="reset-request-link-btn">Request reset link</button>
              <a href="/login" data-link class="btn btn-secondary">Back to sign in</a>
            </div>
          </div>
        </div>
      `,
      /** @param {HTMLElement} root */
      bind(root) {
        root.querySelector('#reset-request-link-btn')?.addEventListener('click', () => {
          openForgotPasswordModal({ auth });
        });
      },
    };
  }

  return {
    html: `
      <div class="auth-wrap">
        <div class="card" id="reset-password-card">
          <h1 class="page-title">Set a new password</h1>
          <p class="page-subtitle" style="margin-bottom:20px;">Choose a new password for your Kord account.</p>

          <form id="update-password-form" class="form-stack" novalidate>
            ${renderPasswordField({
              id: 'new-password',
              name: 'password',
              label: 'New password',
              autocomplete: 'new-password',
              placeholder: 'At least 6 characters',
              errorKey: 'password',
            })}

            ${renderPasswordField({
              id: 'confirm-new-password',
              name: 'confirmPassword',
              label: 'Confirm new password',
              autocomplete: 'new-password',
              placeholder: 'Repeat new password',
              errorKey: 'confirmPassword',
            })}

            <div class="field-error" id="update-password-error" role="alert"></div>

            <button type="submit" class="btn btn-primary" id="update-password-submit">Update password</button>
          </form>
        </div>
      </div>
    `,
    /** @param {HTMLElement} root */
    bind(root) {
      bindPasswordToggles(root);
      const card = root.querySelector('#reset-password-card');
      const form = /** @type {HTMLFormElement | null} */ (root.querySelector('#update-password-form'));
      const submitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#update-password-submit'));
      const formErr = root.querySelector('#update-password-error');
      const passwordInput = /** @type {HTMLInputElement | null} */ (root.querySelector('#new-password'));
      const confirmInput = /** @type {HTMLInputElement | null} */ (root.querySelector('#confirm-new-password'));
      let submitting = false;

      passwordInput?.addEventListener('input', () => {
        const errEl = root.querySelector('[data-error-for="password"]');
        if (errEl) errEl.textContent = '';
        if (formErr) formErr.textContent = '';
      });
      confirmInput?.addEventListener('input', () => {
        const errEl = root.querySelector('[data-error-for="confirmPassword"]');
        if (errEl) errEl.textContent = '';
        if (formErr) formErr.textContent = '';
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (submitting) return;

        if (formErr) formErr.textContent = '';
        const fd = new FormData(form);
        const password = String(fd.get('password') ?? passwordInput?.value ?? '');
        const confirmPassword = String(
          fd.get('confirmPassword') ?? confirmInput?.value ?? ''
        );

        const errors = validateResetPasswordForm({ password, confirmPassword });
        const passErr = root.querySelector('[data-error-for="password"]');
        const confirmErr = root.querySelector('[data-error-for="confirmPassword"]');
        if (passErr) passErr.textContent = errors.password || '';
        if (confirmErr) confirmErr.textContent = errors.confirmPassword || '';
        if (Object.keys(errors).length > 0) return;

        submitting = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Updating password…';
        }
        if (passwordInput) passwordInput.disabled = true;
        if (confirmInput) confirmInput.disabled = true;

        try {
          const updatedSession = await doUpdatePassword(password);
          showToast('Password updated.', 'success');

          const activeSession = updatedSession || session;
          const workspaceDest =
            activeSession?.user?.role === 'admin'
              ? '/admin'
              : activeSession
                ? '/dashboard'
                : null;

          if (card) {
            card.innerHTML = `
              <h1 class="page-title">Password updated</h1>
              <p class="page-subtitle" style="margin-bottom:18px;">Your Kord password has been changed.</p>
              <div class="modal-feedback-success" id="reset-password-success" role="status" aria-live="polite">
                <div class="modal-feedback-header">
                  <strong class="modal-feedback-title">Password reset complete</strong>
                </div>
                <p class="modal-feedback-copy">
                  Your new password is active. You can return to sign in with your updated credentials${workspaceDest ? ' or continue into your workspace' : ''}.
                </p>
              </div>
              <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:20px;">
                <button type="button" class="btn btn-primary" id="reset-return-login">Return to sign in</button>
                ${
                  workspaceDest
                    ? `<button type="button" class="btn btn-secondary" id="reset-continue-workspace">Continue to workspace</button>`
                    : ''
                }
              </div>
            `;

            card.querySelector('#reset-return-login')?.addEventListener('click', async () => {
              if (typeof doSignOut === 'function' && activeSession) {
                await doSignOut({
                  redirectTo: '/login',
                  toastMessage: 'Signed out. Sign in with your new password.',
                });
              } else {
                navigate('/login');
              }
            });

            if (workspaceDest) {
              card.querySelector('#reset-continue-workspace')?.addEventListener('click', () => {
                navigate(workspaceDest);
              });
            }
          }
        } catch (err) {
          if (formErr) {
            formErr.textContent =
              err instanceof Error && err.message ? err.message : 'Unable to update password.';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Update password';
          }
          if (passwordInput) passwordInput.disabled = false;
          if (confirmInput) confirmInput.disabled = false;
        } finally {
          submitting = false;
        }
      });
    },
  };
}

/**
 * @param {{
 *   session?: import('../../types/kord.d.ts').AuthSession | null;
 *   oauthCallbackState?: import('../../types/kord.d.ts').OAuthCallbackState | null;
 * }} [params]
 * @returns {import('../../types/kord.d.ts').PageView}
 */
export function renderAuthCallbackPage({ session = null, oauthCallbackState = null } = {}) {
  const status = oauthCallbackState?.status;
  if (status === 'error' || status === 'missing_callback') {
    const errorMsg =
      oauthCallbackState?.error ||
      'Unable to complete Google sign-in. Please return to sign in and try again.';
    const workspaceHref = session?.user?.role === 'admin' ? '/admin' : '/dashboard';

    return {
      html: `
        <div class="auth-wrap">
          <div class="card" id="oauth-callback-error-state" role="alert">
            <h1 class="page-title">Google sign-in incomplete</h1>
            <p class="page-subtitle" style="margin-bottom:16px;">${escapeHtml(errorMsg)}</p>
            ${
              session
                ? `<p style="font-size:13.5px; color:var(--color-text-secondary); margin-bottom:18px;">Your existing signed-in session was preserved.</p>`
                : ''
            }
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <a href="/login" data-link class="btn btn-primary" id="oauth-back-login">Back to sign in</a>
              <a href="/signup" data-link class="btn btn-secondary" id="oauth-create-account">Create account</a>
              ${
                session
                  ? `<a href="${workspaceHref}" data-link class="btn btn-secondary" id="oauth-existing-workspace">Return to workspace</a>`
                  : ''
              }
            </div>
          </div>
        </div>
      `,
      bind() {},
    };
  }

  return {
    html: `
      <div class="auth-wrap">
        <div class="card" id="oauth-callback-loading" role="status" aria-live="polite">
          <h1 class="page-title">Completing Google sign-in…</h1>
          <p class="page-subtitle" style="margin-bottom:0;">Verifying your Google account and loading your Kord workspace.</p>
        </div>
      </div>
    `,
    bind() {},
  };
}

