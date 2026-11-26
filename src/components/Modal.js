import { escapeHtml } from '../lib/formatters.js';
import { icon } from '../lib/icons.js';

let activeBackdrop = null;
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
    if (e.target === backdrop || e.target.closest?.('[data-modal-close]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;

  if (typeof onMount === 'function') {
    onMount(backdrop.querySelector('.modal-body'), closeModal);
  }
}
