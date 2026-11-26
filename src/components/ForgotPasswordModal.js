import { openModal } from './Modal.js';
import { showToast } from './Toast.js';
import { recoverPassword } from '../lib/repositories/authRepository.js';
import { validateForgotPasswordForm } from '../lib/validators.js';
import { escapeHtml } from '../lib/formatters.js';
import { icon } from '../lib/icons.js';

/**
 * @param {HTMLInputElement | null} inputEl
 * @param {boolean} isInvalid
 */
function setInputInvalidState(inputEl, isInvalid) {
  if (!inputEl) return;
  if (inputEl.classList && typeof inputEl.classList.toggle === 'function') {
    inputEl.classList.toggle('is-invalid', isInvalid);
  } else {
    const tokens = String(inputEl.className || '')
      .split(/\s+/)
      .filter((cls) => cls && cls !== 'is-invalid');
    if (isInvalid) tokens.push('is-invalid');
    inputEl.className = tokens.join(' ');
  }
  inputEl.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
}

/**
 * @param {string} [initialEmail]
 */
export function renderForgotPasswordFormBody(initialEmail = '') {
  return `
    <p class="page-subtitle" style="margin-top:0; margin-bottom:18px;">
      Enter the email address associated with your Kord account and we will send password reset instructions.
    </p>

    <form id="forgot-password-modal-form" class="form-stack" novalidate>
      <div class="field">
        <label class="field-label" for="forgot-modal-email">Email address</label>
        <input
          class="input"
          id="forgot-modal-email"
          name="email"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          value="${escapeHtml(initialEmail)}"
          aria-describedby="forgot-modal-email-error"
          aria-invalid="false"
          required
        />
        <div class="field-error" id="forgot-modal-email-error" data-error-for="email" role="alert"></div>
      </div>

      <div class="field-error" id="forgot-modal-form-error" role="alert"></div>

      <div class="modal-actions-row">
        <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn-primary" id="forgot-modal-submit">Send reset link</button>
      </div>
    </form>
  `;
}

/**
 * @param {{ email: string, note?: string }} params
 */
export function renderForgotPasswordSuccessBody({ email, note = '' }) {
  const safeEmail = escapeHtml(email);
  const message =
    note ||
    'Open the recovery link in your email to choose a new password. If you do not see it within a few minutes, check your spam folder.';

  return `
    <div class="modal-feedback-success" role="status" aria-live="polite" id="forgot-modal-success">
      <div class="modal-feedback-header">
        <span class="modal-feedback-icon" aria-hidden="true">${icon('checkCircle', 20)}</span>
        <strong class="modal-feedback-title">Reset instructions sent</strong>
      </div>
      <p class="modal-feedback-copy">
        Recovery instructions were processed for <strong>${safeEmail}</strong>. ${escapeHtml(message)}
      </p>
    </div>

    <div class="modal-actions-row" style="margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="forgot-modal-try-another">Try a different email</button>
      <button type="button" class="btn btn-primary" data-modal-close id="forgot-modal-done">Done</button>
    </div>
  `;
}

/**
 * @typedef {Object} RecoveryAuthAdapter
 * @property {(email: string) => Promise<{ sent?: boolean, email?: string, note?: string }>} [recoverPassword]
 * @property {(email: string) => Promise<{ sent?: boolean, email?: string, note?: string }>} [requestPasswordReset]
 */

/**
 * @param {{
 *   initialEmail?: string,
 *   auth?: RecoveryAuthAdapter | null,
 *   onSuccess?: ((payload: { email: string, result: { sent?: boolean, email?: string, note?: string } }) => void) | null,
 *   onClose?: (() => void) | null,
 * }} [options]
 */
export function openForgotPasswordModal({
  initialEmail = '',
  auth = null,
  onSuccess = null,
  onClose = null,
} = {}) {
  const cleanInitial = String(initialEmail || '').trim();
  const doRecover =
    auth?.recoverPassword || auth?.requestPasswordReset || recoverPassword;

  /**
   * @param {HTMLElement | null} bodyEl
   * @param {string} seedEmail
   */
  function mountForm(bodyEl, seedEmail) {
    if (!bodyEl) return;
    bodyEl.innerHTML = renderForgotPasswordFormBody(seedEmail);

    const form = /** @type {HTMLFormElement | null} */ (
      bodyEl.querySelector('#forgot-password-modal-form')
    );
    const emailInput = /** @type {HTMLInputElement | null} */ (
      bodyEl.querySelector('#forgot-modal-email')
    );
    const emailErr = bodyEl.querySelector('[data-error-for="email"]');
    const formErr = bodyEl.querySelector('#forgot-modal-form-error');
    const submitBtn = /** @type {HTMLButtonElement | null} */ (
      bodyEl.querySelector('#forgot-modal-submit')
    );

    let submitting = false;

    emailInput?.focus?.();

    emailInput?.addEventListener('input', () => {
      if (emailErr && emailErr.textContent) {
        emailErr.textContent = '';
      }
      if (formErr && formErr.textContent) {
        formErr.textContent = '';
      }
      setInputInvalidState(emailInput, false);
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;

      const fd = new FormData(form);
      const rawEmail = String(
        fd.get('email') ?? emailInput?.value ?? ''
      ).trim();

      if (formErr) formErr.textContent = '';
      const errors = validateForgotPasswordForm({ email: rawEmail });
      if (emailErr) {
        emailErr.textContent = errors.email || '';
      }
      if (errors.email) {
        setInputInvalidState(emailInput, true);
        emailInput?.focus?.();
        return;
      }

      setInputInvalidState(emailInput, false);
      submitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending reset link…';
      }
      if (emailInput) {
        emailInput.disabled = true;
      }

      try {
        const res = await doRecover(rawEmail);
        showToast('Password reset instructions sent.', 'success');

        bodyEl.innerHTML = renderForgotPasswordSuccessBody({
          email: rawEmail,
          note: res?.note || '',
        });

        const tryAnotherBtn = /** @type {HTMLButtonElement | null} */ (
          bodyEl.querySelector('#forgot-modal-try-another')
        );
        tryAnotherBtn?.addEventListener('click', () => {
          mountForm(bodyEl, '');
        });

        const doneBtn = /** @type {HTMLButtonElement | null} */ (
          bodyEl.querySelector('#forgot-modal-done')
        );
        doneBtn?.focus?.();

        if (typeof onSuccess === 'function') {
          onSuccess({ email: rawEmail, result: res });
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to send reset instructions. Please try again.';
        if (formErr) {
          formErr.textContent = errorMessage;
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send reset link';
        }
        if (emailInput) {
          emailInput.disabled = false;
          emailInput.focus?.();
        }
      } finally {
        submitting = false;
      }
    });
  }

  openModal({
    title: 'Reset your password',
    bodyHtml: renderForgotPasswordFormBody(cleanInitial),
    onClose,
    /** @param {HTMLElement | null} bodyEl */
    onMount(bodyEl) {
      mountForm(bodyEl, cleanInitial);
    },
  });
}
