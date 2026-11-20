import { createInitialSeed, CURRENT_SEED_VERSION } from './seedData.js';
import { clearIdempotencyCache } from '../idempotency.js';

const STORAGE_KEY = 'kord_app_state_v5';

const REQUIRED_FLAGSHIP_COURSE_IDS = [
  'course-frontend-foundations',
  'course-graphic-design-foundations',
  'course-digital-marketing-foundations',
  'course-communication-public-speaking',
];

const listeners = new Set();

function mergeById(seedItems = [], storedItems = []) {
  const map = new Map();
  seedItems.forEach((item) => {
    if (item?.id) map.set(item.id, item);
  });
  storedItems.forEach((item) => {
    if (!item?.id) return;
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
}

function mergeSkills(seedSkills = [], storedSkills = []) {
  const storedById = new Map(storedSkills.filter((s) => s?.id).map((s) => [s.id, s]));
  const result = [];
  const seenIds = new Set();

  seedSkills.forEach((seedSkill) => {
    seenIds.add(seedSkill.id);
    const existing = storedById.get(seedSkill.id);
    if (!existing) {
      result.push(seedSkill);
      return;
    }
    result.push({
      ...seedSkill,
      ...existing,
      supportedByCourseSlug: seedSkill.supportedByCourseSlug || existing.supportedByCourseSlug || null,
      publicationStatus: existing.publicationStatus || seedSkill.publicationStatus || 'published',
      outcomes:
        Array.isArray(existing.outcomes) && existing.outcomes.length > 0
          ? existing.outcomes
          : seedSkill.outcomes,
    });
  });

  storedSkills.forEach((item) => {
    if (item?.id && !seenIds.has(item.id)) {
      result.push(item);
    }
  });

  return result;
}

function mergeUsers(seedUsers = [], storedUsers = []) {
  const byId = new Map();
  const seenEmails = new Set();
  storedUsers.forEach((u) => {
    if (!u?.id) return;
    byId.set(u.id, u);
    if (u.email) seenEmails.add(String(u.email).toLowerCase());
  });
  seedUsers.forEach((u) => {
    const email = String(u.email || '').toLowerCase();
    if (!byId.has(u.id) && (!email || !seenEmails.has(email))) {
      byId.set(u.id, u);
    }
  });
  return Array.from(byId.values());
}

function needsCurriculumMigration(parsed) {
  if (!parsed || typeof parsed !== 'object') return true;
  if (parsed.seedVersion !== CURRENT_SEED_VERSION) return true;
  const courseIds = new Set((parsed.courses || []).map((c) => c.id));
  return REQUIRED_FLAGSHIP_COURSE_IDS.some((id) => !courseIds.has(id));
}

function migrateDemoState(parsed) {
  const seed = createInitialSeed();
  const merged = {
    ...seed,
    ...parsed,
    seedVersion: CURRENT_SEED_VERSION,
    users: mergeUsers(seed.users, parsed.users || []),
    currentUserId: parsed.currentUserId ?? null,
    categories: mergeById(seed.categories, parsed.categories || []),
    skills: mergeSkills(seed.skills, parsed.skills || []),
    courses: mergeById(seed.courses, parsed.courses || []),
    courseVersions: mergeById(seed.courseVersions, parsed.courseVersions || []),
    quizzes: mergeById(seed.quizzes, parsed.quizzes || []),
    privateQuizAnswers: {
      ...(parsed.privateQuizAnswers || {}),
      ...(seed.privateQuizAnswers || {}),
    },
    challenges: mergeById(seed.challenges, parsed.challenges || []),
    opportunities: mergeById(seed.opportunities, parsed.opportunities || []),
    userSkills: Array.isArray(parsed.userSkills) ? parsed.userSkills : [],
    courseEnrollments: Array.isArray(parsed.courseEnrollments) ? parsed.courseEnrollments : [],
    lessonProgress: Array.isArray(parsed.lessonProgress) ? parsed.lessonProgress : [],
    activityProgress: Array.isArray(parsed.activityProgress) ? parsed.activityProgress : [],
    quizAttempts: Array.isArray(parsed.quizAttempts) ? parsed.quizAttempts : [],
    submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
    courseCompletions: Array.isArray(parsed.courseCompletions) ? parsed.courseCompletions : [],
  };
  return merged;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = createInitialSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !Array.isArray(parsed.skills) ||
      !Array.isArray(parsed.courses) ||
      !Array.isArray(parsed.categories) ||
      parsed.skills.length < 20
    ) {
      const seed = createInitialSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }

    if (needsCurriculumMigration(parsed)) {
      const migrated = migrateDemoState(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    parsed.activityProgress = parsed.activityProgress || [];
    parsed.courseVersions = parsed.courseVersions || [];
    parsed.courseCompletions = parsed.courseCompletions || [];
    return parsed;
  } catch {
    return createInitialSeed();
  }
}

let state = loadState();

export function getDemoState() {
  return state;
}

export function updateDemoState(updater) {
  const next = typeof updater === 'function' ? updater(structuredClone(state)) : updater;
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors in restricted sandboxes
  }
  listeners.forEach((fn) => fn(state));
  return state;
}

export function subscribeDemoState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetDemoState() {
  clearIdempotencyCache();
  const fresh = createInitialSeed();
  return updateDemoState(fresh);
}
