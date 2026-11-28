import { escapeHtml } from './formatters.js';
import {
  isSafeContentUrl,
  normalizeLessonBlock,
  validateNoUnsafeHtmlOrScript,
} from './contentPackage.js';

const PRACTICAL_BLOCK_TYPES = new Set(['example', 'case_study', 'demonstration']);

/**
 * Safely renders plain prose with optional lightweight inline emphasis
 * (`**bold**`, `*italic*`, `` `code` ``) by escaping HTML FIRST on every token.
 * Raw HTML tags or executable URIs can never be interpreted as markup.
 *
 * @param {string} rawText
 * @returns {string}
 */
export function renderInlineProseHtml(rawText) {
  const str = String(rawText ?? '');
  if (!str) return '';

  const parts = str.split(/(`[^`\n]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return `<code class="lesson-inline-code">${escapeHtml(part.slice(1, -1))}</code>`;
      }
      let safe = escapeHtml(part);
      safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
      return safe;
    })
    .join('');
}

/**
 * Splits a lesson's stored blocks and metadata into the structured sections
 * used by the redesigned learner lesson reader and admin preview.
 *
 * @param {Partial<import('../types/kord.d.ts').Lesson>} lesson
 */
export function splitLessonSections(lesson) {
  const blocks = Array.isArray(lesson?.blocks) ? lesson.blocks : [];
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const lectureBlocks = [];
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const practicalBlocks = [];
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const inlineChecks = [];
  /** @type {import('../types/kord.d.ts').VideoEntry[]} */
  const blockVideos = [];
  /** @type {import('../types/kord.d.ts').FurtherReadingItem[]} */
  const blockResources = [];

  blocks.forEach((blk) => {
    if (!blk || !blk.type) return;
    if (PRACTICAL_BLOCK_TYPES.has(blk.type)) {
      practicalBlocks.push(blk);
    } else if (blk.type === 'knowledge_check') {
      inlineChecks.push(blk);
    } else if (blk.type === 'video') {
      blockVideos.push(blk);
    } else if (blk.type === 'resource_download') {
      if (blk.url || blk.title) {
        blockResources.push({
          title: blk.title || 'Supplementary reference',
          url: blk.url || '',
          source: blk.description || '',
          resourceType: blk.formatLabel || 'Guide',
        });
      }
    } else {
      lectureBlocks.push(blk);
    }
  });

  const seenVideoKeys = new Set();
  /** @type {import('../types/kord.d.ts').VideoEntry[]} */
  const supplementaryVideos = [];
  [...(lesson?.videos || []), ...blockVideos].forEach((v) => {
    if (!v) return;
    const key = String(v.videoId || v.url || v.title || '').trim();
    if (!key || seenVideoKeys.has(key)) return;
    seenVideoKeys.add(key);
    supplementaryVideos.push(v);
  });

  const seenResKeys = new Set();
  /** @type {import('../types/kord.d.ts').FurtherReadingItem[]} */
  const supplementaryResources = [];
  [...(lesson?.furtherReading || []), ...blockResources].forEach((r) => {
    if (!r || (!r.url && !r.title)) return;
    const key = String(r.url || r.title).trim();
    if (!key || seenResKeys.has(key)) return;
    seenResKeys.add(key);
    supplementaryResources.push(r);
  });

  return {
    lectureBlocks,
    practicalBlocks,
    inlineChecks,
    supplementaryVideos,
    supplementaryResources,
  };
}

/**
 * Renders main instructional lecture blocks in an uninterrupted editorial flow:
 * readable prose, occasional headings, clean lists, tables, code, figures, and
 * understated definitions/notes without nested card or badge clutter.
 *
 * @param {import('../types/kord.d.ts').LessonBlock[]} blocks
 * @returns {string}
 */
