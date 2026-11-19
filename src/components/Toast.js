import { escapeHtml } from '../lib/formatters.js';
import { icon } from '../lib/icons.js';

let container = null;

function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'toast-stack';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'false');
  document.body.appendChild(container);
  return container;
}

export function showToast(message, variant = 'info', duration = 3800) {
  const stack = ensureContainer();
  const el = document.createElement('div');
  const variantClass =
    variant === 'success' ? 'toast-success' : variant === 'error' ? 'toast-error' : '';
  el.className = `toast ${variantClass}`.trim();
  el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button type="button" class="toast-close" aria-label="Dismiss notification">
      ${icon('x', 15)}
    </button>
  `;

  const remove = () => {
    if (el.parentNode) el.parentNode.removeChild(el);
  };

  el.querySelector('.toast-close')?.addEventListener('click', remove);
  stack.appendChild(el);

  if (duration > 0) {
    window.setTimeout(remove, duration);
  }
}
