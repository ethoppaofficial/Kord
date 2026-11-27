import { escapeHtml } from '../lib/formatters.js';
import { icon } from '../lib/icons.js';

/** @type {HTMLDivElement | null} */
let activeBackdrop = null;
/** @type {(() => void) | null} */
let activeCleanup = null;

export function closeModal() {
  const cleanup = activeCleanup;
  activeCleanup = null;
  if (typeof cleanup === 'function') {
    cleanup();
  }
  if (activeBackdrop && activeBackdrop.parentNode) {
    activeBackdrop.parentNode.removeChild(activeBackdrop);
  }
  activeBackdrop = null;
}

/**
 * @param {{
 *   title: string;
 *   bodyHtml: string;
 *   onMount?: ((bodyEl: HTMLElement | null, close: () => void) => void) | null;
 *   onClose?: (() => void) | null;
 * }} params
 */
export function openModal({ title, bodyHtml, onMount, onClose }) {
  closeModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="kord-modal-title">
      <div class="modal-header">
        <h2 id="kord-modal-title" style="font-size: 1.25rem;">${escapeHtml(title)}</h2>
        <button type="button" class="btn btn-ghost btn-sm" data-modal-close aria-label="Close dialog">
          ${icon('x', 18)}
        </button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;

  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };

  activeCleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  backdrop.addEventListener('click', (e) => {
    const target = /** @type {Element | null} */ (e.target);
    if (target === backdrop || target?.closest?.('[data-modal-close]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;

  if (typeof onMount === 'function') {
    onMount(/** @type {HTMLElement | null} */ (backdrop.querySelector('.modal-body')), closeModal);
  }
}