export function renderEditorialLectureHtml(blocks = []) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';

  return blocks
    .map((blk) => {
      if (!blk || !blk.type) return '';
      switch (blk.type) {
        case 'heading': {
          const tag = Number(blk.level) === 3 ? 'h3' : 'h2';
          const cls = Number(blk.level) === 3 ? 'lesson-lecture-h3' : 'lesson-lecture-h2';
          return `<${tag} class="${cls}">${renderInlineProseHtml(blk.text || '')}</${tag}>`;
        }

        case 'paragraph':
          return `<p class="lesson-prose-p">${renderInlineProseHtml(blk.text || '')}</p>`;

        case 'steps':
          return `
            <div class="lesson-prose-list-wrap">
              ${blk.title ? `<h3 class="lesson-lecture-h3">${renderInlineProseHtml(blk.title)}</h3>` : ''}
              <ol class="lesson-prose-ordered">
                ${(blk.items || []).map((item) => `<li>${renderInlineProseHtml(item)}</li>`).join('')}
              </ol>
            </div>
          `;

        case 'bullets':
          return `
            <div class="lesson-prose-list-wrap">
              ${blk.title ? `<h3 class="lesson-lecture-h3">${renderInlineProseHtml(blk.title)}</h3>` : ''}
              <ul class="lesson-prose-bullets">
                ${(blk.items || []).map((item) => `<li>${renderInlineProseHtml(item)}</li>`).join('')}
              </ul>
            </div>
          `;

        case 'definition':
          return `
            <aside class="lesson-editorial-note lesson-editorial-definition">
              <p class="lesson-prose-p" style="margin:0;">
                <strong>${escapeHtml(blk.term || 'Key term')}:</strong>
                ${renderInlineProseHtml(blk.meaning || blk.text || '')}
              </p>
            </aside>
          `;

        case 'callout':
          return `
            <aside class="lesson-editorial-note">
              ${blk.title ? `<div class="lesson-editorial-note-title">${escapeHtml(blk.title)}</div>` : ''}
              <p class="lesson-prose-p" style="margin:0;">${renderInlineProseHtml(blk.text || '')}</p>
            </aside>
          `;

        case 'table':
          return `
            <div class="lesson-prose-block">
              ${blk.title ? `<h3 class="lesson-lecture-h3">${renderInlineProseHtml(blk.title)}</h3>` : ''}
              <div class="lesson-table-wrap">
                <table class="lesson-table">
                  <thead>
                    <tr>
                      ${(blk.headers || []).map((h) => `<th>${renderInlineProseHtml(h)}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${(blk.rows || [])
                      .map(
                        (row) => `<tr>${(row || []).map((cell) => `<td>${renderInlineProseHtml(cell)}</td>`).join('')}</tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;

        case 'code':
          return `
            <div class="lesson-prose-block">
              ${blk.title ? `<div class="lesson-code-caption">${escapeHtml(blk.title)}</div>` : ''}
              <pre class="lesson-code"><code>${escapeHtml(blk.code || '')}</code></pre>
            </div>
          `;

        case 'image': {
          const rawUrl = String(blk.url || '').trim();
          const check = rawUrl ? isSafeContentUrl(rawUrl, { allowRelative: true }) : { valid: false, url: '' };
          const safeUrl = check.valid && check.url ? check.url : '';
          return `
            <figure class="lesson-figure">
              ${
                safeUrl
                  ? `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(blk.alt || blk.title || 'Lesson illustration')}" referrerpolicy="no-referrer" />`
                  : `<div class="lesson-figure-placeholder">${escapeHtml(blk.alt || blk.title || 'Visual illustration')}</div>`
              }
              ${
                blk.caption || blk.title
                  ? `<figcaption>${escapeHtml(blk.caption || blk.title || '')}</figcaption>`
                  : ''
              }
            </figure>
          `;
        }

        default:
          return `<p class="lesson-prose-p">${renderInlineProseHtml(blk.text || '')}</p>`;
      }
    })
    .join('');
}

/**
 * Renders the dedicated Practical Application / Worked Example section cleanly.
 *
 * @param {import('../types/kord.d.ts').LessonBlock[]} practicalBlocks
 * @returns {string}
 */
export function renderEditorialPracticalHtml(practicalBlocks = []) {
  if (!Array.isArray(practicalBlocks) || practicalBlocks.length === 0) return '';

  return practicalBlocks
    .map((blk) => {
      if (blk.type === 'example') {
        return `
          <div class="lesson-practical-item">
            ${blk.title ? `<h3 class="lesson-lecture-h3" style="margin-top:0;">${escapeHtml(blk.title)}</h3>` : ''}
            <div class="lesson-prose-p lesson-preline">${renderInlineProseHtml(blk.body || '')}</div>
          </div>
        `;
      }
      if (blk.type === 'case_study') {
        return `
          <div class="lesson-practical-item">
            ${blk.title ? `<h3 class="lesson-lecture-h3" style="margin-top:0;">${escapeHtml(blk.title)}</h3>` : ''}
            <div class="lesson-prose-p lesson-preline">${renderInlineProseHtml(blk.scenario || blk.text || '')}</div>
            ${
              blk.takeaway
                ? `<p class="lesson-practical-outcome"><strong>Outcome:</strong> ${renderInlineProseHtml(blk.takeaway)}</p>`
                : ''
            }
          </div>
        `;
      }
      if (blk.type === 'demonstration') {
        return `
          <div class="lesson-practical-item">
            ${blk.title ? `<h3 class="lesson-lecture-h3" style="margin-top:0;">${escapeHtml(blk.title)}</h3>` : ''}
            <div class="lesson-prose-p lesson-preline">${renderInlineProseHtml(blk.instructions || '')}</div>
            ${
              blk.expectedOutcome
                ? `<p class="lesson-practical-outcome"><strong>Expected result:</strong> ${renderInlineProseHtml(blk.expectedOutcome)}</p>`
                : ''
            }
          </div>
        `;
      }
      return '';
    })
    .join('');
}

/**
 * Converts an existing Lesson (from seeded courses or rich-text authoring)
 * into clean 10-field Lesson Editor values.
 *
 * @param {Partial<import('../types/kord.d.ts').Lesson> | null} lesson
 */
export function lessonToEditorFields(lesson) {
  if (!lesson) {
    return {
      mainContentText: '## Core concepts\n\nWrite clear, connected paragraphs explaining the foundational concepts and why they matter.\n\n- Key principle one\n- Key principle two',
      practicalTitle: '',
      practicalBody: '',
      practicalOutcome: '',
      inlineChecks: /** @type {import('../types/kord.d.ts').LessonBlock[]} */ ([]),
    };
  }

  const { lectureBlocks, practicalBlocks, inlineChecks } = splitLessonSections(lesson);

  const mainLines = lectureBlocks
    .map((blk) => {
      switch (blk.type) {
        case 'heading':
          return `${Number(blk.level) === 3 ? '###' : '##'} ${String(blk.text || '').trim()}`;
        case 'paragraph':
          return String(blk.text || '').trim();
        case 'bullets': {
          const head = blk.title ? `### ${blk.title}\n` : '';
          const items = (blk.items || []).map((it) => `- ${it}`).join('\n');
          return `${head}${items}`.trim();
        }
        case 'steps': {
          const head = blk.title ? `### ${blk.title}\n` : '';
          const items = (blk.items || []).map((it, i) => `${i + 1}. ${it}`).join('\n');
          return `${head}${items}`.trim();
        }
        case 'definition':
          return `${blk.term || 'Term'} :: ${blk.meaning || blk.text || ''}`.trim();
        case 'callout':
          return blk.title
            ? `> ${blk.title}: ${String(blk.text || '').replace(/\n+/g, ' ')}`
            : `> ${String(blk.text || '').replace(/\n+/g, ' ')}`;
        case 'table': {
          const headers = (blk.headers || []).length ? blk.headers || [] : ['Column A', 'Column B'];
          const headerRow = `| ${headers.join(' | ')} |`;
          const sepRow = `| ${headers.map(() => '---').join(' | ')} |`;
          const bodyRows = (blk.rows || []).map((r) => `| ${(r || []).join(' | ')} |`);
          const titlePrefix = blk.title ? `### ${blk.title}\n` : '';
          return `${titlePrefix}${[headerRow, sepRow, ...bodyRows].join('\n')}`;
        }
        case 'code': {
          const lang = blk.language || 'text';
          const titlePrefix = blk.title ? `### ${blk.title}\n` : '';
          return `${titlePrefix}\`\`\`${lang}\n${blk.code || ''}\n\`\`\``;
        }
        case 'image': {
          const alt = blk.alt || blk.title || 'Illustration';
          const label = blk.caption ? `${alt}|${blk.caption}` : alt;
          return `![${label}](${blk.url || ''})`;
        }
        default:
          return String(blk.text || '').trim();
      }
    })
    .filter(Boolean);

  let practicalTitle = '';
  /** @type {string[]} */
  const bodySegments = [];
  /** @type {string[]} */
  const outcomeSegments = [];

  practicalBlocks.forEach((blk, idx) => {
    if (idx === 0 && blk.title) {
      practicalTitle = String(blk.title).trim();
    }
    if (blk.type === 'example') {
      const prefix = idx > 0 && blk.title ? `${blk.title}\n` : '';
      if (blk.body) bodySegments.push(`${prefix}${blk.body}`);
    } else if (blk.type === 'case_study') {
      const prefix = idx > 0 && blk.title ? `${blk.title}\n` : '';
      const scenario = blk.scenario || blk.text || '';
      if (scenario) bodySegments.push(`${prefix}${scenario}`);
      if (blk.takeaway) outcomeSegments.push(blk.takeaway);
    } else if (blk.type === 'demonstration') {
      const prefix = idx > 0 && blk.title ? `${blk.title}\n` : '';
      if (blk.instructions) bodySegments.push(`${prefix}${blk.instructions}`);
      if (blk.expectedOutcome) outcomeSegments.push(blk.expectedOutcome);
    }
  });

  return {
    mainContentText: mainLines.join('\n\n'),
    practicalTitle,
    practicalBody: bodySegments.join('\n\n'),
    practicalOutcome: outcomeSegments.join(' '),
    inlineChecks,
  };
}

