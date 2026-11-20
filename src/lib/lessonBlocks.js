import { escapeHtml } from './formatters.js';
import { renderVideoPlayerHtml } from './videoProvider.js';

export const BLOCK_TYPE_CATALOG = [
  { type: 'heading', label: 'Subheading' },
  { type: 'paragraph', label: 'Explanation paragraph' },
  { type: 'steps', label: 'Numbered steps' },
  { type: 'bullets', label: 'Bullet list' },
  { type: 'definition', label: 'Key definition' },
  { type: 'example', label: 'Worked example' },
  { type: 'case_study', label: 'Case study' },
  { type: 'table', label: 'Comparison table' },
  { type: 'callout', label: 'Important note' },
  { type: 'demonstration', label: 'Practical demonstration' },
  { type: 'code', label: 'Code / template snippet' },
  { type: 'image', label: 'Illustration / diagram' },
  { type: 'video', label: 'Embedded YouTube video' },
  { type: 'resource_download', label: 'Downloadable / study reference' },
  { type: 'knowledge_check', label: 'Inline knowledge check' },
];

export function createEmptyBlock(type) {
  const id = `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  switch (type) {
    case 'heading':
      return { id, type: 'heading', text: 'Section heading' };
    case 'paragraph':
      return { id, type: 'paragraph', text: '' };
    case 'steps':
      return { id, type: 'steps', title: 'Step-by-step walkthrough', items: ['Step 1', 'Step 2'] };
    case 'bullets':
      return { id, type: 'bullets', title: 'Key points', items: ['Point 1', 'Point 2'] };
    case 'definition':
      return { id, type: 'definition', term: 'Term', meaning: 'Clear definition.' };
    case 'example':
      return { id, type: 'example', title: 'Real-world example', body: '' };
    case 'case_study':
      return { id, type: 'case_study', title: 'Case study', scenario: '', takeaway: '' };
    case 'table':
      return { id, type: 'table', title: 'Comparison', headers: ['Column A', 'Column B'], rows: [['Value 1', 'Value 2']] };
    case 'callout':
      return { id, type: 'callout', title: 'Important note', text: '' };
    case 'demonstration':
      return { id, type: 'demonstration', title: 'Practical demonstration', instructions: '', expectedOutcome: '' };
    case 'code':
      return { id, type: 'code', title: 'Template / Code', language: 'text', code: '' };
    case 'image':
      return { id, type: 'image', title: 'Concept illustration', url: '', alt: '', caption: '' };
    case 'video':
      return { id, type: 'video', provider: 'youtube', videoId: '', url: '', title: '', description: '', duration: '', transcript: '', viewingInstructions: '' };
    case 'resource_download':
      return { id, type: 'resource_download', title: 'Reference guide', description: '', url: '', formatLabel: 'Guide' };
    case 'knowledge_check':
      return { id, type: 'knowledge_check', prompt: 'Quick check question?', options: ['Option A', 'Option B'], correctIndex: 0, explanation: '' };
    default:
      return { id, type: 'paragraph', text: '' };
  }
}

/**
 * Safe XSS-free JSON content block renderer.
 * Never evaluates raw HTML strings; every field passes through escapeHtml.
 */
export function renderLessonBlocks(blocks = []) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';

  return blocks
    .map((blk, idx) => {
      if (!blk || !blk.type) return '';
      switch (blk.type) {
        case 'heading':
          return `<h3 class="lesson-subheading">${escapeHtml(blk.text || '')}</h3>`;

        case 'paragraph':
          return `<p class="lesson-paragraph">${escapeHtml(blk.text || '')}</p>`;

        case 'steps':
          return `
            <div class="lesson-block">
              ${blk.title ? `<h4 class="lesson-block-title">${escapeHtml(blk.title)}</h4>` : ''}
              <ol class="lesson-ordered">
                ${(blk.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ol>
            </div>
          `;

        case 'bullets':
          return `
            <div class="lesson-block">
              ${blk.title ? `<h4 class="lesson-block-title">${escapeHtml(blk.title)}</h4>` : ''}
              <ul class="lesson-bullets">
                ${(blk.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          `;

        case 'definition':
          return `
            <div class="lesson-callout lesson-definition">
              <div class="lesson-callout-kicker">Definition</div>
              <div style="font-weight:700; color:var(--color-navy); margin-bottom:4px;">${escapeHtml(blk.term || '')}</div>
              <p style="font-size:14px; color:var(--color-text-secondary);">${escapeHtml(blk.meaning || '')}</p>
            </div>
          `;

        case 'example':
          return `
            <div class="lesson-callout">
              <div class="lesson-callout-kicker">Worked example</div>
              ${blk.title ? `<div style="font-weight:700; color:var(--color-navy); margin-bottom:4px;">${escapeHtml(blk.title)}</div>` : ''}
              <p style="font-size:14px; color:var(--color-text-secondary); white-space:pre-line;">${escapeHtml(blk.body || '')}</p>
            </div>
          `;

        case 'case_study':
          return `
            <div class="lesson-callout lesson-case-study">
              <div class="lesson-callout-kicker">Case study</div>
              <div style="font-weight:700; color:var(--color-navy); margin-bottom:6px;">${escapeHtml(blk.title || 'Applied Case')}</div>
              <p style="font-size:14px; color:var(--color-text-secondary); white-space:pre-line;">${escapeHtml(blk.scenario || '')}</p>
              ${
                blk.takeaway
                  ? `<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--color-border); font-size:13px; color:var(--color-navy);">
                      <strong>Outcome &amp; takeaway:</strong> ${escapeHtml(blk.takeaway)}
                    </div>`
                  : ''
              }
            </div>
          `;

        case 'table':
          return `
            <div class="lesson-block">
              ${blk.title ? `<h4 class="lesson-block-title">${escapeHtml(blk.title)}</h4>` : ''}
              <div style="overflow-x:auto; border:1px solid var(--color-border); border-radius:var(--radius-sm);">
                <table class="lesson-table">
                  <thead>
                    <tr>
                      ${(blk.headers || []).map((h) => `<th>${escapeHtml(h)}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${(blk.rows || [])
                      .map(
                        (row) => `<tr>${(row || []).map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;

        case 'callout':
          return `
            <div class="lesson-callout lesson-note">
              <div class="lesson-callout-kicker">${escapeHtml(blk.title || 'Important note')}</div>
              <p style="font-size:14px; color:var(--color-navy);">${escapeHtml(blk.text || '')}</p>
            </div>
          `;

        case 'demonstration':
          return `
            <div class="lesson-callout">
              <div class="lesson-callout-kicker">Practical demonstration</div>
              <div style="font-weight:700; color:var(--color-navy); margin-bottom:6px;">${escapeHtml(blk.title || 'Try it yourself')}</div>
              <p style="font-size:14px; color:var(--color-text-secondary); white-space:pre-line;">${escapeHtml(blk.instructions || '')}</p>
              ${
                blk.expectedOutcome
                  ? `<p style="margin-top:8px; font-size:13px; color:var(--color-text-muted);"><strong>Expected output:</strong> ${escapeHtml(blk.expectedOutcome)}</p>`
                  : ''
              }
            </div>
          `;

        case 'code':
          return `
            <div class="lesson-block">
              ${blk.title ? `<h4 class="lesson-block-title">${escapeHtml(blk.title)}</h4>` : ''}
              <pre class="lesson-code"><code>${escapeHtml(blk.code || '')}</code></pre>
            </div>
          `;

        case 'image': {
          const rawUrl = String(blk.url || '').trim();
          const safeUrl = rawUrl.startsWith('/') || rawUrl.startsWith('https://') ? rawUrl : '';
          return `
            <figure class="lesson-block" style="margin:14px 0;">
              ${blk.title ? `<h4 class="lesson-block-title">${escapeHtml(blk.title)}</h4>` : ''}
              ${
                safeUrl
                  ? `<div style="border:1px solid var(--color-border); border-radius:var(--radius-sm); overflow:hidden; background:var(--color-bg);">
                      <img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(blk.alt || blk.title || 'Lesson illustration')}" referrerpolicy="no-referrer" style="width:100%; max-height:360px; object-fit:cover; display:block;" />
                    </div>`
                  : `<div style="padding:16px; border:1px dashed var(--color-border); border-radius:var(--radius-sm); font-size:13px; color:var(--color-text-muted);">Illustration reference: ${escapeHtml(blk.alt || blk.title || 'Visual diagram')}</div>`
              }
              ${blk.caption ? `<figcaption style="font-size:12.5px; color:var(--color-text-muted); margin-top:6px;">${escapeHtml(blk.caption)}</figcaption>` : ''}
            </figure>
          `;
        }

        case 'video':
          return renderVideoPlayerHtml(blk, idx);

        case 'resource_download':
          return `
            <div class="lesson-resource">
              <div>
                <div style="font-weight:600; font-size:14px; color:var(--color-navy);">${escapeHtml(blk.title || 'Study Resource')}</div>
                <div style="font-size:13px; color:var(--color-text-secondary);">${escapeHtml(blk.description || '')}</div>
              </div>
              ${
                blk.url
                  ? `<a href="${escapeHtml(blk.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">${escapeHtml(blk.formatLabel || 'Open resource')}</a>`
                  : `<span class="status-tag status-neutral">${escapeHtml(blk.formatLabel || 'Included')}</span>`
              }
            </div>
          `;

        case 'knowledge_check': {
          const kcId = escapeHtml(blk.id || `kc-${idx}`);
          return `
            <div class="lesson-kc card-workspace" data-inline-kc="${kcId}" data-correct="${Number(blk.correctIndex || 0)}" data-explanation="${escapeHtml(blk.explanation || 'Review the explanation above.')}">
              <div class="lesson-callout-kicker">Quick knowledge check</div>
              <div style="font-weight:600; color:var(--color-navy); margin-bottom:10px;">${escapeHtml(blk.prompt || '')}</div>
              <div style="display:flex; flex-direction:column; gap:6px;">
                ${(blk.options || [])
                  .map(
                    (opt, oIdx) => `
                  <label class="quiz-option" style="padding:8px 11px;">
                    <input type="radio" name="inline_kc_${kcId}" value="${oIdx}" />
                    <span style="font-size:14px;">${escapeHtml(opt)}</span>
                  </label>
                `
                  )
                  .join('')}
              </div>
              <div style="display:flex; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap;">
                <button type="button" class="btn btn-primary btn-sm" data-check-kc="${kcId}">Check answer</button>
                <span data-kc-feedback="${kcId}" style="font-size:13px;"></span>
              </div>
            </div>
          `;
        }

        default:
          return `<p class="lesson-paragraph">${escapeHtml(blk.text || '')}</p>`;
      }
    })
    .join('');
}
