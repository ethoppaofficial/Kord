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

export function validateEvidenceFile(file, challenge = {}) {
  if (!file) return null;
  const maxMb = Number(challenge.maxFileSizeMb || 25);
  const maxBytes = maxMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return `File exceeds the ${maxMb} MB maximum upload size for this assignment.`;
  }
  const allowedMimes =
    Array.isArray(challenge.allowedMimeTypes) && challenge.allowedMimeTypes.length > 0
      ? challenge.allowedMimeTypes
      : DEFAULT_ALLOWED_MIME_TYPES;
  if (file.type && !allowedMimes.includes(file.type)) {
    return `File type (${file.type}) is not permitted for this assignment. Accepted types: ${allowedMimes.join(', ')}.`;
  }
  return null;
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

