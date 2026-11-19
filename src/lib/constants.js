export const ADMIN_EMAIL = 'ethoppaofficial@gmail.com';

export const SKILL_CATEGORIES = [
  'All',
  'Communication',
  'Data & Digital',
  'Product & Web',
];

export const SKILL_LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'];

export const PROGRESSION_LADDER = [
  { key: 'declared', label: 'Declared', rank: 1, weight: 0.3, hint: 'Self-declared interest or baseline' },
  { key: 'practising', label: 'Practising', rank: 2, weight: 0.6, hint: 'Earned by passing a phase quiz or completing roadmap activities' },
  { key: 'demonstrated', label: 'Demonstrated', rank: 3, weight: 0.8, hint: 'Earned by passing the skill-check quiz' },
  { key: 'verified', label: 'Verified', rank: 4, weight: 1.0, hint: 'Earned when an administrator approves challenge evidence' },
];

export const PROGRESSION_RANK = {
  declared: 1,
  practising: 2,
  demonstrated: 3,
  verified: 4,
};

export const PROGRESSION_WEIGHT = {
  declared: 0.3,
  practising: 0.6,
  demonstrated: 0.8,
  verified: 1.0,
};

export const PROGRESSION_LABEL = {
  declared: 'Declared',
  practising: 'Practising',
  demonstrated: 'Demonstrated',
  verified: 'Verified',
};

export const OPPORTUNITY_TYPES = ['All', 'Internship', 'Junior Role', 'Apprenticeship', 'Fellowship', 'Project'];
export const WORK_MODES = ['All', 'Remote', 'Hybrid', 'On-site'];
