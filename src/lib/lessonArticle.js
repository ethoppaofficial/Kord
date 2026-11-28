import { escapeHtml } from './formatters.js';
import { isSafeContentUrl, normalizeLessonBlock } from './contentPackage.js';
import { renderVideoPlayerHtml, normalizeVideoEntry } from './videoProvider.js';

const PLACEHOLDER_SNIPPETS = [
  'explain the foundational principle clearly here',
  'core concept overview',
  'quick check question?',
  'enter heading text',
  'enter paragraph text',
  'worked example text',
];

/**
 * Escapes all raw HTML first, then applies strict allowlisted inline tokens:
 * **bold**, *italic*, `inline code`, and [label](https://...).
 * Never renders arbitrary HTML tags or unsafe URI schemes.
 *
 * @param {unknown} rawText
 * @returns {string}
 */
export function renderFormattedInlineText(rawText) {
  const text = String(rawText ?? '');
  if (!text) return '';

  const tokenRegex =
    /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let out = '';
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out += escapeHtml(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      out += `<code class="lesson-inline-code">${escapeHtml(match[1])}</code>`;
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const urlCheck = isSafeContentUrl(match[3], { allowRelative: false });
      if (urlCheck.valid && urlCheck.url) {
        out += `<a href="${escapeHtml(urlCheck.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[2])}</a>`;
      } else {
        out += escapeHtml(match[0]);
      }
    } else if (match[4] !== undefined) {
      out += `<strong>${escapeHtml(match[4])}</strong>`;
    } else if (match[5] !== undefined) {
      out += `<em>${escapeHtml(match[5])}</em>`;
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    out += escapeHtml(text.slice(lastIndex));
  }

  return out;
}

/**
 * Decodes common HTML entities back to plain text safely before re-escaping or storing.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * Strips dangerous tags, comments, event handlers, style attributes, and unsafe URLs
 * using a pure-JS tokenizer (works identically in Browser and Node.js tests).
 *
 * @param {string} rawHtml
 * @returns {string}
 */
export function sanitizeRichTextHtml(rawHtml) {
  let html = String(rawHtml || '');
  if (!html.trim()) return '';

  // Remove HTML comments & dangerous container elements completely with their inner content
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(
    /<\s*(script|style|svg|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,
    ''
  );
  html = html.replace(/<\s*(script|style|svg|iframe|object|embed|noscript|template)\b[^>]*\/?>/gi, '');

  const ALLOWED_TAGS = new Set([
    'h1',
    'h2',
    'h3',
    'h4',
    'p',
    'div',
    'blockquote',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'pre',
    'code',
    'strong',
    'b',
    'em',
    'i',
    'a',
    'br',
    'hr',
  ]);

  const SELF_CLOSING = new Set(['br', 'hr']);

  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (full, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    const isClosing = full.startsWith('</');
    if (!ALLOWED_TAGS.has(tag)) {
      return '';
    }
    if (isClosing) {
      return SELF_CLOSING.has(tag) ? '' : `</${tag}>`;
    }
    if (SELF_CLOSING.has(tag)) {
      return `<${tag}>`;
    }
    if (tag === 'a') {
      const hrefMatch = String(rawAttrs || '').match(
        /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
      );
      const rawHref = decodeHtmlEntities(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '');
      const urlCheck = isSafeContentUrl(rawHref, { allowRelative: false });
      if (urlCheck.valid && urlCheck.url) {
        return `<a href="${escapeHtml(urlCheck.url)}" target="_blank" rel="noopener noreferrer">`;
      }
      return '<a>';
    }
    return `<${tag}>`;
  });
}

/**
 * Converts a small HTML fragment inside a paragraph/cell/list-item into safe
 * inline markup (`**bold**`, `*italic*`, `` `code` ``, `[text](url)`).
 *
 * @param {string} fragmentHtml
 * @returns {string}
 */
function htmlFragmentToInlineMarkup(fragmentHtml) {
  let out = String(fragmentHtml || '');
  out = out.replace(/<br\s*\/?>/gi, '\n');

  // Anchor links -> [label](https://...)
  out = out.replace(/<a(?:\s+[^>]*href="([^"]*)"[^>]*)?>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const label = decodeHtmlEntities(String(inner || '').replace(/<[^>]+>/g, '')).trim();
    if (!label) return '';
    const cleanHref = decodeHtmlEntities(href || '').trim();
    const urlCheck = isSafeContentUrl(cleanHref, { allowRelative: false });
    if (urlCheck.valid && urlCheck.url) {
      return `[${label}](${urlCheck.url})`;
    }
    return label;
  });

  // Inline code
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => {
    const code = decodeHtmlEntities(String(inner || '').replace(/<[^>]+>/g, '')).trim();
    return code ? `\`${code.replace(/`/g, "'")}\`` : '';
  });

  // Bold & italic
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner) => {
    const txt = decodeHtmlEntities(String(inner || '').replace(/<[^>]+>/g, '')).trim();
    return txt ? `**${txt}**` : '';
  });
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner) => {
    const txt = decodeHtmlEntities(String(inner || '').replace(/<[^>]+>/g, '')).trim();
    return txt ? `*${txt}*` : '';
  });

  // Strip any remaining inner tags
  out = decodeHtmlEntities(out.replace(/<[^>]+>/g, ''));
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Converts sanitized rich-text editor HTML into canonical LessonBlock[]
 * compatible with all existing validators, exports, and Postgres constraints.
 *
 * @param {string} rawHtml
 * @param {{ preservedImageBlocks?: import('../types/kord.d.ts').LessonBlock[] }} [opts]
 * @returns {import('../types/kord.d.ts').LessonBlock[]}
 */
