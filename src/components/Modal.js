import { escapeHtml } from '../lib/formatters.js';
import { icon } from '../lib/icons.js';

let activeBackdrop = null;

export function closeModal() {
  if (activeBackdrop && activeBackdrop.parentNode) {
    activeBackdrop.parentNode.removeChild(activeBackdrop);
  }
  activeBackdrop = null;
}

export function openModal({ title, bodyHtml, onMount }) {
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
      document.removeEventListener('keydown', onKeyDown);
      closeModal();
    }
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-modal-close]')) {
      document.removeEventListener('keydown', onKeyDown);
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
