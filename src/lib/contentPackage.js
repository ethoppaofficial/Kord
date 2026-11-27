import { BLOCK_TYPE_CATALOG } from './lessonBlocks.js';
import { normalizeVideoEntry } from './videoProvider.js';

export const CONTENT_PACKAGE_SCHEMA_VERSION = '1.0';
export const CONTENT_PACKAGE_TYPE = 'kord-course-content';
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PACKAGE_LESSONS = 200;
export const MIN_INSTRUCTIONAL_TEXT_CHARS = 35;

export const ALLOWED_BLOCK_TYPES_LIST = BLOCK_TYPE_CATALOG.map((b) => b.type);
export const ALLOWED_BLOCK_TYPES = new Set(ALLOWED_BLOCK_TYPES_LIST);

const DANGEROUS_HTML_PATTERNS = [
  /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/i,
  /<\s*script\b\s+(?:src|type|async|defer|nonce|crossorigin|on[a-z]+)\b/i,
  /<\s*(?:iframe|object|embed|svg|style)\b/i,
  /<\s*img\b[^>]*\b(?:src|on[a-z]+)\s*=/i,
  /<\s*a\b[^>]*\bhref\s*=\s*["']?\s*(?:javascript|vbscript|data)\s*:/i,
  /\bon[a-z]{2,}\s*=\s*(?!["']\.\.\.["'])/i,
  /\bsrcdoc\s*=/i,
  /\b(?:javascript|vbscript):(?![\s"'`<>]|$)/i,
  /\bdata\s*:\s*text\/html/i,
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} rawUrl
 * @param {{ allowRelative?: boolean }} [opts]
 * @returns {{ valid: boolean; error?: string; url?: string }}
 */
export function isSafeContentUrl(rawUrl, { allowRelative = false } = {}) {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    return { valid: false, error: 'URL cannot be empty.' };
  }
  if (trimmed.includes('\0') || /[\r\n\t]/.test(trimmed)) {
    return { valid: false, error: 'URL contains invalid control characters.' };
  }
  if (trimmed.includes('<') || trimmed.includes('>')) {
    return { valid: false, error: 'URL cannot contain HTML brackets.' };
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('file:')
  ) {
    return { valid: false, error: 'Unsafe URL scheme is not permitted.' };
  }
  if (allowRelative && trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) {
      return { valid: false, error: 'Protocol-relative URLs are not permitted.' };
    }
    return { valid: true, url: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Only https:// or http:// URLs are permitted.' };
    }
    return { valid: true, url: trimmed };
  } catch {
    return {
      valid: false,
      error: allowRelative
        ? 'Enter a valid https:// URL or root-relative /assets/... path.'
        : 'Enter a valid https:// or http:// URL.',
    };
  }
}

/**
 * Validates text fields against unsafe HTML/script injection while allowing
 * benign technical prose such as "<nav>" or "<article>" in plain escaped paragraphs.
 * Code blocks skip tag pattern checks (rendered strictly via escapeHtml).
 *
 * @param {unknown} value
 * @param {string} fieldPath
 * @param {import('../types/kord.d.ts').DryRunValidationIssue[]} issues
 * @param {{ isCode?: boolean }} [opts]
 */
export function validateNoUnsafeHtmlOrScript(value, fieldPath, issues, { isCode = false } = {}) {
  if (typeof value !== 'string') return;
  if (value.includes('\0')) {
    issues.push({ field: fieldPath, message: 'Null bytes are not allowed in content fields.' });
    return;
  }
  if (isCode) return;
  const cleaned = value.replace(/`[^`]*`/g, ' ');
  for (const rx of DANGEROUS_HTML_PATTERNS) {
    if (rx.test(cleaned)) {
      issues.push({
        field: fieldPath,
        message: 'Disallowed raw HTML, script, or executable URI detected.',
      });
      return;
    }
  }
}

/**
 * Normalizes a single content block (including legacy seed aliases such as
 * definition.text -> definition.meaning and case_study.text -> case_study.scenario).
 * Preserves deterministic key layout for accurate round-trip equality checks.
 *
 * @param {unknown} rawBlock
 * @returns {import('../types/kord.d.ts').LessonBlock}
 */
export function normalizeLessonBlock(rawBlock) {
  const blk = isPlainObject(rawBlock) ? rawBlock : {};
  const type = String(blk.type || '').trim();
  const baseId = typeof blk.id === 'string' && blk.id.trim() ? blk.id.trim() : undefined;

  /** @param {import('../types/kord.d.ts').LessonBlock} out */
  const withOptionalId = (out) => (baseId ? { id: baseId, ...out } : out);

  switch (type) {
    case 'heading': {
      /** @type {import('../types/kord.d.ts').LessonBlock} */
      const out = { type: 'heading', text: String(blk.text ?? '').trim() };
      if (blk.level !== undefined && blk.level !== null) {
        out.level = Number(blk.level);
      }
      return withOptionalId(out);
    }
    case 'paragraph':
      return withOptionalId({
        type: 'paragraph',
        text: String(blk.text ?? '').trim(),
      });
    case 'steps':
    case 'bullets':
      return withOptionalId({
        type,
        title: String(blk.title ?? '').trim(),
        items: Array.isArray(blk.items)
          ? blk.items.map((item) => String(item ?? '').trim()).filter(Boolean)
          : [],
      });
    case 'definition':
      return withOptionalId({
        type: 'definition',
        term: String(blk.term ?? '').trim(),
        meaning: String(blk.meaning ?? blk.text ?? '').trim(),
      });
    case 'example':
      return withOptionalId({
        type: 'example',
        title: String(blk.title ?? '').trim(),
        body: String(blk.body ?? '').trim(),
      });
    case 'case_study':
      return withOptionalId({
        type: 'case_study',
        title: String(blk.title ?? '').trim(),
        scenario: String(blk.scenario ?? blk.text ?? '').trim(),
        takeaway: String(blk.takeaway ?? '').trim(),
      });
    case 'table':
      return withOptionalId({
        type: 'table',
        title: String(blk.title ?? '').trim(),
        headers: Array.isArray(blk.headers)
          ? blk.headers.map((h) => String(h ?? '').trim())
          : [],
        rows: Array.isArray(blk.rows)
          ? blk.rows.map((r) =>
              Array.isArray(r) ? r.map((cell) => String(cell ?? '').trim()) : []
            )
          : [],
      });
    case 'callout': {
      /** @type {import('../types/kord.d.ts').LessonBlock} */
      const out = {
        type: 'callout',
        title: String(blk.title ?? '').trim(),
        text: String(blk.text ?? '').trim(),
      };
      if (typeof blk.variant === 'string' && blk.variant.trim()) {
        out.variant = blk.variant.trim();
      }
      return withOptionalId(out);
    }
    case 'demonstration':
      return withOptionalId({
        type: 'demonstration',
        title: String(blk.title ?? '').trim(),
        instructions: String(blk.instructions ?? '').trim(),
        expectedOutcome: String(blk.expectedOutcome ?? '').trim(),
      });
    case 'code':
      return withOptionalId({
        type: 'code',
        title: String(blk.title ?? '').trim(),
        language: String(blk.language ?? 'text').trim() || 'text',
        code: String(blk.code ?? ''),
      });
    case 'image':
      return withOptionalId({
        type: 'image',
        title: String(blk.title ?? '').trim(),
        url: String(blk.url ?? '').trim(),
        alt: String(blk.alt ?? '').trim(),
        caption: String(blk.caption ?? '').trim(),
      });
    case 'video': {
      const normalized = normalizeVideoEntry(
        /** @type {import('../types/kord.d.ts').VideoEntry} */ (blk)
      );
      if (normalized.valid && normalized.video) {
        return withOptionalId({
          type: 'video',
          provider: normalized.video.provider,
          videoId: normalized.video.videoId,
          url: normalized.video.url,
          title: normalized.video.title,
          description: normalized.video.description,
          duration: normalized.video.duration,
          transcript: normalized.video.transcript,
          viewingInstructions: normalized.video.viewingInstructions,
          embedRestricted: normalized.video.embedRestricted,
        });
      }
      return withOptionalId({
        type: 'video',
        provider: String(blk.provider ?? 'youtube').trim(),
        videoId: String(blk.videoId ?? '').trim(),
        url: String(blk.url ?? '').trim(),
        title: String(blk.title ?? '').trim(),
      });
    }
    case 'resource_download':
      return withOptionalId({
        type: 'resource_download',
        title: String(blk.title ?? '').trim(),
        description: String(blk.description ?? '').trim(),
        url: String(blk.url ?? '').trim(),
        formatLabel: String(blk.formatLabel ?? 'Guide').trim() || 'Guide',
      });
    case 'knowledge_check':
      return withOptionalId({
        type: 'knowledge_check',
        prompt: String(blk.prompt ?? '').trim(),
        options: Array.isArray(blk.options)
          ? blk.options.map((o) => String(o ?? '').trim()).filter(Boolean)
          : [],
        correctIndex: Number(blk.correctIndex ?? 0),
        explanation: String(blk.explanation ?? '').trim(),
      });
    default:
      return withOptionalId(/** @type {import('../types/kord.d.ts').LessonBlock} */ ({ ...blk, type }));
  }
}

/**
 * Validates a single raw block and returns structured field-level issues plus normalized block.
 *
 * @param {unknown} rawBlock
 * @param {number} index
 * @returns {{ valid: boolean; errors: import('../types/kord.d.ts').DryRunValidationIssue[]; block: import('../types/kord.d.ts').LessonBlock; contentCharCount: number; hasSubstantiveInstruction: boolean }}
 */
export function validateLessonBlock(rawBlock, index) {
  /** @type {import('../types/kord.d.ts').DryRunValidationIssue[]} */
  const errors = [];
  const prefix = `blocks[${index}]`;

  if (!isPlainObject(rawBlock)) {
    errors.push({ field: prefix, message: 'Each block must be a JSON object.' });
    return {
      valid: false,
      errors,
      block: normalizeLessonBlock({ type: 'paragraph', text: '' }),
      contentCharCount: 0,
      hasSubstantiveInstruction: false,
    };
  }

  const rawType = String(rawBlock.type || '').trim();
  if (!rawType) {
    errors.push({ field: `${prefix}.type`, message: 'Block type is required.' });
    return {
      valid: false,
      errors,
      block: normalizeLessonBlock(rawBlock),
      contentCharCount: 0,
      hasSubstantiveInstruction: false,
    };
  }

  if (!ALLOWED_BLOCK_TYPES.has(rawType)) {
    errors.push({
      field: `${prefix}.type`,
      message: `Unsupported block type "${rawType}". Allowed types: ${ALLOWED_BLOCK_TYPES_LIST.join(', ')}.`,
    });
    return {
      valid: false,
      errors,
      block: normalizeLessonBlock(rawBlock),
      contentCharCount: 0,
      hasSubstantiveInstruction: false,
    };
  }

  const block = normalizeLessonBlock(rawBlock);
  let contentCharCount = 0;
  let hasSubstantiveInstruction = false;

  switch (block.type) {
    case 'heading': {
      validateNoUnsafeHtmlOrScript(block.text, `${prefix}.text`, errors);
      if (!block.text) {
        errors.push({ field: `${prefix}.text`, message: 'Heading text is required.' });
      }
      break;
    }
    case 'paragraph': {
      validateNoUnsafeHtmlOrScript(block.text, `${prefix}.text`, errors);
      if (!block.text) {
        errors.push({ field: `${prefix}.text`, message: 'Paragraph text is required.' });
      } else {
        contentCharCount += block.text.length;
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'steps':
    case 'bullets': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      if (!Array.isArray(rawBlock.items) || (block.items || []).length === 0) {
        errors.push({ field: `${prefix}.items`, message: `${block.type} block requires at least one non-empty item.` });
      } else {
        (block.items || []).forEach((item, iIdx) => {
          validateNoUnsafeHtmlOrScript(item, `${prefix}.items[${iIdx}]`, errors);
          contentCharCount += item.length;
        });
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'definition': {
      validateNoUnsafeHtmlOrScript(block.term, `${prefix}.term`, errors);
      validateNoUnsafeHtmlOrScript(block.meaning, `${prefix}.meaning`, errors);
      if (!block.term) {
        errors.push({ field: `${prefix}.term`, message: 'Definition block requires a non-empty "term".' });
      }
      if (!block.meaning) {
        errors.push({ field: `${prefix}.meaning`, message: 'Definition block requires a non-empty "meaning".' });
      } else {
        contentCharCount += (block.term?.length || 0) + block.meaning.length;
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'example': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.body, `${prefix}.body`, errors);
      if (!block.body) {
        errors.push({ field: `${prefix}.body`, message: 'Example block requires a non-empty "body".' });
      } else {
        contentCharCount += block.body.length;
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'case_study': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.scenario, `${prefix}.scenario`, errors);
      validateNoUnsafeHtmlOrScript(block.takeaway, `${prefix}.takeaway`, errors);
      if (!block.scenario) {
        errors.push({ field: `${prefix}.scenario`, message: 'Case study block requires a non-empty "scenario".' });
      } else {
        contentCharCount += block.scenario.length + (block.takeaway?.length || 0);
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'table': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      const headers = block.headers || [];
      const rows = block.rows || [];
      if (headers.length === 0 || headers.some((h) => !h)) {
        errors.push({ field: `${prefix}.headers`, message: 'Table block requires non-empty headers.' });
      } else {
        headers.forEach((h, hIdx) => validateNoUnsafeHtmlOrScript(h, `${prefix}.headers[${hIdx}]`, errors));
      }
      if (!Array.isArray(rawBlock.rows) || rows.length === 0) {
        errors.push({ field: `${prefix}.rows`, message: 'Table block requires at least one row.' });
      } else {
        rows.forEach((row, rIdx) => {
          if (headers.length > 0 && row.length !== headers.length) {
            errors.push({
              field: `${prefix}.rows[${rIdx}]`,
              message: `Table row ${rIdx + 1} has ${row.length} cells but expected ${headers.length}.`,
            });
          }
          row.forEach((cell, cIdx) => {
            validateNoUnsafeHtmlOrScript(cell, `${prefix}.rows[${rIdx}][${cIdx}]`, errors);
            contentCharCount += cell.length;
          });
        });
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'callout': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.text, `${prefix}.text`, errors);
      if (!block.text) {
        errors.push({ field: `${prefix}.text`, message: 'Callout block requires non-empty "text".' });
      } else {
        contentCharCount += block.text.length;
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'demonstration': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.instructions, `${prefix}.instructions`, errors);
      validateNoUnsafeHtmlOrScript(block.expectedOutcome, `${prefix}.expectedOutcome`, errors);
      if (!block.instructions) {
        errors.push({ field: `${prefix}.instructions`, message: 'Demonstration block requires non-empty "instructions".' });
      } else {
        contentCharCount += block.instructions.length + (block.expectedOutcome?.length || 0);
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'code': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.code, `${prefix}.code`, errors, { isCode: true });
      if (!String(block.code || '').trim()) {
        errors.push({ field: `${prefix}.code`, message: 'Code block requires non-empty "code".' });
      } else {
        contentCharCount += String(block.code || '').trim().length;
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'image': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.alt, `${prefix}.alt`, errors);
      validateNoUnsafeHtmlOrScript(block.caption, `${prefix}.caption`, errors);
      if (!block.title && !block.alt) {
        errors.push({ field: `${prefix}.alt`, message: 'Image block requires "alt" or "title".' });
      }
      if (block.url) {
        const urlCheck = isSafeContentUrl(block.url, { allowRelative: true });
        if (!urlCheck.valid) {
          errors.push({ field: `${prefix}.url`, message: urlCheck.error || 'Invalid image URL.' });
        }
      }
      contentCharCount += (block.alt?.length || 0) + (block.caption?.length || 0);
      if (block.url || (block.caption && block.caption.length >= 20)) {
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'video': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.description, `${prefix}.description`, errors);
      validateNoUnsafeHtmlOrScript(block.transcript, `${prefix}.transcript`, errors);
      validateNoUnsafeHtmlOrScript(block.viewingInstructions, `${prefix}.viewingInstructions`, errors);
      const videoRes = normalizeVideoEntry(/** @type {import('../types/kord.d.ts').VideoEntry} */ (rawBlock));
      if (!videoRes.valid) {
        errors.push({ field: `${prefix}.url`, message: videoRes.error || 'Invalid embedded video entry.' });
      } else {
        hasSubstantiveInstruction = true;
        contentCharCount += Math.max(40, (block.title?.length || 0) + (block.transcript?.length || 0));
      }
      break;
    }
    case 'resource_download': {
      validateNoUnsafeHtmlOrScript(block.title, `${prefix}.title`, errors);
      validateNoUnsafeHtmlOrScript(block.description, `${prefix}.description`, errors);
      validateNoUnsafeHtmlOrScript(block.formatLabel, `${prefix}.formatLabel`, errors);
      if (!block.title) {
        errors.push({ field: `${prefix}.title`, message: 'Resource download block requires a "title".' });
      }
      if (block.url) {
        const urlCheck = isSafeContentUrl(block.url, { allowRelative: false });
        if (!urlCheck.valid) {
          errors.push({ field: `${prefix}.url`, message: urlCheck.error || 'Invalid resource URL.' });
        }
      }
      contentCharCount += (block.title?.length || 0) + (block.description?.length || 0);
      if (block.title && (block.url || block.description)) {
        hasSubstantiveInstruction = true;
      }
      break;
    }
    case 'knowledge_check': {
      validateNoUnsafeHtmlOrScript(block.prompt, `${prefix}.prompt`, errors);
      validateNoUnsafeHtmlOrScript(block.explanation, `${prefix}.explanation`, errors);
      if (!block.prompt) {
        errors.push({ field: `${prefix}.prompt`, message: 'Knowledge check block requires a "prompt".' });
      }
      const opts = block.options || [];
      if (opts.length < 2) {
        errors.push({ field: `${prefix}.options`, message: 'Knowledge check block requires at least 2 options.' });
      } else {
        opts.forEach((opt, oIdx) => {
          validateNoUnsafeHtmlOrScript(opt, `${prefix}.options[${oIdx}]`, errors);
        });
      }
      const cIdx = Number(block.correctIndex);
      if (!Number.isInteger(cIdx) || cIdx < 0 || cIdx >= opts.length) {
        errors.push({
          field: `${prefix}.correctIndex`,
          message: `correctIndex must be an integer between 0 and ${Math.max(0, opts.length - 1)}.`,
        });
      }
      contentCharCount += (block.prompt?.length || 0) + (block.explanation?.length || 0);
      if (block.prompt && opts.length >= 2) {
        hasSubstantiveInstruction = true;
      }
      break;
    }
    default:
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
    block,
    contentCharCount,
    hasSubstantiveInstruction,
  };
}

/**
 * Normalizes a lesson object into canonical schema shape for export and comparison.
 *
 * @param {import('../types/kord.d.ts').ContentPackageLessonInput | import('../types/kord.d.ts').Lesson} rawLesson
 * @param {number} [fallbackPosition]
 * @returns {import('../types/kord.d.ts').Lesson}
 */
export function normalizeLessonForPackage(rawLesson, fallbackPosition = 1) {
  const blocks = Array.isArray(rawLesson.blocks)
    ? rawLesson.blocks.map((b) => normalizeLessonBlock(b))
    : [];

  /** @type {import('../types/kord.d.ts').VideoEntry[]} */
  const videos = [];
  if (Array.isArray(rawLesson.videos)) {
    for (const v of rawLesson.videos) {
      const res = normalizeVideoEntry(v);
      if (res.valid && res.video) {
        videos.push({
          id: res.video.id,
          provider: res.video.provider,
          videoId: res.video.videoId,
          title: res.video.title,
          url: res.video.url,
          embedUrl: res.video.embedUrl,
          description: res.video.description,
          duration: res.video.duration,
          transcript: res.video.transcript,
          viewingInstructions: res.video.viewingInstructions,
          embedRestricted: res.video.embedRestricted,
        });
      }
    }
  }

  const furtherReading = Array.isArray(rawLesson.furtherReading)
    ? rawLesson.furtherReading
        .filter((fr) => fr && (fr.title || fr.url))
        .map((fr) => ({
          title: String(fr.title || '').trim(),
          source: String(fr.source || '').trim(),
          url: String(fr.url || '').trim(),
          resourceType: String(fr.resourceType || 'Guide').trim() || 'Guide',
        }))
    : [];

  return {
    id: rawLesson.id ? String(rawLesson.id).trim() : '',
    phaseId: rawLesson.phaseId ? String(rawLesson.phaseId).trim() : undefined,
    position: Number.isFinite(Number(rawLesson.position))
      ? Number(rawLesson.position)
      : fallbackPosition,
    title: String(rawLesson.title || '').trim(),
    introduction: String(rawLesson.introduction || '').trim(),
    objectives: Array.isArray(rawLesson.objectives)
      ? rawLesson.objectives.map((o) => String(o ?? '').trim()).filter(Boolean)
      : [],
    estMinutes: Number.isFinite(Number(rawLesson.estMinutes))
      ? Number(rawLesson.estMinutes)
      : 25,
    blocks,
    videos,
    summary: String(rawLesson.summary || '').trim(),
    takeaways: Array.isArray(rawLesson.takeaways)
      ? rawLesson.takeaways.map((t) => String(t ?? '').trim()).filter(Boolean)
      : [],
    furtherReading,
    isRequired: rawLesson.isRequired !== false,
    completionCriteria: String(rawLesson.completionCriteria || '').trim(),
    publicationStatus: String(rawLesson.publicationStatus || 'draft').trim() || 'draft',
  };
}

/**
 * Evaluates full instructional readiness, XSS safety, URL safety, and meaningful
 * instructional content for a single lesson (shared across import and publish checks).
 *
 * @param {import('../types/kord.d.ts').ContentPackageLessonInput | import('../types/kord.d.ts').Lesson} rawLesson
 * @returns {{ valid: boolean; errors: import('../types/kord.d.ts').DryRunValidationIssue[]; normalizedLesson: import('../types/kord.d.ts').Lesson }}
 */
export function validateLessonInstructionalContent(rawLesson) {
  /** @type {import('../types/kord.d.ts').DryRunValidationIssue[]} */
  const errors = [];

  if (!isPlainObject(rawLesson)) {
    return {
      valid: false,
      errors: [{ field: 'lesson', message: 'Lesson entry must be a JSON object.' }],
      normalizedLesson: normalizeLessonForPackage({ title: '' }),
    };
  }

  const title = String(rawLesson.title || '').trim();
  validateNoUnsafeHtmlOrScript(title, 'title', errors);
  if (title.length < 3) {
    errors.push({ field: 'title', message: 'Lesson title must be at least 3 characters.' });
  } else if (title.length > 200) {
    errors.push({ field: 'title', message: 'Lesson title cannot exceed 200 characters.' });
  }

  const estMinutes = rawLesson.estMinutes === undefined ? 25 : Number(rawLesson.estMinutes);
  if (!Number.isInteger(estMinutes) || estMinutes < 1 || estMinutes > 600) {
    errors.push({
      field: 'estMinutes',
      message: 'Estimated minutes must be an integer between 1 and 600.',
    });
  }

  if (rawLesson.position !== undefined && rawLesson.position !== null) {
    const pos = Number(rawLesson.position);
    if (!Number.isInteger(pos) || pos < 1) {
      errors.push({
        field: 'position',
        message: 'Lesson position must be a positive integer (>= 1).',
      });
    }
  }

  if (
    rawLesson.publicationStatus !== undefined &&
    rawLesson.publicationStatus !== null &&
    !['draft', 'published', 'archived'].includes(String(rawLesson.publicationStatus).trim())
  ) {
    errors.push({
      field: 'publicationStatus',
      message: 'publicationStatus must be "draft", "published", or "archived".',
    });
  }

  validateNoUnsafeHtmlOrScript(rawLesson.introduction, 'introduction', errors);
  validateNoUnsafeHtmlOrScript(rawLesson.summary, 'summary', errors);
  validateNoUnsafeHtmlOrScript(rawLesson.completionCriteria, 'completionCriteria', errors);

  if (Array.isArray(rawLesson.objectives)) {
    rawLesson.objectives.forEach((obj, idx) =>
      validateNoUnsafeHtmlOrScript(obj, `objectives[${idx}]`, errors)
    );
  } else if (rawLesson.objectives !== undefined) {
    errors.push({ field: 'objectives', message: 'objectives must be an array of strings.' });
  }

  if (Array.isArray(rawLesson.takeaways)) {
    rawLesson.takeaways.forEach((tk, idx) =>
      validateNoUnsafeHtmlOrScript(tk, `takeaways[${idx}]`, errors)
    );
  } else if (rawLesson.takeaways !== undefined) {
    errors.push({ field: 'takeaways', message: 'takeaways must be an array of strings.' });
  }

  // Validate blocks
  /** @type {import('../types/kord.d.ts').LessonBlock[]} */
  const normalizedBlocks = [];
  let totalInstructionalChars = String(rawLesson.introduction || '').trim().length;
  let hasSubstantiveBlock = false;

  if (!Array.isArray(rawLesson.blocks) || rawLesson.blocks.length === 0) {
    errors.push({
      field: 'blocks',
      message: 'Lesson must contain at least one structured content block.',
    });
  } else {
    rawLesson.blocks.forEach((rawBlk, bIdx) => {
      const blkResult = validateLessonBlock(rawBlk, bIdx);
      normalizedBlocks.push(blkResult.block);
      errors.push(...blkResult.errors);
      totalInstructionalChars += blkResult.contentCharCount;
      if (blkResult.hasSubstantiveInstruction) {
        hasSubstantiveBlock = true;
      }
    });
  }

  // Validate top-level videos
  /** @type {import('../types/kord.d.ts').VideoEntry[]} */
  const normalizedVideos = [];
  if (rawLesson.videos !== undefined) {
    if (!Array.isArray(rawLesson.videos)) {
      errors.push({ field: 'videos', message: 'videos must be an array.' });
    } else {
      rawLesson.videos.forEach((v, vIdx) => {
        if (!isPlainObject(v)) {
          errors.push({ field: `videos[${vIdx}]`, message: 'Each video entry must be an object.' });
          return;
        }
        validateNoUnsafeHtmlOrScript(v.title, `videos[${vIdx}].title`, errors);
        validateNoUnsafeHtmlOrScript(v.description, `videos[${vIdx}].description`, errors);
        validateNoUnsafeHtmlOrScript(v.transcript, `videos[${vIdx}].transcript`, errors);
        validateNoUnsafeHtmlOrScript(v.viewingInstructions, `videos[${vIdx}].viewingInstructions`, errors);
        const res = normalizeVideoEntry(/** @type {import('../types/kord.d.ts').VideoEntry} */ (v));
        if (!res.valid || !res.video) {
          errors.push({
            field: `videos[${vIdx}].url`,
            message: res.error || 'Invalid video reference.',
          });
        } else {
          normalizedVideos.push(res.video);
          hasSubstantiveBlock = true;
          totalInstructionalChars += 40;
        }
      });
    }
  }

  // Validate furtherReading resources
  /** @type {import('../types/kord.d.ts').FurtherReadingItem[]} */
  const normalizedResources = [];
  if (rawLesson.furtherReading !== undefined) {
    if (!Array.isArray(rawLesson.furtherReading)) {
      errors.push({ field: 'furtherReading', message: 'furtherReading must be an array.' });
    } else {
      rawLesson.furtherReading.forEach((fr, rIdx) => {
        if (!isPlainObject(fr)) {
          errors.push({ field: `furtherReading[${rIdx}]`, message: 'Resource entry must be an object.' });
          return;
        }
        const rTitle = String(fr.title || '').trim();
        const rSource = String(fr.source || '').trim();
        const rType = String(fr.resourceType || 'Guide').trim() || 'Guide';
        validateNoUnsafeHtmlOrScript(rTitle, `furtherReading[${rIdx}].title`, errors);
        validateNoUnsafeHtmlOrScript(rSource, `furtherReading[${rIdx}].source`, errors);
        validateNoUnsafeHtmlOrScript(rType, `furtherReading[${rIdx}].resourceType`, errors);
        if (!rTitle) {
          errors.push({
            field: `furtherReading[${rIdx}].title`,
            message: 'Further reading resource requires a title.',
          });
        }
        const urlCheck = isSafeContentUrl(fr.url, { allowRelative: false });
        if (!urlCheck.valid) {
          errors.push({
            field: `furtherReading[${rIdx}].url`,
            message: urlCheck.error || 'Further reading URL must be a valid https:// or http:// link.',
          });
        } else {
          normalizedResources.push({
            title: rTitle,
            source: rSource,
            url: urlCheck.url || String(fr.url).trim(),
            resourceType: rType,
          });
        }
      });
    }
  }

  // Meaningful instructional content check (no arbitrary minimum block count)
  if (Array.isArray(rawLesson.blocks) && rawLesson.blocks.length > 0) {
    if (!hasSubstantiveBlock || totalInstructionalChars < MIN_INSTRUCTIONAL_TEXT_CHARS) {
      errors.push({
        field: 'blocks',
        message: `Lesson lacks meaningful instructional content (include substantive explanation, example, demonstration, check, or video with at least ${MIN_INSTRUCTIONAL_TEXT_CHARS} instructional characters).`,
      });
    }
  }

  const normalizedLesson = {
    ...normalizeLessonForPackage(rawLesson),
    blocks: normalizedBlocks,
    videos: normalizedVideos,
    furtherReading: normalizedResources,
    estMinutes: Number.isInteger(estMinutes) ? estMinutes : 25,
  };

  return {
    valid: errors.length === 0,
    errors,
    normalizedLesson,
  };
}

/**
 * Strictly parses and validates a raw JSON string into a structured package envelope.
 *
 * @param {string} rawText
 * @returns {{ valid: true; packageData: import('../types/kord.d.ts').ContentPackage } | { valid: false; errors: import('../types/kord.d.ts').DryRunValidationIssue[] }}
 */
export function parseContentPackageJson(rawText) {
  /** @type {import('../types/kord.d.ts').DryRunValidationIssue[]} */
  const errors = [];

  if (typeof rawText !== 'string' || !rawText.trim()) {
    return {
      valid: false,
      errors: [{ field: 'package', message: 'Paste or upload a non-empty JSON content package.' }],
    };
  }

  const byteLen = new TextEncoder().encode(rawText).length;
  if (byteLen > MAX_PACKAGE_BYTES) {
    return {
      valid: false,
      errors: [
        {
          field: 'package',
          message: `Package exceeds maximum allowed size of ${Math.round(MAX_PACKAGE_BYTES / (1024 * 1024))} MB.`,
        },
      ],
    };
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      valid: false,
      errors: [
        {
          field: 'package',
          message: `Malformed JSON: ${err instanceof Error ? err.message : 'Unable to parse JSON'}.`,
        },
      ],
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      valid: false,
      errors: [{ field: 'package', message: 'Package root must be a JSON object.' }],
    };
  }

  if (String(parsed.schemaVersion || '').trim() !== CONTENT_PACKAGE_SCHEMA_VERSION) {
    errors.push({
      field: 'schemaVersion',
      message: `Unsupported or missing schemaVersion. Expected "${CONTENT_PACKAGE_SCHEMA_VERSION}".`,
    });
  }

  if (String(parsed.packageType || '').trim() !== CONTENT_PACKAGE_TYPE) {
    errors.push({
      field: 'packageType',
      message: `Unsupported or missing packageType. Expected "${CONTENT_PACKAGE_TYPE}".`,
    });
  }

  if (!isPlainObject(parsed.course) || (!parsed.course.id && !parsed.course.slug)) {
    errors.push({
      field: 'course',
      message: 'Package must include a "course" object with "id" or "slug" identifying the target course.',
    });
  }

  /** @type {import('../types/kord.d.ts').ContentPackagePhaseInput[]} */
  let normalizedPhases = [];
  if (Array.isArray(parsed.phases)) {
    normalizedPhases = parsed.phases.map((ph, pIdx) => {
      if (!isPlainObject(ph)) {
        errors.push({ field: `phases[${pIdx}]`, message: 'Each phase entry must be an object.' });
        return { lessons: [] };
      }
      if (!Array.isArray(ph.lessons)) {
        errors.push({
          field: `phases[${pIdx}].lessons`,
          message: 'Each phase entry must contain a "lessons" array.',
        });
        return {
          id: ph.id ? String(ph.id).trim() : undefined,
          position: ph.position !== undefined ? Number(ph.position) : undefined,
          title: ph.title ? String(ph.title).trim() : undefined,
          lessons: [],
        };
      }
      return {
        id: ph.id ? String(ph.id).trim() : undefined,
        position: ph.position !== undefined ? Number(ph.position) : undefined,
        title: ph.title ? String(ph.title).trim() : undefined,
        lessons: ph.lessons.map((les) => /** @type {import('../types/kord.d.ts').ContentPackageLessonInput} */ (les)),
      };
    });
  } else if (Array.isArray(parsed.lessons)) {
    normalizedPhases = [
      {
        lessons: parsed.lessons.map((les) => /** @type {import('../types/kord.d.ts').ContentPackageLessonInput} */ (les)),
      },
    ];
  } else {
    errors.push({
      field: 'phases',
      message: 'Package must contain a "phases" array (or top-level "lessons" array with phaseId).',
    });
  }

  const totalLessons = normalizedPhases.reduce((sum, ph) => sum + (ph.lessons?.length || 0), 0);
  if (totalLessons === 0 && errors.length === 0) {
    errors.push({
      field: 'phases',
      message: 'Package does not contain any lessons to validate or import.',
    });
  }
  if (totalLessons > MAX_PACKAGE_LESSONS) {
    errors.push({
      field: 'phases',
      message: `Package contains ${totalLessons} lessons, exceeding the per-import limit of ${MAX_PACKAGE_LESSONS}.`,
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    packageData: {
      schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION,
      packageType: CONTENT_PACKAGE_TYPE,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : undefined,
      course: {
        id: isPlainObject(parsed.course) && parsed.course.id ? String(parsed.course.id).trim() : undefined,
        slug: isPlainObject(parsed.course) && parsed.course.slug ? String(parsed.course.slug).trim() : undefined,
        title: isPlainObject(parsed.course) && parsed.course.title ? String(parsed.course.title).trim() : undefined,
        difficulty:
          isPlainObject(parsed.course) && parsed.course.difficulty
            ? String(parsed.course.difficulty).trim()
            : undefined,
        version:
          isPlainObject(parsed.course) && parsed.course.version !== undefined
            ? Number(parsed.course.version)
            : undefined,
      },
      phases: normalizedPhases,
    },
  };
}

/**
 * Compares an existing normalized lesson against a normalized incoming lesson
 * and returns field-level diffs.
 *
 * @param {import('../types/kord.d.ts').Lesson} beforeLesson
 * @param {import('../types/kord.d.ts').Lesson} afterLesson
 * @returns {import('../types/kord.d.ts').DryRunLessonDiff[]}
 */
export function compareNormalizedLessons(beforeLesson, afterLesson) {
  /** @type {Array<keyof import('../types/kord.d.ts').Lesson>} */
  const fieldsToCompare = [
    'position',
    'title',
    'introduction',
    'objectives',
    'estMinutes',
    'blocks',
    'videos',
    'summary',
    'takeaways',
    'furtherReading',
    'isRequired',
    'completionCriteria',
  ];

  /** @type {import('../types/kord.d.ts').DryRunLessonDiff[]} */
  const diffs = [];
  for (const field of fieldsToCompare) {
    const beforeVal = beforeLesson[field];
    const afterVal = afterLesson[field];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      diffs.push({
        field,
        before: beforeVal,
        after: afterVal,
      });
    }
  }
  return diffs;
}

/**
 * Performs complete read-only dry-run validation and change classification
 * against the selected target course.
 *
 * @param {{ packageData: import('../types/kord.d.ts').ContentPackage; targetCourse: import('../types/kord.d.ts').Course | null | undefined }} params
 * @returns {import('../types/kord.d.ts').DryRunImportPlan}
 */
export function buildDryRunImportPlan({ packageData, targetCourse }) {
  /** @type {import('../types/kord.d.ts').DryRunValidationIssue[]} */
  const packageErrors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {import('../types/kord.d.ts').DryRunLessonResult[]} */
  const lessonResults = [];

  if (!targetCourse) {
    return {
      valid: false,
      canCommit: false,
      schemaVersion: packageData?.schemaVersion || CONTENT_PACKAGE_SCHEMA_VERSION,
      packageType: packageData?.packageType || CONTENT_PACKAGE_TYPE,
      courseId: '',
      courseSlug: '',
      courseTitle: 'Unknown Course',
      totalProcessed: 0,
      counts: { new: 0, updated: 0, unchanged: 0, rejected: 0 },
      packageErrors: [{ field: 'course', message: 'Selected target course was not found.' }],
      lessons: [],
      warnings: [],
    };
  }

  const pkgCourseId = packageData.course?.id ? String(packageData.course.id).trim() : '';
  const pkgCourseSlug = packageData.course?.slug ? String(packageData.course.slug).trim() : '';
  if (!pkgCourseId && !pkgCourseSlug) {
    packageErrors.push({
      field: 'course',
      message: 'Package must specify course.id or course.slug matching the selected course.',
    });
  } else {
    if (pkgCourseId && pkgCourseId !== targetCourse.id) {
      packageErrors.push({
        field: 'course.id',
        message: `Package course.id ("${pkgCourseId}") does not match selected course ("${targetCourse.id}").`,
      });
    }
    if (pkgCourseSlug && pkgCourseSlug !== targetCourse.slug) {
      packageErrors.push({
        field: 'course.slug',
        message: `Package course.slug ("${pkgCourseSlug}") does not match selected course ("${targetCourse.slug}").`,
      });
    }
  }

  const targetPhases = (targetCourse.phases || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  /** @type {Map<string, import('../types/kord.d.ts').Phase>} */
  const phaseById = new Map();
  /** @type {Map<string, { lesson: import('../types/kord.d.ts').Lesson; phase: import('../types/kord.d.ts').Phase }>} */
  const existingLessonById = new Map();

  for (const ph of targetPhases) {
    phaseById.set(ph.id, ph);
    for (const les of ph.lessons || []) {
      existingLessonById.set(les.id, { lesson: les, phase: ph });
    }
  }

  /** @type {Set<string>} */
  const seenPackageLessonIds = new Set();

  // First pass: flatten package items with phase resolution & basic matching
  /** @type {Array<{ globalIndex: number; phaseId: string | null; rawLesson: import('../types/kord.d.ts').ContentPackageLessonInput; existingHit: { lesson: import('../types/kord.d.ts').Lesson; phase: import('../types/kord.d.ts').Phase } | null; explicitNew: boolean; providedId: string | null; earlyErrors: import('../types/kord.d.ts').DryRunValidationIssue[] }>} */
  const flatEntries = [];
  let globalIndex = 0;

  for (const pkgPhase of packageData.phases || []) {
    const pkgPhaseId = pkgPhase.id ? String(pkgPhase.id).trim() : '';
    for (const rawLes of pkgPhase.lessons || []) {
      const idx = globalIndex;
      globalIndex += 1;

      /** @type {import('../types/kord.d.ts').DryRunValidationIssue[]} */
      const earlyErrors = [];

      if (!isPlainObject(rawLes)) {
        flatEntries.push({
          globalIndex: idx,
          phaseId: pkgPhaseId || null,
          rawLesson: /** @type {import('../types/kord.d.ts').ContentPackageLessonInput} */ ({ title: '' }),
          existingHit: null,
          explicitNew: false,
          providedId: null,
          earlyErrors: [{ field: 'lesson', message: 'Lesson entry must be a JSON object.' }],
        });
        continue;
      }

      const resolvedPhaseId = rawLes.phaseId ? String(rawLes.phaseId).trim() : pkgPhaseId;
      if (!resolvedPhaseId) {
        earlyErrors.push({
          field: 'phaseId',
          message: 'Missing phaseId. Every lesson must reference an existing module/phase id (matching by title alone is not permitted).',
        });
      } else if (!phaseById.has(resolvedPhaseId)) {
        earlyErrors.push({
          field: 'phaseId',
          message: `Module/phase "${resolvedPhaseId}" does not exist in course "${targetCourse.title}". Bulk import does not silently create phases.`,
        });
      }

      if (pkgPhaseId && rawLes.phaseId && String(rawLes.phaseId).trim() !== pkgPhaseId) {
        earlyErrors.push({
          field: 'phaseId',
          message: `Lesson phaseId ("${rawLes.phaseId}") conflicts with enclosing phase ("${pkgPhaseId}").`,
        });
      }

      const providedId =
        typeof rawLes.id === 'string' && rawLes.id.trim() ? rawLes.id.trim() : null;
      const explicitNew = rawLes.isNew === true || rawLes.action === 'create';

      /** @type {{ lesson: import('../types/kord.d.ts').Lesson; phase: import('../types/kord.d.ts').Phase } | null} */
      let existingHit = null;

      if (providedId) {
        if (explicitNew) {
          earlyErrors.push({
            field: 'id',
            message: 'New lessons (isNew: true) must omit "id" so the database assigns a safe identifier.',
          });
        }
        if (seenPackageLessonIds.has(providedId)) {
          earlyErrors.push({
            field: 'id',
            message: `Duplicate lesson id "${providedId}" within this import package.`,
          });
        } else {
          seenPackageLessonIds.add(providedId);
        }

        existingHit = existingLessonById.get(providedId) || null;
        if (!existingHit) {
          earlyErrors.push({
            field: 'id',
            message: `Lesson id "${providedId}" was not found in course "${targetCourse.title}". Provide a valid existing lesson id or omit id with "isNew": true.`,
          });
        } else if (resolvedPhaseId && existingHit.phase.id !== resolvedPhaseId) {
          earlyErrors.push({
            field: 'phaseId',
            message: `Lesson "${providedId}" belongs to module "${existingHit.phase.id}", not "${resolvedPhaseId}". Cross-module moves are not supported in bulk import.`,
          });
        }
      } else if (!explicitNew) {
        earlyErrors.push({
          field: 'id',
          message: 'Missing lesson id. Provide an existing lesson "id" to update in place, or explicitly set "isNew": true to create a new draft lesson.',
        });
      }

      flatEntries.push({
        globalIndex: idx,
        phaseId: resolvedPhaseId || null,
        rawLesson: rawLes,
        existingHit,
        explicitNew,
        providedId,
        earlyErrors,
      });
    }
  }

  // Compute post-import target positions per phase to detect collisions accurately
  /** @type {Map<string, Map<number, string>>} */
  const occupiedPositionsByPhase = new Map();
  for (const ph of targetPhases) {
    /** @type {Map<number, string>} */
    const posMap = new Map();
    for (const les of ph.lessons || []) {
      if (!seenPackageLessonIds.has(les.id)) {
        posMap.set(Number(les.position || 0), les.title || les.id);
      }
    }
    occupiedPositionsByPhase.set(ph.id, posMap);
  }

  /** @type {Map<string, number>} */
  const nextAutoPositionByPhase = new Map();
  for (const ph of targetPhases) {
    const maxPos = (ph.lessons || []).reduce(
      (max, l) => Math.max(max, Number(l.position || 0)),
      0
    );
    nextAutoPositionByPhase.set(ph.id, maxPos + 1);
  }

  for (const entry of flatEntries) {
    const errors = [...entry.earlyErrors];
    /** @type {string[]} */
    const itemWarnings = [];

    const phaseObj = entry.phaseId ? phaseById.get(entry.phaseId) || null : null;
    const phaseTitle = phaseObj?.title || entry.phaseId || 'Unresolved Module';
    const validation = validateLessonInstructionalContent(entry.rawLesson);
    errors.push(...validation.errors);

    // Resolve target position
    let targetPosition =
      entry.rawLesson.position !== undefined && entry.rawLesson.position !== null
        ? Number(entry.rawLesson.position)
        : entry.existingHit
          ? Number(entry.existingHit.lesson.position || 1)
          : null;

    if (targetPosition === null && entry.phaseId && phaseObj) {
      let autoPos = nextAutoPositionByPhase.get(entry.phaseId) || 1;
      const occ = occupiedPositionsByPhase.get(entry.phaseId);
      while (occ && occ.has(autoPos)) {
        autoPos += 1;
      }
      targetPosition = autoPos;
      nextAutoPositionByPhase.set(entry.phaseId, autoPos + 1);
    }

    if (
      entry.phaseId &&
      phaseObj &&
      targetPosition !== null &&
      Number.isInteger(targetPosition) &&
      targetPosition >= 1
    ) {
      const occ = occupiedPositionsByPhase.get(entry.phaseId);
      const label = entry.rawLesson.title || entry.providedId || `Item #${entry.globalIndex + 1}`;
      if (occ) {
        if (occ.has(targetPosition)) {
          errors.push({
            field: 'position',
            message: `Position ${targetPosition} in module "${phaseTitle}" conflicts with "${occ.get(targetPosition)}".`,
          });
        } else if (errors.length === 0) {
          occ.set(targetPosition, label);
        }
      }
    }

    // Determine effective publication status (bulk import NEVER auto-publishes)
    const existingStatus = entry.existingHit
      ? String(entry.existingHit.lesson.publicationStatus || 'published')
      : null;
    const requestedStatus = entry.rawLesson.publicationStatus
      ? String(entry.rawLesson.publicationStatus).trim()
      : null;

    /** @type {'draft' | 'published'} */
    let effectiveStatus;
    if (entry.existingHit) {
      if (existingStatus === 'published') {
        effectiveStatus = 'published';
        if (requestedStatus === 'draft' || requestedStatus === 'archived') {
          itemWarnings.push(
            'Existing published lesson retains "published" status during bulk import to preserve enrolled learner progression.'
          );
        }
      } else {
        effectiveStatus = 'draft';
        if (requestedStatus === 'published') {
          itemWarnings.push(
            'Bulk import never auto-publishes draft lessons; lesson remains in "draft" for explicit admin publish.'
          );
        }
      }
    } else {
      effectiveStatus = 'draft';
      if (requestedStatus === 'published') {
        itemWarnings.push(
          'Newly imported lessons are created as "draft" and never auto-published.'
        );
      }
    }

    if (errors.length > 0 || packageErrors.length > 0) {
      lessonResults.push({
        index: entry.globalIndex,
        classification: 'rejected',
        lessonId: entry.providedId,
        phaseId: entry.phaseId,
        phaseTitle,
        title: String(entry.rawLesson.title || '(Untitled Lesson)').trim(),
        position: targetPosition,
        existingStatus,
        effectiveStatus,
        normalizedLesson: null,
        errors: errors.length > 0 ? errors : packageErrors,
        warnings: itemWarnings,
        changes: [],
        beforeLesson: entry.existingHit ? normalizeLessonForPackage(entry.existingHit.lesson) : null,
      });
      continue;
    }

    const candidateLesson = {
      ...validation.normalizedLesson,
      id: entry.existingHit ? entry.existingHit.lesson.id : '',
      phaseId: entry.phaseId || undefined,
      position: targetPosition || 1,
      publicationStatus: effectiveStatus,
    };

    if (!entry.existingHit) {
      lessonResults.push({
        index: entry.globalIndex,
        classification: 'new',
        lessonId: null,
        phaseId: entry.phaseId,
        phaseTitle,
        title: candidateLesson.title,
        position: candidateLesson.position,
        existingStatus: null,
        effectiveStatus,
        normalizedLesson: candidateLesson,
        errors: [],
        warnings: itemWarnings,
        changes: [
          { field: 'title', before: null, after: candidateLesson.title },
          { field: 'position', before: null, after: candidateLesson.position },
          { field: 'blocks', before: [], after: `${candidateLesson.blocks?.length || 0} blocks` },
        ],
        beforeLesson: null,
      });
    } else {
      const beforeNormalized = {
        ...normalizeLessonForPackage(entry.existingHit.lesson),
        phaseId: entry.phaseId || undefined,
        publicationStatus: existingStatus || 'published',
      };
      const changes = compareNormalizedLessons(beforeNormalized, candidateLesson);
      lessonResults.push({
        index: entry.globalIndex,
        classification: changes.length === 0 ? 'unchanged' : 'updated',
        lessonId: entry.existingHit.lesson.id,
        phaseId: entry.phaseId,
        phaseTitle,
        title: candidateLesson.title,
        position: candidateLesson.position,
        existingStatus,
        effectiveStatus,
        normalizedLesson: candidateLesson,
        errors: [],
        warnings: itemWarnings,
        changes,
        beforeLesson: beforeNormalized,
      });
    }
  }

  const counts = {
    new: lessonResults.filter((r) => r.classification === 'new').length,
    updated: lessonResults.filter((r) => r.classification === 'updated').length,
    unchanged: lessonResults.filter((r) => r.classification === 'unchanged').length,
    rejected: lessonResults.filter((r) => r.classification === 'rejected').length,
  };

  if (counts.new + counts.updated === 0 && counts.rejected === 0 && packageErrors.length === 0) {
    warnings.push('All lessons in this package already match the current course content (0 changes to commit).');
  }

  const valid = packageErrors.length === 0 && counts.rejected === 0;
  const canCommit = valid && counts.new + counts.updated > 0;

  return {
    valid,
    canCommit,
    schemaVersion: packageData.schemaVersion || CONTENT_PACKAGE_SCHEMA_VERSION,
    packageType: packageData.packageType || CONTENT_PACKAGE_TYPE,
    courseId: targetCourse.id,
    courseSlug: targetCourse.slug,
    courseTitle: targetCourse.title,
    totalProcessed: lessonResults.length,
    counts,
    packageErrors,
    lessons: lessonResults,
    warnings,
  };
}

/**
 * Generates a downloadable JSON validation & rejection report from a dry-run plan.
 *
 * @param {import('../types/kord.d.ts').DryRunImportPlan} plan
 * @returns {import('../types/kord.d.ts').ImportErrorReport}
 */
export function buildImportErrorReport(plan) {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: plan.schemaVersion,
    courseId: plan.courseId,
    courseTitle: plan.courseTitle,
    packageErrors: plan.packageErrors || [],
    rejectedLessons: (plan.lessons || [])
      .filter((l) => l.classification === 'rejected' || l.errors.length > 0)
      .map((l) => ({
        index: l.index,
        lessonId: l.lessonId,
        phaseId: l.phaseId,
        title: l.title,
        errors: l.errors,
      })),
  };
}