export function richTextHtmlToMainBlocks(rawHtml, { preservedImageBlocks = [] } = {}) {
  const sanitized = sanitizeRichTextHtml(rawHtml);
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const blocks = [];
  let seq = 1;
  const nextId = () => `blk-art-${seq++}`;

  const blockPattern =
    /<(h[1-4]|p|div|blockquote|ul|ol|table|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  let lastIdx = 0;
  let match;

  /** @param {string} rawTextSegment */
  const pushLooseText = (rawTextSegment) => {
    const cleaned = htmlFragmentToInlineMarkup(rawTextSegment);
    if (!cleaned) return;
    for (const part of cleaned.split(/\n{2,}/)) {
      const t = part.trim();
      if (t) blocks.push({ id: nextId(), type: 'paragraph', text: t });
    }
  };

  while ((match = blockPattern.exec(sanitized)) !== null) {
    if (match.index > lastIdx) {
      pushLooseText(sanitized.slice(lastIdx, match.index));
    }

    const tag = String(match[1]).toLowerCase();
    const inner = match[2] || '';

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      const headingText = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
      if (headingText) {
        blocks.push({
          id: nextId(),
          type: 'heading',
          level: tag === 'h3' || tag === 'h4' ? 3 : 2,
          text: headingText,
        });
      }
    } else if (tag === 'ul' || tag === 'ol') {
      /** @type {string[]} */
      const items = [];
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        const itemText = htmlFragmentToInlineMarkup(liMatch[1]);
        if (itemText) items.push(itemText);
      }
      if (items.length > 0) {
        blocks.push({
          id: nextId(),
          type: tag === 'ol' ? 'steps' : 'bullets',
          title: '',
          items,
        });
      }
    } else if (tag === 'table') {
      /** @type {string[][]} */
      const allRows = [];
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch;
      while ((trMatch = trRegex.exec(inner)) !== null) {
        /** @type {string[]} */
        const rowCells = [];
        const cellRegex = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
          rowCells.push(htmlFragmentToInlineMarkup(cellMatch[2]) || '—');
        }
        if (rowCells.length > 0) {
          allRows.push(rowCells);
        }
      }
      if (allRows.length > 0) {
        const colCount = Math.max(1, ...allRows.map((r) => r.length));
        const padRow = (/** @type {string[]} */ row) => {
          const copy = row.slice(0, colCount);
          while (copy.length < colCount) copy.push('—');
          return copy;
        };
        const headers = padRow(allRows[0]).map((h, i) => h || `Column ${i + 1}`);
        const bodyRows =
          allRows.length > 1
            ? allRows.slice(1).map(padRow)
            : [headers.map(() => '—')];
        blocks.push({
          id: nextId(),
          type: 'table',
          title: '',
          headers,
          rows: bodyRows,
        });
      }
    } else if (tag === 'pre') {
      const codeRaw = decodeHtmlEntities(inner.replace(/<\/?code\b[^>]*>/gi, '')).trim();
      if (codeRaw) {
        blocks.push({
          id: nextId(),
          type: 'code',
          title: '',
          language: 'text',
          code: codeRaw,
        });
      }
    } else {
      // p, div, blockquote — support nested <p>/<ul> if contenteditable wrapped divs
      if (/<(p|ul|ol|h[1-4]|table|pre)\b/i.test(inner)) {
        blocks.push(...richTextHtmlToMainBlocks(inner));
      } else {
        const paraText = htmlFragmentToInlineMarkup(inner);
        if (paraText) {
          for (const part of paraText.split(/\n{2,}/)) {
            const trimmed = part.trim();
            if (trimmed) {
              blocks.push({ id: nextId(), type: 'paragraph', text: trimmed });
            }
          }
        }
      }
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < sanitized.length) {
    pushLooseText(sanitized.slice(lastIdx));
  }

  for (const imgBlk of preservedImageBlocks) {
    if (imgBlk && imgBlk.type === 'image') {
      blocks.push(normalizeLessonBlock(imgBlk));
    }
  }

  return blocks;
}

/**
 * Converts main lesson narrative blocks into continuous editorial HTML
 * (no boxy cards, definition callouts, or decorative kicker labels).
 *
 * @param {import('../types/kord.d.ts').LessonBlock[]} mainBlocks
 * @param {{ forEditor?: boolean }} [opts]
 * @returns {string}
 */
