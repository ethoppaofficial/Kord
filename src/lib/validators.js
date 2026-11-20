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
  const allowed = Array.isArray(challenge.allowedEvidenceTypes) && challenge.allowedEvidenceTypes.length > 0
    ? challenge.allowedEvidenceTypes
    : ['written', 'file', 'project_url', 'repo_url', 'screenshot', 'audio', 'video'];

  const hasUrl = Boolean(evidenceUrl && evidenceUrl.trim().length > 0);
  const hasRepo = Boolean(repoUrl && repoUrl.trim().length > 0);
  const hasFile = Boolean(file);
  const hasWritten = Boolean(submissionText && submissionText.trim().length >= 20);

  if (!hasUrl && !hasRepo && !hasFile && !hasWritten) {
    errors.evidence = 'Provide at least one permitted deliverable (project URL, repository link, uploaded file, or written response of 20+ characters).';
  }
  if (hasUrl && !isValidUrl(evidenceUrl)) {
    errors.evidenceUrl = 'Enter a full URL starting with https:// or http://.';
  }
  if (hasRepo && !isValidUrl(repoUrl)) {
    errors.repoUrl = 'Enter a valid repository URL starting with https:// or http://.';
  }
  if (hasRepo && !allowed.includes('repo_url') && !allowed.includes('project_url')) {
    errors.repoUrl = 'Repository links are not listed in accepted evidence types for this assignment.';
  }
  if (hasFile) {
    const fileErr = validateEvidenceFile(file, challenge);
    if (fileErr) errors.file = fileErr;
  }
  if (!explanation || explanation.trim().length < 20) {
    errors.explanation = 'Explain what you produced and how it meets the brief (at least 20 characters).';
  }
  return errors;
}

