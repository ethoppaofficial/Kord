export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function isValidUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateLoginForm({ email, password }) {
  const errors = {};
  if (!isValidEmail(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!password || String(password).length < 6) {
    errors.password = 'Password must be at least 6 characters.';
  }
  return errors;
}

export function validateForgotPasswordForm({ email }) {
  const errors = {};
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail) {
    errors.email = 'Enter your email address.';
  } else if (cleanEmail.length > 254) {
    errors.email = 'Email address must be 254 characters or fewer.';
  } else if (!isValidEmail(cleanEmail)) {
    errors.email = 'Enter a valid email address.';
  }
  return errors;
}

export function validateResetPasswordForm({ password, confirmPassword }) {
  const errors = {};
  const rawPassword = String(password || '');
  const rawConfirm = String(confirmPassword || '');

  if (!rawPassword || rawPassword.length < 6) {
    errors.password = 'Password must be at least 6 characters.';
  } else if (rawPassword.length > 128) {
    errors.password = 'Password must be 128 characters or fewer.';
  }

  if (!rawConfirm) {
    errors.confirmPassword = 'Confirm your new password.';
  } else if (rawPassword !== rawConfirm) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}

export function validateSignupForm({ firstName, lastName, email, password, confirmPassword }) {
  const errors = {};
  if (!firstName || String(firstName).trim().length < 2) {
    errors.firstName = 'Enter your first name (at least 2 characters).';
  }
  if (!lastName || String(lastName).trim().length < 1) {
    errors.lastName = 'Enter your last name.';
  }
  if (!isValidEmail(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!password || String(password).length < 6) {
    errors.password = 'Password must be at least 6 characters.';
  }
  if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }
  return errors;
}

export const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

export const MIME_EXTENSION_MAP = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'text/plain': ['txt'],
  'text/markdown': ['md', 'markdown'],
  'text/csv': ['csv'],
  'application/zip': ['zip'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/webm': ['webm'],
  'audio/ogg': ['ogg'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
};

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'js', 'mjs', 'cjs', 'html', 'htm', 'svg', 'php', 'py', 'rb', 'dll', 'msi', 'app',
]);

export function getFileExtension(fileName) {
  const clean = String(fileName || '').trim();
  const idx = clean.lastIndexOf('.');
  if (idx <= 0 || idx === clean.length - 1) return '';
  return clean.slice(idx + 1).toLowerCase();
}

export function validateEvidenceFile(file, challenge = {}) {
  if (!file) return null;
  const maxMb = Number(challenge.maxFileSizeMb || 25);
  const maxBytes = maxMb * 1024 * 1024;
  if (Number(file.size || 0) <= 0) {
    return 'Uploaded file appears empty.';
  }
  if (file.size > maxBytes) {
    return `File exceeds the ${maxMb} MB maximum upload size for this assignment.`;
  }

  const ext = getFileExtension(file.name);
  if (!ext || BLOCKED_EXTENSIONS.has(ext)) {
    return `File extension ".${ext || 'unknown'}" is not allowed for security reasons.`;
  }

  const allowedMimes =
    Array.isArray(challenge.allowedMimeTypes) && challenge.allowedMimeTypes.length > 0
      ? challenge.allowedMimeTypes
      : DEFAULT_ALLOWED_MIME_TYPES;

  const allowedExts = new Set(
    allowedMimes.flatMap((mime) => MIME_EXTENSION_MAP[mime] || [])
  );

  if (!allowedExts.has(ext)) {
    return `File extension ".${ext}" is not permitted for this assignment. Accepted extensions: ${Array.from(allowedExts).map((e) => `.${e}`).join(', ')}.`;
  }

  if (!file.type || !allowedMimes.includes(file.type)) {
    return `File MIME type (${file.type || 'missing'}) is not permitted for this assignment. Accepted types: ${allowedMimes.join(', ')}.`;
  }

  const mimeExts = MIME_EXTENSION_MAP[file.type] || [];
  if (mimeExts.length > 0 && !mimeExts.includes(ext)) {
    return `File extension ".${ext}" does not match declared MIME type "${file.type}".`;
  }

  return null;
}