export function mainBlocksToHtml(mainBlocks = [], { forEditor = false } = {}) {
  if (!Array.isArray(mainBlocks) || mainBlocks.length === 0) {
    return forEditor ? '<p><br></p>' : '';
  }

  const parts = [];
  for (const rawBlk of mainBlocks) {
    if (!rawBlk || !rawBlk.type) continue;
    const blk = normalizeLessonBlock(rawBlk);

    switch (blk.type) {
      case 'heading': {
        const tag = Number(blk.level) === 3 ? 'h3' : 'h2';
        if (blk.text) {
          parts.push(`<${tag}>${renderFormattedInlineText(blk.text)}</${tag}>`);
        }
        break;
      }

      case 'paragraph': {
        const paragraphs = String(blk.text || '')
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of paragraphs) {
          parts.push(`<p>${renderFormattedInlineText(p).replace(/\n/g, '<br>')}</p>`);
        }
        break;
      }

      case 'definition': {
        const term = String(blk.term || '').trim();
        const meaning = String(blk.meaning || blk.text || '').trim();
        if (term || meaning) {
          const line = term && meaning ? `**${term}:** ${meaning}` : term || meaning;
          parts.push(`<p>${renderFormattedInlineText(line)}</p>`);
        }
        break;
      }

      case 'example': {
        if (blk.title) {
          parts.push(`<h3>${renderFormattedInlineText(blk.title)}</h3>`);
        }
        const bodyParas = String(blk.body || '')
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of bodyParas) {
          parts.push(`<p>${renderFormattedInlineText(p).replace(/\n/g, '<br>')}</p>`);
        }
        break;
      }

      case 'case_study': {
        if (blk.title) {
          parts.push(`<h3>${renderFormattedInlineText(blk.title)}</h3>`);
        }
        const scenarioParas = String(blk.scenario || blk.text || '')
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of scenarioParas) {
          parts.push(`<p>${renderFormattedInlineText(p).replace(/\n/g, '<br>')}</p>`);
        }
        if (blk.takeaway) {
          parts.push(`<p>${renderFormattedInlineText(`**Key takeaway:** ${blk.takeaway}`)}</p>`);
        }
        break;
      }

      case 'callout': {
        const title = String(blk.title || '').trim();
        const body = String(blk.text || '').trim();
        if (title || body) {
          const combined = title && body ? `**${title}:** ${body}` : title || body;
          parts.push(`<p>${renderFormattedInlineText(combined)}</p>`);
        }
        break;
      }

      case 'steps': {
        if (blk.title) {
          parts.push(`<h3>${renderFormattedInlineText(blk.title)}</h3>`);
        }
        if ((blk.items || []).length > 0) {
          parts.push(
            `<ol>${(blk.items || []).map((item) => `<li>${renderFormattedInlineText(item)}</li>`).join('')}</ol>`
          );
        }
        break;
      }

      case 'bullets': {
        if (blk.title) {
          parts.push(`<h3>${renderFormattedInlineText(blk.title)}</h3>`);
        }
        if ((blk.items || []).length > 0) {
          parts.push(
            `<ul>${(blk.items || []).map((item) => `<li>${renderFormattedInlineText(item)}</li>`).join('')}</ul>`
          );
        }
        break;
      }

      case 'table': {
        if (blk.title) {
          parts.push(`<h3>${renderFormattedInlineText(blk.title)}</h3>`);
        }
        const headers = blk.headers || [];
        const rows = blk.rows || [];
        const tableHtml = `
          <table>
            <thead>
              <tr>${headers.map((h) => `<th>${renderFormattedInlineText(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row) =>
                    `<tr>${(row || []).map((cell) => `<td>${renderFormattedInlineText(cell)}</td>`).join('')}</tr>`
                )
                .join('')}
            </tbody>
          </table>
        `.trim();
        parts.push(
          forEditor ? tableHtml : `<div class="lesson-table-scroll">${tableHtml}</div>`
        );
        break;
      }

      case 'code': {
        if (blk.title) {
          parts.push(`<h3>${renderFormattedInlineText(blk.title)}</h3>`);
        }
        parts.push(`<pre class="lesson-code"><code>${escapeHtml(blk.code || '')}</code></pre>`);
        break;
      }

      case 'image': {
        if (forEditor) break; // preserved separately outside rich-text area
        const rawUrl = String(blk.url || '').trim();
        const urlCheck = rawUrl ? isSafeContentUrl(rawUrl, { allowRelative: true }) : { valid: false };
        parts.push(`
          <figure class="lesson-figure">
            ${
              urlCheck.valid && urlCheck.url
                ? `<img src="${escapeHtml(urlCheck.url)}" alt="${escapeHtml(blk.alt || blk.title || 'Lesson illustration')}" referrerpolicy="no-referrer" />`
                : `<div class="lesson-figure-placeholder">${escapeHtml(blk.alt || blk.title || 'Visual diagram')}</div>`
            }
            ${blk.caption ? `<figcaption>${escapeHtml(blk.caption)}</figcaption>` : ''}
          </figure>
        `.trim());
        break;
      }

      default:
        break;
    }
  }

  return parts.join('\n');
}

/**
 * Counts plain words across main lesson blocks accurately.
 *
 * @param {import('../types/kord.d.ts').LessonBlock[]} mainBlocks
 * @returns {number}
 */
export function countMainLessonWords(mainBlocks = []) {
  const fragments = [];
  for (const blk of mainBlocks) {
    if (!blk) continue;
    if (blk.text) fragments.push(blk.text);
    if (blk.title) fragments.push(blk.title);
    if (blk.term) fragments.push(blk.term);
    if (blk.meaning) fragments.push(blk.meaning);
    if (blk.body) fragments.push(blk.body);
    if (blk.scenario) fragments.push(blk.scenario);
    if (blk.takeaway) fragments.push(blk.takeaway);
    if (blk.code) fragments.push(blk.code);
    if (Array.isArray(blk.items)) fragments.push(...blk.items);
    if (Array.isArray(blk.headers)) fragments.push(...blk.headers);
    if (Array.isArray(blk.rows)) {
      for (const r of blk.rows) {
        if (Array.isArray(r)) fragments.push(...r);
      }
    }
  }
  return fragments.join(' ').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Normalizes ANY legacy or unified Lesson into the 5-section editorial article model
 * without altering original IDs or dropping legacy blocks.
 *
 * @param {import('../types/kord.d.ts').Lesson | null | undefined} lesson
 */
export function extractLessonArticle(lesson) {
  const safeLesson = lesson || { id: '', position: 1, title: '', introduction: '', objectives: [], estMinutes: 25, blocks: [] };
  const rawBlocks = Array.isArray(safeLesson.blocks) ? safeLesson.blocks : [];

  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const mainBlocks = [];
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const preservedImageBlocks = [];
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const demoBlocks = [];
  /** @type {Array<{ id: string; prompt: string; options: string[]; correctIndex: number; explanation: string }>} */
  const assessmentQuestions = [];
  /** @type {import('../types/kord.d.ts').VideoEntry[]} */
  const extractedVideos = [...(safeLesson.videos || [])];
  /** @type {import('../types/kord.d.ts').FurtherReadingItem[]} */
  const extractedResources = [...(safeLesson.furtherReading || [])];

  const seenVideoUrls = new Set(extractedVideos.map((v) => v.url));
  const seenResourceUrls = new Set(extractedResources.map((r) => `${r.title}::${r.url}`));

  rawBlocks.forEach((rawBlk, idx) => {
    if (!rawBlk || !rawBlk.type) return;
    const blk = normalizeLessonBlock(rawBlk);

    if (blk.type === 'demonstration') {
      demoBlocks.push(blk);
    } else if (blk.type === 'knowledge_check') {
      assessmentQuestions.push({
        id: blk.id || `kc-${safeLesson.id || 'les'}-${idx + 1}`,
        prompt: String(blk.prompt || '').trim(),
        options: Array.isArray(blk.options) ? blk.options.slice() : [],
        correctIndex: Number(blk.correctIndex || 0),
        explanation: String(blk.explanation || '').trim(),
      });
    } else if (blk.type === 'video') {
      const res = normalizeVideoEntry(/** @type {import('../types/kord.d.ts').VideoEntry} */ (blk));
      if (res.valid && res.video && !seenVideoUrls.has(res.video.url)) {
        seenVideoUrls.add(res.video.url);
        extractedVideos.push(res.video);
      }
    } else if (blk.type === 'resource_download') {
      const key = `${blk.title || ''}::${blk.url || ''}`;
      if ((blk.title || blk.url) && !seenResourceUrls.has(key)) {
        seenResourceUrls.add(key);
        extractedResources.push({
          title: blk.title || 'Reference guide',
          url: blk.url || '',
          source: blk.formatLabel || 'Guide',
          resourceType: blk.formatLabel || 'Guide',
        });
      }
    } else {
      mainBlocks.push(blk);
      if (blk.type === 'image') {
        preservedImageBlocks.push(blk);
      }
    }
  });

  const primaryDemo = demoBlocks[0] || null;
  const extraDemos = demoBlocks.slice(1);
  const combinedInstructions = [
    primaryDemo?.instructions || '',
    ...extraDemos.map((d) => (d.title ? `${d.title}: ${d.instructions || ''}` : d.instructions || '')),
  ]
    .filter(Boolean)
    .join('\n\n');
  const combinedOutcomes = [
    primaryDemo?.expectedOutcome || '',
    ...extraDemos.map((d) => d.expectedOutcome || ''),
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: safeLesson.id || '',
    title: String(safeLesson.title || '').trim(),
    introduction: String(safeLesson.introduction || '').trim(),
    objectives: Array.isArray(safeLesson.objectives)
      ? safeLesson.objectives.map((o) => String(o || '').trim()).filter(Boolean)
      : [],
    estMinutes: Number(safeLesson.estMinutes || 25),
    isRequired: safeLesson.isRequired !== false,
    publicationStatus: safeLesson.publicationStatus || 'published',
    mainBlocks,
    preservedImageBlocks,
    mainHtml: mainBlocksToHtml(mainBlocks, { forEditor: true }),
    mainWordCount: countMainLessonWords(mainBlocks),
    practicalApplication: {
      title: String(primaryDemo?.title || 'Practical Application').trim(),
      instructions: combinedInstructions,
      expectedOutcome: combinedOutcomes,
    },
    summary: String(safeLesson.summary || '').trim(),
    takeaways: Array.isArray(safeLesson.takeaways)
      ? safeLesson.takeaways.map((t) => String(t || '').trim()).filter(Boolean)
      : [],
    assessmentQuestions,
    videos: extractedVideos,
    furtherReading: extractedResources,
    completionCriteria: String(safeLesson.completionCriteria || '').trim(),
  };
}

/**
 * Renders the unified 5-section textbook-style lesson view used across the
 * Learner Lesson Page and Admin Preview.
 * Never embeds correct answers or post-submit explanations into HTML attributes.
 *
 * @param {import('../types/kord.d.ts').Lesson} lesson
 * @param {{
 *   phaseLabel?: string;
 *   statusBadgeHtml?: string;
 *   showStatusBadge?: boolean;
 *   assessmentScopeId?: string;
 *   linkedQuizzesHtml?: string;
 * }} [opts]
 * @returns {{ html: string; assessmentQuestions: Array<{ id: string; prompt: string; options: string[]; correctIndex: number; explanation: string }> }}
 */
export function renderSimplifiedLessonView(
  lesson,
  {
    phaseLabel = '',
    statusBadgeHtml = '',
    showStatusBadge = false,
    assessmentScopeId = 'lesson',
    linkedQuizzesHtml = '',
  } = {}
) {
  const article = extractLessonArticle(lesson);
  const mainBodyHtml = mainBlocksToHtml(article.mainBlocks, { forEditor: false });
  const hasPractical = Boolean(article.practicalApplication.instructions.trim());
  const hasSummary = Boolean(article.summary || article.takeaways.length > 0);
  const hasQuestions = article.assessmentQuestions.length > 0;
  const hasSupplementary = article.videos.length > 0 || article.furtherReading.length > 0;

  const html = `
    <div class="lesson-article-prose">
      <!-- A. Lesson Title and Introduction -->
      <header class="lesson-article-header">
        <div class="lesson-article-header-top">
          <div class="meta-line">
            ${phaseLabel ? `<span>${escapeHtml(phaseLabel)}</span><span class="meta-sep" aria-hidden="true">·</span>` : ''}
            <span class="mono-num">${article.estMinutes} min read</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>${article.isRequired ? 'Required' : 'Optional'}</span>
          </div>
          ${showStatusBadge ? statusBadgeHtml : ''}
        </div>
        <h1 class="lesson-article-title">${escapeHtml(article.title || 'Untitled lesson')}</h1>
        ${
          article.introduction
            ? `<p class="lesson-article-intro">${renderFormattedInlineText(article.introduction)}</p>`
            : ''
        }
      </header>

      <!-- B. Learning Objectives -->
      ${
        article.objectives.length > 0
          ? `
        <section class="lesson-section lesson-objectives-section" aria-labelledby="${escapeHtml(assessmentScopeId)}-obj-heading">
          <h2 id="${escapeHtml(assessmentScopeId)}-obj-heading" class="lesson-section-heading">Learning objectives</h2>
          <p class="lesson-section-lead">By the end of this lesson, you will be able to:</p>
          <ul class="lesson-objectives-list">
            ${article.objectives.map((obj) => `<li>${renderFormattedInlineText(obj)}</li>`).join('')}
          </ul>
        </section>
      `
          : ''
      }

      <!-- C. Main Lesson -->
      <section class="lesson-section lesson-main-section" aria-label="Main lesson">
        ${mainBodyHtml || '<p class="lesson-muted">Main instructional content is in preparation.</p>'}
      </section>

      <!-- D. Practical Application -->
      ${
        hasPractical
          ? `
        <section class="lesson-section lesson-practical-section" aria-labelledby="${escapeHtml(assessmentScopeId)}-practical-heading">
          <h2 id="${escapeHtml(assessmentScopeId)}-practical-heading" class="lesson-section-heading">Practical application</h2>
          ${
            article.practicalApplication.title &&
            article.practicalApplication.title.toLowerCase() !== 'practical application' &&
            article.practicalApplication.title.toLowerCase() !== 'practical demonstration'
              ? `<h3 class="lesson-practical-subtitle">${escapeHtml(article.practicalApplication.title)}</h3>`
              : ''
          }
          <div class="lesson-practical-body">
            ${article.practicalApplication.instructions
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p) => `<p>${renderFormattedInlineText(p).replace(/\n/g, '<br>')}</p>`)
              .join('')}
          </div>
          ${
            article.practicalApplication.expectedOutcome
              ? `<p class="lesson-practical-outcome"><strong>What a satisfactory result demonstrates:</strong> ${renderFormattedInlineText(article.practicalApplication.expectedOutcome)}</p>`
              : ''
          }
        </section>
      `
          : ''
      }

      <!-- E. Summary and Assessment -->
      ${
        hasSummary || hasQuestions || linkedQuizzesHtml
          ? `
        <section class="lesson-section lesson-summary-section" aria-labelledby="${escapeHtml(assessmentScopeId)}-summary-heading">
          <h2 id="${escapeHtml(assessmentScopeId)}-summary-heading" class="lesson-section-heading">Summary and assessment</h2>
          ${
            article.summary
              ? `<p class="lesson-summary-text">${renderFormattedInlineText(article.summary)}</p>`
              : ''
          }
          ${
            article.takeaways.length > 0
              ? `<ul class="lesson-takeaways-list">
                  ${article.takeaways.map((tk) => `<li>${renderFormattedInlineText(tk)}</li>`).join('')}
                </ul>`
              : ''
          }

          ${
            hasQuestions
              ? `
            <div class="lesson-assessment-block" data-lesson-assessment="${escapeHtml(assessmentScopeId)}">
              <h3 class="lesson-assessment-heading">Check your understanding (${article.assessmentQuestions.length} ${article.assessmentQuestions.length === 1 ? 'question' : 'questions'})</h3>
              <p class="lesson-assessment-hint">Select one answer for each question, then submit to review your score and explanations.</p>
              <form class="lesson-assessment-form" data-assessment-form="${escapeHtml(assessmentScopeId)}">
                ${article.assessmentQuestions
                  .map(
                    (q, qIdx) => `
                  <fieldset class="lesson-question-item" data-question-index="${qIdx}">
                    <legend class="lesson-question-prompt">
                      <span class="mono-num">${qIdx + 1}.</span> ${renderFormattedInlineText(q.prompt)}
                    </legend>
                    <div class="lesson-question-options">
                      ${q.options
                        .map(
                          (opt, oIdx) => `
                        <label class="quiz-option lesson-question-option">
                          <input type="radio" name="assess_${escapeHtml(assessmentScopeId)}_q_${qIdx}" value="${oIdx}" />
                          <span>${renderFormattedInlineText(opt)}</span>
                        </label>
                      `
                        )
                        .join('')}
                    </div>
                    <div class="lesson-question-feedback" data-q-feedback="${qIdx}" hidden></div>
                  </fieldset>
                `
                  )
                  .join('')}
                <div class="lesson-assessment-actions">
                  <button type="submit" class="btn btn-primary btn-sm">Submit answers</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-reset-assessment hidden>Try again</button>
                  <span class="lesson-assessment-score" data-assessment-summary hidden></span>
                </div>
              </form>
            </div>
          `
              : ''
          }

          ${linkedQuizzesHtml ? `<div class="lesson-linked-assessments">${linkedQuizzesHtml}</div>` : ''}
        </section>
      `
          : ''
      }

      <!-- Supplementary Optional Resources (Non-Interrupting) -->
      ${
        hasSupplementary
          ? `
        <details class="lesson-supplementary-details">
          <summary class="lesson-supplementary-summary">
            Optional resources &amp; videos (${article.videos.length + article.furtherReading.length})
          </summary>
          <div class="lesson-supplementary-body">
            ${
              article.videos.length > 0
                ? `<div class="lesson-supplementary-group">
                    <h3>Optional video walkthroughs</h3>
                    ${article.videos.map((v, idx) => renderVideoPlayerHtml(v, idx)).join('')}
                  </div>`
                : ''
            }
            ${
              article.furtherReading.length > 0
                ? `<div class="lesson-supplementary-group">
                    <h3>Further reading</h3>
                    <ul class="lesson-resources-list">
                      ${article.furtherReading
                        .map((fr) => {
                          const urlCheck = fr.url ? isSafeContentUrl(fr.url, { allowRelative: false }) : { valid: false };
                          return urlCheck.valid && urlCheck.url
                            ? `<li><a href="${escapeHtml(urlCheck.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fr.title || fr.url)}</a>${fr.source ? ` <span class="lesson-muted">(${escapeHtml(fr.source)})</span>` : ''}</li>`
                            : `<li>${escapeHtml(fr.title || 'Reference')}</li>`;
                        })
                        .join('')}
                    </ul>
                  </div>`
                : ''
            }
          </div>
        </details>
      `
          : ''
      }
    </div>
  `;

  return {
    html,
    assessmentQuestions: article.assessmentQuestions,
  };
}

/**
 * Binds assessment submission and post-submit feedback strictly in JS memory
 * (no answers/explanations exposed in initial DOM attributes).
 *
 * @param {HTMLElement} root
 * @param {Array<{ id: string; prompt: string; options: string[]; correctIndex: number; explanation: string }>} questions
 * @param {string} [assessmentScopeId]
 */
export function bindSimplifiedLessonAssessment(root, questions, assessmentScopeId = 'lesson') {
  const form = /** @type {HTMLFormElement | null} */ (
    root.querySelector(`[data-assessment-form="${assessmentScopeId}"]`)
  );
  if (!form || !Array.isArray(questions) || questions.length === 0) return;

  const summaryEl = /** @type {HTMLElement | null} */ (form.querySelector('[data-assessment-summary]'));
  const resetBtn = /** @type {HTMLButtonElement | null} */ (form.querySelector('[data-reset-assessment]'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    /** @type {number[]} */
    const chosenIndices = [];
    for (let i = 0; i < questions.length; i += 1) {
      const checked = /** @type {HTMLInputElement | null} */ (
        form.querySelector(`input[name="assess_${assessmentScopeId}_q_${i}"]:checked`)
      );
      if (!checked) {
        if (summaryEl) {
          summaryEl.hidden = false;
          summaryEl.style.color = 'var(--color-amber)';
          summaryEl.textContent = `Please answer question ${i + 1} before submitting.`;
        }
        return;
      }
      chosenIndices.push(Number(checked.value));
    }

    let correctCount = 0;
    questions.forEach((q, qIdx) => {
      const selectedIdx = chosenIndices[qIdx];
      const isCorrect = selectedIdx === Number(q.correctIndex);
      if (isCorrect) correctCount += 1;

      const feedbackEl = /** @type {HTMLElement | null} */ (
        form.querySelector(`[data-q-feedback="${qIdx}"]`)
      );
      if (feedbackEl) {
        feedbackEl.hidden = false;
        feedbackEl.className = `lesson-question-feedback ${isCorrect ? 'is-correct' : 'is-incorrect'}`;
        const label = isCorrect ? 'Correct' : 'Not quite';
        const explanation = q.explanation
          ? q.explanation
          : isCorrect
            ? 'Well reasoned.'
            : 'Review the main lesson section above and try again.';
        feedbackEl.innerHTML = `<strong>${label}:</strong> ${escapeHtml(explanation)}`;
      }
    });

    if (summaryEl) {
      summaryEl.hidden = false;
      const pct = Math.round((correctCount / questions.length) * 100);
      summaryEl.style.color = correctCount === questions.length ? 'var(--color-green)' : 'var(--color-navy)';
      summaryEl.textContent = `Score: ${correctCount} of ${questions.length} correct (${pct}%)`;
    }
    if (resetBtn) {
      resetBtn.hidden = false;
    }
  });

  resetBtn?.addEventListener('click', () => {
    form.reset();
    form.querySelectorAll('[data-q-feedback]').forEach((el) => {
      const box = /** @type {HTMLElement} */ (el);
      box.hidden = true;
      box.textContent = '';
      box.className = 'lesson-question-feedback';
    });
    if (summaryEl) {
      summaryEl.hidden = true;
      summaryEl.textContent = '';
    }
    resetBtn.hidden = true;
  });

  // Video fallback instructions toggle
  root.querySelectorAll('[data-video-fallback-toggle]').forEach((node) => {
    const btn = /** @type {HTMLElement} */ (node);
    btn.addEventListener('click', () => {
      const helpEl = /** @type {HTMLElement | null} */ (
        root.querySelector(`#video-help-${btn.dataset.videoFallbackToggle}`)
      );
      if (helpEl) {
        helpEl.style.display = helpEl.style.display === 'none' ? 'block' : 'none';
      }
    });
  });
}

