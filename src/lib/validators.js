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

export function validateSubmissionForm({ evidenceUrl, file, explanation }) {
  const errors = {};
  const hasUrl = Boolean(evidenceUrl && evidenceUrl.trim().length > 0);
  const hasFile = Boolean(file);

  if (!hasUrl && !hasFile) {
    errors.evidence = 'Provide an evidence URL, upload a file, or both.';
  }
  if (hasUrl && !isValidUrl(evidenceUrl)) {
    errors.evidenceUrl = 'Enter a full URL starting with https:// or http://.';
  }
  if (!explanation || explanation.trim().length < 20) {
    errors.explanation = 'Explain what you built and how it meets the brief (at least 20 characters).';
  }
  return errors;
}
