import {
  signIn,
  signUp,
  requestPasswordReset,
  updatePassword,
  isPasswordRecoveryMode,
} from '../../lib/repositories/authRepository.js';
import { isValidEmail, validateLoginForm, validateSignupForm } from '../../lib/validators.js';
import { showToast } from '../../components/Toast.js';

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

            <div class="field">
              <label class="field-label" for="login-password">Password</label>
              <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="At least 6 characters" required />
              <div class="field-error" data-error-for="password"></div>
            </div>

            <div class="field-error" id="login-form-error" role="alert"></div>

            <button type="submit" class="btn btn-primary" id="login-submit">Sign in</button>
          </form>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:18px; font-size:14px;">
            <a href="/forgot-password" data-link>Forgot password?</a>
            <a href="/signup" data-link>Create account</a>
          </div>
        </div>
      </div>
    `,
    bind(root) {
      const form = root.querySelector('#login-form');
      const submitBtn = root.querySelector('#login-submit');
      const formErr = root.querySelector('#login-form-error');

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        formErr.textContent = '';
        const fd = new FormData(form);
        const payload = {
          email: String(fd.get('email') || ''),
          password: String(fd.get('password') || ''),
        };

        const errors = validateLoginForm(payload);
        root.querySelector('[data-error-for="email"]').textContent = errors.email || '';
        root.querySelector('[data-error-for="password"]').textContent = errors.password || '';
        if (Object.keys(errors).length > 0) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';
        try {
          const session = await doSignIn(payload);
          showToast('Signed in successfully.', 'success');
          navigate(session?.user?.role === 'admin' ? '/admin' : '/dashboard');
        } catch (err) {
          formErr.textContent = err.message || 'Sign in failed.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign in';
        }
      });
    },
  };
}

export function renderSignupPage({ navigate }) {
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

            <div class="field">
              <label class="field-label" for="signup-password">Password</label>
              <input class="input" id="signup-password" name="password" type="password" autocomplete="new-password" placeholder="At least 6 characters" required />
              <div class="field-error" data-error-for="password"></div>
            </div>

            <div class="field">
              <label class="field-label" for="signup-confirm">Confirm password</label>
              <input class="input" id="signup-confirm" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Repeat password" required />
              <div class="field-error" data-error-for="confirmPassword"></div>
            </div>

            <div class="field-error" id="signup-form-error" role="alert"></div>

            <button type="submit" class="btn btn-primary" id="signup-submit">Create account</button>
          </form>

          <div style="margin-top:18px; font-size:14px; text-align:center;">
            Already have an account? <a href="/login" data-link>Sign in</a>
          </div>
        </div>
      </div>
    `,
    bind(root) {
      const form = root.querySelector('#signup-form');
      const submitBtn = root.querySelector('#signup-submit');
      const formErr = root.querySelector('#signup-form-error');

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        formErr.textContent = '';
        const fd = new FormData(form);
        const payload = {
          firstName: String(fd.get('firstName') || ''),
          lastName: String(fd.get('lastName') || ''),
          email: String(fd.get('email') || ''),
          password: String(fd.get('password') || ''),
          confirmPassword: String(fd.get('confirmPassword') || ''),
        };

        const errors = validateSignupForm(payload);
        ['firstName', 'lastName', 'email', 'password', 'confirmPassword'].forEach((k) => {
          root.querySelector(`[data-error-for="${k}"]`).textContent = errors[k] || '';
        });
        if (Object.keys(errors).length > 0) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account…';
        try {
          const session = await signUp(payload);
          showToast('Account created.', 'success');
          navigate(session?.user?.role === 'admin' ? '/admin' : '/dashboard');
        } catch (err) {
          formErr.textContent = err.message || 'Unable to create account.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create account';
        }
      });
    },
  };
}