/**
 * Converts simplified Admin Editor state back into canonical Lesson fields
 * with LessonBlock[] compatible with existing storage, validation, and export.
 *
 * @param {{
 *   title: string;
 *   estMinutes?: number;
 *   introduction: string;
 *   objectives: string[] | string;
 *   mainHtml: string;
 *   preservedImageBlocks?: import('../types/kord.d.ts').LessonBlock[];
 *   practicalApplication?: { title?: string; instructions?: string; expectedOutcome?: string };
 *   summary?: string;
 *   takeaways?: string[] | string;
 *   assessmentQuestions?: Array<{ id?: string; prompt: string; options: string[]; correctIndex: number; explanation: string }>;
 *   videos?: import('../types/kord.d.ts').VideoEntry[];
 *   furtherReading?: import('../types/kord.d.ts').FurtherReadingItem[];
 *   completionCriteria?: string;
 *   publicationStatus?: string;
 *   isRequired?: boolean;
 * }} editorDraft
 */
export function assembleLessonFromEditor(editorDraft) {
  const cleanObjectives = Array.isArray(editorDraft.objectives)
    ? editorDraft.objectives.map((s) => String(s || '').trim()).filter(Boolean)
    : String(editorDraft.objectives || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

  const cleanTakeaways = Array.isArray(editorDraft.takeaways)
    ? editorDraft.takeaways.map((s) => String(s || '').trim()).filter(Boolean)
    : String(editorDraft.takeaways || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

  const mainBlocks = richTextHtmlToMainBlocks(editorDraft.mainHtml || '', {
    preservedImageBlocks: editorDraft.preservedImageBlocks || [],
  });

  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const blocks = [...mainBlocks];

  const prac = editorDraft.practicalApplication || {};
  const pracInstructions = String(prac.instructions || '').trim();
  const pracOutcome = String(prac.expectedOutcome || '').trim();
  if (pracInstructions) {
    blocks.push({
      id: `blk-prac-${Date.now().toString(36)}`,
      type: 'demonstration',
      title: String(prac.title || 'Practical Application').trim() || 'Practical Application',
      instructions: pracInstructions,
      expectedOutcome: pracOutcome,
    });
  }

  (editorDraft.assessmentQuestions || []).forEach((q, idx) => {
    const prompt = String(q?.prompt || '').trim();
    const options = Array.isArray(q?.options)
      ? q.options.map((o) => String(o || '').trim()).filter(Boolean)
      : [];
    if (!prompt && options.length === 0) return;
    const safeIdx = Math.max(0, Math.min(Math.max(0, options.length - 1), Number(q?.correctIndex || 0)));
    blocks.push({
      id: q?.id || `blk-kc-${idx + 1}`,
      type: 'knowledge_check',
      prompt,
      options,
      correctIndex: safeIdx,
      explanation: String(q?.explanation || '').trim(),
    });
  });

  return {
    title: String(editorDraft.title || '').trim(),
    estMinutes: Math.max(1, Number(editorDraft.estMinutes || 25)),
    introduction: String(editorDraft.introduction || '').trim(),
    objectives: cleanObjectives,
    blocks,
    videos: Array.isArray(editorDraft.videos) ? editorDraft.videos : [],
    furtherReading: Array.isArray(editorDraft.furtherReading) ? editorDraft.furtherReading : [],
    summary: String(editorDraft.summary || '').trim(),
    takeaways: cleanTakeaways,
    completionCriteria:
      String(editorDraft.completionCriteria || '').trim() ||
      'Read the lesson carefully, complete the practical application, submit the assessment check, and mark this lesson complete.',
    publicationStatus: editorDraft.publicationStatus || 'draft',
    isRequired: editorDraft.isRequired !== false,
  };
}

/**
 * Checks whether text contains default placeholder prose from starter templates.
 *
 * @param {string} value
 * @returns {boolean}
 */
function hasPlaceholderText(value) {
  const lower = String(value || '').toLowerCase();
  return PLACEHOLDER_SNIPPETS.some((snippet) => lower.includes(snippet));
}

/**
 * Validates lesson completeness before publishing (rejects empty/placeholder lessons).
 * Returns hard errors (which block publishing) and optional editorial warnings.
 *
 * @param {import('../types/kord.d.ts').Lesson | ReturnType<typeof assembleLessonFromEditor>} lessonPayload
 * @returns {{ valid: boolean; errors: string[]; warnings: string[]; checks: Array<{ key: string; label: string; ok: boolean }> }}
 */
export function validateLessonPublishReadiness(lessonPayload) {
  const article = extractLessonArticle(/** @type {import('../types/kord.d.ts').Lesson} */ (lessonPayload));
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  const titleOk = article.title.length >= 3 && !hasPlaceholderText(article.title);
  if (!titleOk) {
    errors.push('Lesson title is required (minimum 3 characters, no placeholder text).');
  }

  const introOk = article.introduction.length >= 20 && !hasPlaceholderText(article.introduction);
  if (!introOk) {
    errors.push('Short introduction must clearly introduce the topic and its relevance (at least 20 characters).');
  }

  const objectivesOk =
    article.objectives.length >= 2 &&
    article.objectives.every((o) => o.length >= 6 && !hasPlaceholderText(o));
  if (!objectivesOk) {
    errors.push('Include at least 2 clear learning objectives (3–4 recommended) before publishing.');
  } else if (article.objectives.length < 3 || article.objectives.length > 4) {
    warnings.push('3–4 concise learning objectives are recommended.');
  }

  const mainCharCount = article.mainBlocks
    .map((b) => [b.text, b.body, b.scenario, ...(b.items || []), b.meaning].filter(Boolean).join(' '))
    .join(' ')
    .trim().length;
  const mainTextCombined = article.mainBlocks
    .map((b) => [b.text, b.title, b.body, b.scenario, ...(b.items || [])].filter(Boolean).join(' '))
    .join(' ');
  const mainOk =
    article.mainBlocks.length > 0 &&
    mainCharCount >= 120 &&
    article.mainWordCount >= 20 &&
    !hasPlaceholderText(mainTextCombined);
  if (!mainOk) {
    errors.push(
      'Main lesson content requires substantial original instructional writing before publishing (no placeholder text).'
    );
  } else if (article.mainWordCount < 600) {
    warnings.push(
      `Main lesson currently has ${article.mainWordCount} words; aim for ~800–1,200 words of substantive instruction where appropriate.`
    );
  }

  const practicalOk =
    article.practicalApplication.instructions.length >= 20 &&
    !hasPlaceholderText(article.practicalApplication.instructions);
  if (!practicalOk) {
    errors.push(
      'Practical application is required before publishing: describe what the learner must do and what a satisfactory result demonstrates.'
    );
  } else if (!article.practicalApplication.expectedOutcome || article.practicalApplication.expectedOutcome.length < 10) {
    warnings.push('Specify what a satisfactory practical result demonstrates.');
  }

  const summaryOk = article.summary.length >= 15 && !hasPlaceholderText(article.summary);
  if (!summaryOk) {
    errors.push('A concise lesson summary is required before publishing.');
  }

  const validQuestions = article.assessmentQuestions.filter(
    (q) =>
      q.prompt.length >= 5 &&
      !hasPlaceholderText(q.prompt) &&
      q.options.length >= 2 &&
      Number.isInteger(q.correctIndex) &&
      q.correctIndex >= 0 &&
      q.correctIndex < q.options.length &&
      q.explanation.length >= 5
  );
  const assessmentOk =
    article.assessmentQuestions.length >= 1 &&
    validQuestions.length === article.assessmentQuestions.length;
  if (!assessmentOk) {
    errors.push(
      'Include at least 1 complete assessment question (3–5 recommended) with 2+ answer options, a selected correct answer, and a post-submission explanation.'
    );
  } else if (article.assessmentQuestions.length < 3 || article.assessmentQuestions.length > 5) {
    warnings.push('3–5 assessment questions are recommended per lesson.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checks: [
      { key: 'title', label: 'Lesson title', ok: titleOk },
      { key: 'introduction', label: 'Short introduction', ok: introOk },
      { key: 'objectives', label: 'Learning objectives', ok: objectivesOk },
      { key: 'main', label: 'Main lesson content', ok: mainOk },
      { key: 'practical', label: 'Practical application', ok: practicalOk },
      { key: 'summary', label: 'Summary', ok: summaryOk },
      { key: 'assessment', label: 'Assessment questions', ok: assessmentOk },
    ],
  };
}