export function sanitizeEvidenceFilename(fileName) {
  const base = String(fileName || 'evidence').split(/[\\/]/).pop() || 'evidence';
  const dotIdx = base.lastIndexOf('.');
  const rawStem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
  const rawExt = dotIdx > 0 ? base.slice(dotIdx + 1) : '';
  const safeStem = rawStem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'evidence';
  const safeExt = rawExt.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12);
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

function bytesMatch(bytes, offset, expected) {
  if (!bytes || bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

function asciiAt(bytes, offset, length) {
  if (!bytes || bytes.length < offset + length) return '';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

export async function inspectEvidenceFileSignature(file) {
  if (!file) return null;
  const ext = getFileExtension(file.name);
  let buffer;
  try {
    const slice = typeof file.slice === 'function' ? file.slice(0, 512) : file;
    if (typeof slice?.arrayBuffer === 'function') {
      buffer = await slice.arrayBuffer();
    } else if (typeof file.arrayBuffer === 'function') {
      buffer = (await file.arrayBuffer()).slice(0, 512);
    } else {
      return null;
    }
  } catch {
    return 'Unable to inspect uploaded file header.';
  }

  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return 'Uploaded file appears empty.';
  }

  if (ext === 'pdf') {
    if (asciiAt(bytes, 0, 5) !== '%PDF-') {
      return 'File contents do not match a valid PDF document (%PDF- signature missing).';
    }
  } else if (ext === 'png') {
    if (!bytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return 'File contents do not match a valid PNG image signature.';
    }
  } else if (ext === 'jpg' || ext === 'jpeg') {
    if (!bytesMatch(bytes, 0, [0xff, 0xd8, 0xff])) {
      return 'File contents do not match a valid JPEG image signature.';
    }
  } else if (ext === 'webp') {
    if (asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WEBP') {
      return 'File contents do not match a valid WebP image container.';
    }
  } else if (ext === 'zip' || ext === 'docx') {
    const isZip =
      bytesMatch(bytes, 0, [0x50, 0x4b, 0x03, 0x04]) ||
      bytesMatch(bytes, 0, [0x50, 0x4b, 0x05, 0x06]) ||
      bytesMatch(bytes, 0, [0x50, 0x4b, 0x07, 0x08]);
    if (!isZip) {
      return `File contents do not match a valid .${ext} archive container.`;
    }
  } else if (ext === 'wav') {
    if (asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WAVE') {
      return 'File contents do not match a valid WAV audio header.';
    }
  } else if (ext === 'ogg') {
    if (asciiAt(bytes, 0, 4) !== 'OggS') {
      return 'File contents do not match a valid Ogg container signature.';
    }
  } else if (ext === 'mp3') {
    const hasId3 = asciiAt(bytes, 0, 3) === 'ID3';
    const hasFrameSync = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    if (!hasId3 && !hasFrameSync) {
      return 'File contents do not match a valid MP3 audio header.';
    }
  } else if (ext === 'mp4' || ext === 'm4a' || ext === 'mov') {
    if (asciiAt(bytes, 4, 4) !== 'ftyp') {
      return `File contents do not match a valid .${ext} media container (ftyp box missing).`;
    }
  } else if (ext === 'webm') {
    if (!bytesMatch(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
      return 'File contents do not match a valid WebM container signature.';
    }
  } else if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'csv') {
    if (bytes.includes(0)) {
      return 'Binary data detected inside plain-text evidence file.';
    }
    if (bytesMatch(bytes, 0, [0x4d, 0x5a]) || bytesMatch(bytes, 0, [0x7f, 0x45, 0x4c, 0x46])) {
      return 'Executable binary payload disguised as a text file is not allowed.';
    }
    const sample = asciiAt(bytes, 0, Math.min(bytes.length, 256)).toLowerCase();
    if (
      sample.includes('<script') ||
      sample.includes('<!doctype html') ||
      sample.includes('<html') ||
      sample.includes('<svg')
    ) {
      return 'Active HTML or script markup inside text evidence files is blocked for security.';
    }
  }

  return null;
}

export async function validateEvidenceFileContent(file, challenge = {}) {
  const syncError = validateEvidenceFile(file, challenge);
  if (syncError) return syncError;
  return inspectEvidenceFileSignature(file);
}

export function validateRubricWeights(rubric = []) {
  if (!Array.isArray(rubric) || rubric.length === 0) {
    return { valid: false, totalWeight: 0, totalPoints: 0, error: 'Rubric must include at least 1 criterion.' };
  }
  let totalWeight = 0;
  let totalPoints = 0;
  for (const item of rubric) {
    const label = String(item?.label || '').trim();
    const maxPts = Number(item?.maxPoints || 0);
    const weight = Number(item?.weightPercent ?? item?.weight ?? 0);
    if (!label) {
      return { valid: false, totalWeight, totalPoints, error: 'Every rubric criterion needs a label.' };
    }
    if (!Number.isFinite(maxPts) || maxPts <= 0) {
      return { valid: false, totalWeight, totalPoints, error: `Rubric criterion "${label}" must have maxPoints > 0.` };
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      return { valid: false, totalWeight, totalPoints, error: `Rubric criterion "${label}" must have weightPercent > 0.` };
    }
    totalWeight += weight;
    totalPoints += maxPts;
  }
  if (Math.round(totalWeight) !== 100) {
    return {
      valid: false,
      totalWeight,
      totalPoints,
      error: `Rubric weights must total 100% (currently ${totalWeight}%).`,
    };
  }
  return { valid: true, totalWeight, totalPoints, error: null };
}

export function validateSubmissionForm({ evidenceUrl, repoUrl, file, submissionText, explanation, challenge = {} }) {
  const errors = {};
  const allowed =
    Array.isArray(challenge.allowedEvidenceTypes) && challenge.allowedEvidenceTypes.length > 0
      ? challenge.allowedEvidenceTypes
      : ['written', 'file', 'project_url', 'repo_url', 'screenshot', 'audio', 'video'];

  const hasUrl = Boolean(evidenceUrl && evidenceUrl.trim().length > 0);
  const hasRepo = Boolean(repoUrl && repoUrl.trim().length > 0);
  const hasFile = Boolean(file);
  const rawText = String(submissionText || '').trim();
  const hasWritten = rawText.length >= 20;

  if (!hasUrl && !hasRepo && !hasFile && !hasWritten) {
    errors.evidence =
      'Provide at least one permitted deliverable (project URL, repository link, uploaded file, or written response of 20+ characters).';
  }
  if (hasUrl) {
    if (!allowed.includes('project_url')) {
      errors.evidenceUrl = 'Project URLs are not listed in accepted evidence types for this assignment.';
    } else if (!isValidUrl(evidenceUrl)) {
      errors.evidenceUrl = 'Enter a full URL starting with https:// or http://.';
    }
  }
  if (hasRepo) {
    if (!allowed.includes('repo_url')) {
      errors.repoUrl = 'Repository links are not listed in accepted evidence types for this assignment.';
    } else if (!isValidUrl(repoUrl)) {
      errors.repoUrl = 'Enter a valid repository URL starting with https:// or http://.';
    }
  }
  if (rawText.length > 0 && !allowed.includes('written')) {
    errors.submissionText = 'Written text deliverables are not accepted for this assignment.';
  }
  if (hasFile) {
    const acceptsAnyFile =
      allowed.includes('file') ||
      allowed.includes('screenshot') ||
      allowed.includes('audio') ||
      allowed.includes('video');
    if (!acceptsAnyFile) {
      errors.file = 'File uploads are not accepted for this assignment.';
    } else {
      const fileErr = validateEvidenceFile(file, challenge);
      if (fileErr) {
        errors.file = fileErr;
      } else if (!allowed.includes('file')) {
        const mime = String(file.type || '');
        const subtypeOk =
          (allowed.includes('screenshot') && mime.startsWith('image/')) ||
          (allowed.includes('audio') && mime.startsWith('audio/')) ||
          (allowed.includes('video') && mime.startsWith('video/'));
        if (!subtypeOk) {
          errors.file = 'Uploaded file category is not accepted for this assignment.';
        }
      }
    }
  }
  if (!explanation || explanation.trim().length < 20) {
    errors.explanation = 'Explain what you produced and how it meets the brief (at least 20 characters).';
  }
  return errors;
}