/**
 * Exports a single course curriculum into the canonical versioned JSON package format.
 * Contains zero learner PII, enrollments, completions, or private assessment answer keys.
 *
 * @param {import('../types/kord.d.ts').Course} course
 * @returns {import('../types/kord.d.ts').ContentPackage}
 */
export function buildCourseExportPackage(course) {
  const sortedPhases = (course.phases || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));

  return {
    schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION,
    packageType: CONTENT_PACKAGE_TYPE,
    exportedAt: new Date().toISOString(),
    course: {
      id: course.id,
      slug: course.slug,
      title: course.title,
      difficulty: course.difficulty || 'Beginner',
      version: Number(course.version || 1),
    },
    phases: sortedPhases.map((ph) => {
      const sortedLessons = (ph.lessons || [])
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      return {
        id: ph.id,
        position: Number(ph.position || 1),
        title: ph.title,
        lessons: sortedLessons.map((les) => {
          const normalized = normalizeLessonForPackage(les, Number(les.position || 1));
          return {
            ...normalized,
            phaseId: ph.id,
          };
        }),
      };
    }),
  };
}

/**
 * Builds a complete restorable curriculum snapshot for course_versions.snapshotData.
 * Contains zero learner data or PII.
 *
 * @param {import('../types/kord.d.ts').Course} course
 * @returns {import('../types/kord.d.ts').CourseCurriculumSnapshot}
 */