export function renderForgotPasswordPage() {
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

            <div id="reset-feedback" style="font-size:14px;"></div>

            <button type="submit" class="btn btn-primary" id="reset-submit">Send reset link</button>
          </form>

          <div style="margin-top:16px; font-size:14px;">
            <a href="/login" data-link>← Back to sign in</a>
          </div>
        </div>
      </div>
    `,
    bind(root) {
      const form = root.querySelector('#reset-form');
      const submitBtn = root.querySelector('#reset-submit');
      const feedback = root.querySelector('#reset-feedback');

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = String(new FormData(form).get('email') || '').trim();
        const errEl = root.querySelector('[data-error-for="email"]');
        errEl.textContent = isValidEmail(email) ? '' : 'Enter a valid email address.';
        if (!isValidEmail(email)) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
        try {
          const res = await requestPasswordReset(email);
          feedback.style.color = 'var(--color-green)';
          feedback.textContent = res.note || 'Reset instructions sent. Check your inbox.';
          showToast('Reset request processed.', 'success');
        } catch (err) {
          feedback.style.color = 'var(--color-red)';
          feedback.textContent = err.message || 'Unable to process request.';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send reset link';
        }
      });
    },
  };
}

export function renderResetPasswordPage({ navigate, session, auth = null }) {
  const checkRecovery = auth?.isPasswordRecoveryMode || isPasswordRecoveryMode;
  const doUpdatePassword = auth?.updatePassword || updatePassword;
  const canUpdate = Boolean(session || checkRecovery());

  if (!canUpdate) {
    return {
      html: `
        <div class="auth-wrap">
          <div class="card">
            <h1 class="page-title">Reset password link required</h1>
            <p class="page-subtitle" style="margin-bottom:20px;">Open this page from a valid password recovery link or request a new reset email.</p>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <a href="/forgot-password" data-link class="btn btn-primary">Request reset link</a>
              <a href="/login" data-link class="btn btn-secondary">Back to sign in</a>
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
        <div class="card">
          <h1 class="page-title">Set a new password</h1>
          <p class="page-subtitle" style="margin-bottom:20px;">Choose a new password for your Kord account.</p>

          <form id="update-password-form" class="form-stack" novalidate>
            <div class="field">
              <label class="field-label" for="new-password">New password</label>
              <input class="input" id="new-password" name="password" type="password" autocomplete="new-password" placeholder="At least 6 characters" required />
              <div class="field-error" data-error-for="password"></div>
            </div>

            <div class="field">
              <label class="field-label" for="confirm-new-password">Confirm new password</label>
              <input class="input" id="confirm-new-password" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Repeat new password" required />
              <div class="field-error" data-error-for="confirmPassword"></div>
            </div>

            <div class="field-error" id="update-password-error" role="alert"></div>

            <button type="submit" class="btn btn-primary" id="update-password-submit">Update password</button>
          </form>
        </div>
      </div>
    `,
    bind(root) {
      const form = root.querySelector('#update-password-form');
      const submitBtn = root.querySelector('#update-password-submit');
      const formErr = root.querySelector('#update-password-error');

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        formErr.textContent = '';
        const fd = new FormData(form);
        const password = String(fd.get('password') || '');
        const confirmPassword = String(fd.get('confirmPassword') || '');

        const passErr = password.length < 6 ? 'Password must be at least 6 characters.' : '';
        const confirmErr = password !== confirmPassword ? 'Passwords do not match.' : '';
        root.querySelector('[data-error-for="password"]').textContent = passErr;
        root.querySelector('[data-error-for="confirmPassword"]').textContent = confirmErr;
        if (passErr || confirmErr) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating…';
        try {
          const updatedSession = await doUpdatePassword(password);
          showToast('Password updated.', 'success');
          navigate(
            updatedSession?.user?.role === 'admin'
              ? '/admin'
              : updatedSession
                ? '/dashboard'
                : '/login'
          );
        } catch (err) {
          formErr.textContent = err.message || 'Unable to update password.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update password';
        }
      });
    },
  };
}