/**
 * Parses clean structured rich-text authoring input + practical application fields
 * into validated canonical `LessonBlock[]` compatible with the database schema
 * and content package validator.
 *
 * @param {{
 *   mainContentText: string;
 *   practicalTitle?: string;
 *   practicalBody?: string;
 *   practicalOutcome?: string;
 *   preserveResources?: import('../types/kord.d.ts').FurtherReadingItem[];
 * }} input
 * @returns {import('../types/kord.d.ts').LessonBlock[]}
 */
export function richTextToLessonBlocks({
  mainContentText,
  practicalTitle = '',
  practicalBody = '',
  practicalOutcome = '',
}) {
  const issues = /** @type {import('../types/kord.d.ts').DryRunValidationIssue[]} */ ([]);
  const rawMain = String(mainContentText || '').replace(/\r\n/g, '\n');
  const lines = rawMain.split('\n');
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const blocks = [];

  let i = 0;
  let blockCounter = 1;
  const nextId = () => `blk-rt-${blockCounter++}`;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block ```lang
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || 'text';
      i += 1;
      /** @type {string[]} */
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i += 1;
      }
      blocks.push(
        normalizeLessonBlock({
          id: nextId(),
          type: 'code',
          title: '',
          language,
          code: codeLines.join('\n'),
        })
      );
      continue;
    }

    // Headings ## or ###
    const headingMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      validateNoUnsafeHtmlOrScript(text, 'mainContent', issues);
      blocks.push(normalizeLessonBlock({ id: nextId(), type: 'heading', level, text }));
      i += 1;
      continue;
    }

    // Image ![alt|caption](url) or ![alt](url)
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const rawAltParts = imgMatch[1].split('|');
      const alt = (rawAltParts[0] || '').trim();
      const caption = rawAltParts.slice(1).join('|').trim();
      const url = imgMatch[2].trim();
      const urlCheck = isSafeContentUrl(url, { allowRelative: true });
      if (!urlCheck.valid) {
        throw new Error(`Invalid image URL "${url}": ${urlCheck.error}`);
      }
      validateNoUnsafeHtmlOrScript(alt, 'image.alt', issues);
      validateNoUnsafeHtmlOrScript(caption, 'image.caption', issues);
      blocks.push(
        normalizeLessonBlock({
          id: nextId(),
          type: 'image',
          title: '',
          url: urlCheck.url || url,
          alt,
          caption,
        })
      );
      i += 1;
      continue;
    }

    // Markdown pipe table
    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      /** @type {string[][]} */
      const tableRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const rowLine = lines[i].trim();
        const cells = rowLine
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
        const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c));
        if (!isSeparator && cells.length > 0) {
          tableRows.push(cells);
        }
        i += 1;
      }
      if (tableRows.length > 0) {
        const headers = tableRows[0];
        const rows = tableRows.slice(1);
        headers.forEach((h) => validateNoUnsafeHtmlOrScript(h, 'table.header', issues));
        rows.forEach((r) => r.forEach((c) => validateNoUnsafeHtmlOrScript(c, 'table.cell', issues)));
        blocks.push(
          normalizeLessonBlock({
            id: nextId(),
            type: 'table',
            title: '',
            headers,
            rows,
          })
        );
      }
      continue;
    }

    // Definition line: Term :: Definition
    const defMatch = trimmed.match(/^([^:]{2,90})::\s*(.+)$/);
    if (defMatch) {
      const term = defMatch[1].trim();
      const meaning = defMatch[2].trim();
      validateNoUnsafeHtmlOrScript(term, 'definition.term', issues);
      validateNoUnsafeHtmlOrScript(meaning, 'definition.meaning', issues);
      blocks.push(normalizeLessonBlock({ id: nextId(), type: 'definition', term, meaning }));
      i += 1;
      continue;
    }

    // Callout / Note blockquote lines starting with >
    if (trimmed.startsWith('>')) {
      /** @type {string[]} */
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const joined = quoteLines.join(' ').trim();
      const titleMatch = joined.match(/^([A-Za-z0-9 &/'-]{2,40}):\s+(.+)$/);
      const title = titleMatch ? titleMatch[1].trim() : 'Important note';
      const text = titleMatch ? titleMatch[2].trim() : joined;
      validateNoUnsafeHtmlOrScript(title, 'callout.title', issues);
      validateNoUnsafeHtmlOrScript(text, 'callout.text', issues);
      blocks.push(normalizeLessonBlock({ id: nextId(), type: 'callout', title, text }));
      continue;
    }

    // Ordered steps (1. item)
    if (/^\d+[.)]\s+/.test(trimmed)) {
      /** @type {string[]} */
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+[.)]\s+/, '').trim();
        if (itemText) {
          validateNoUnsafeHtmlOrScript(itemText, 'steps.item', issues);
          items.push(itemText);
        }
        i += 1;
      }
      if (items.length > 0) {
        blocks.push(normalizeLessonBlock({ id: nextId(), type: 'steps', title: '', items }));
      }
      continue;
    }

    // Bullet list (- item or * item)
    if (/^[-*]\s+/.test(trimmed)) {
      /** @type {string[]} */
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, '').trim();
        if (itemText) {
          validateNoUnsafeHtmlOrScript(itemText, 'bullets.item', issues);
          items.push(itemText);
        }
        i += 1;
      }
      if (items.length > 0) {
        blocks.push(normalizeLessonBlock({ id: nextId(), type: 'bullets', title: '', items }));
      }
      continue;
    }

    // Standard connected paragraph
    /** @type {string[]} */
    const paraLines = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (
        !cur ||
        cur.startsWith('```') ||
        /^#{2,3}\s+/.test(cur) ||
        /^!\[[^\]]*\]\([^)]+\)$/.test(cur) ||
        (cur.startsWith('|') && cur.includes('|', 1)) ||
        /^([^:]{2,90})::\s*(.+)$/.test(cur) ||
        cur.startsWith('>') ||
        /^\d+[.)]\s+/.test(cur) ||
        /^[-*]\s+/.test(cur)
      ) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }
    const paraText = paraLines.join(' ').trim();
    if (paraText) {
      validateNoUnsafeHtmlOrScript(paraText, 'paragraph', issues);
      blocks.push(normalizeLessonBlock({ id: nextId(), type: 'paragraph', text: paraText }));
    }
  }

  // Dedicated Practical Application block (Section 5)
  const cleanPracticalTitle = String(practicalTitle || '').trim();
  const cleanPracticalBody = String(practicalBody || '').trim();
  const cleanPracticalOutcome = String(practicalOutcome || '').trim();
  validateNoUnsafeHtmlOrScript(cleanPracticalTitle, 'practicalTitle', issues);
  validateNoUnsafeHtmlOrScript(cleanPracticalBody, 'practicalBody', issues);
  validateNoUnsafeHtmlOrScript(cleanPracticalOutcome, 'practicalOutcome', issues);

  if (cleanPracticalBody || cleanPracticalOutcome) {
    if (cleanPracticalOutcome) {
      blocks.push(
        normalizeLessonBlock({
          id: nextId(),
          type: 'demonstration',
          title: cleanPracticalTitle || 'Practical application',
          instructions: cleanPracticalBody || cleanPracticalOutcome,
          expectedOutcome: cleanPracticalOutcome,
        })
      );
    } else {
      blocks.push(
        normalizeLessonBlock({
          id: nextId(),
          type: 'example',
          title: cleanPracticalTitle || 'Worked example',
          body: cleanPracticalBody,
        })
      );
    }
  }

  if (issues.length > 0) {
    throw new Error(issues[0].message || 'Unsafe markup detected in lesson content.');
  }

  return blocks;
}