export function buildCourseCurriculumSnapshot(course) {
  const sortedPhases = (course.phases || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));

  return {
    schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    course: {
      id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description || '',
      targetAudience: course.targetAudience || '',
      outcomes: Array.isArray(course.outcomes) ? course.outcomes.slice() : [],
      difficulty: course.difficulty || 'Beginner',
      estimatedDurationWeeks: Number(course.estimatedDurationWeeks || 4),
      recommendedWeeklyHours: Number(course.recommendedWeeklyHours || 4),
      recommendedSchedule: course.recommendedSchedule || '',
      prerequisites: Array.isArray(course.prerequisites) ? course.prerequisites.slice() : [],
      thumbnailUrl: course.thumbnailUrl || '',
      authorName: course.authorName || 'Kord Curriculum Studio',
      completionRules: course.completionRules ? { ...course.completionRules } : undefined,
      publicationStatus: String(course.publicationStatus || 'draft'),
      version: Number(course.version || 1),
    },
    phases: sortedPhases.map((ph) => ({
      id: ph.id,
      position: Number(ph.position || 1),
      title: ph.title,
      summary: ph.summary || '',
      objectives: Array.isArray(ph.objectives) ? ph.objectives.slice() : [],
      difficulty: ph.difficulty || 'Beginner',
      estHours: Number(ph.estHours || 2),
      publicationStatus: String(ph.publicationStatus || 'published'),
      lessons: (ph.lessons || [])
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
        .map((les) => ({
          ...normalizeLessonForPackage(les, Number(les.position || 1)),
          phaseId: ph.id,
        })),
    })),
  };
}
