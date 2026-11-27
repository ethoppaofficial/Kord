import { createInitialSeed, CURRENT_SEED_VERSION } from './seedData.js';
import { runSessionCleanup } from '../sessionLifecycle.js';

const STORAGE_KEY = 'kord_app_state_v5';
const CURRENT_USER_SESSION_KEY = 'kord_current_user_id';

const REQUIRED_FLAGSHIP_COURSE_IDS = [
  'course-frontend-foundations',
  'course-graphic-design-foundations',
  'course-digital-marketing-foundations',
  'course-communication-public-speaking',
];

/**
 * @typedef {(
 *   state: import('../../types/kord.d.ts').DemoState,
 *   meta: {
 *     fromStorageEvent?: boolean;
 *     previousUserId?: string | null;
 *     previousRole?: string | null;
 *     nextUserId?: string | null;
 *     nextRole?: string | null;
 *   }
 * ) => void} DemoStateListener
 */

/** @type {Set<DemoStateListener>} */
const listeners = new Set();
/** @type {string | null} */
let lastSerializedState = null;

export function getDemoCurrentUserId() {
  try {
    const storage =
      typeof window !== 'undefined' && window.sessionStorage
        ? window.sessionStorage
        : typeof sessionStorage !== 'undefined'
          ? sessionStorage
          : null;
    if (!storage) return null;
    const val = storage.getItem(CURRENT_USER_SESSION_KEY);
    return val || null;
  } catch {
    return null;
  }
}

/** @param {string | null | undefined} userId */
export function setDemoCurrentUserId(userId) {
  try {
    const storage =
      typeof window !== 'undefined' && window.sessionStorage
        ? window.sessionStorage
        : typeof sessionStorage !== 'undefined'
          ? sessionStorage
          : null;
    if (!storage) return;
    if (userId) {
      storage.setItem(CURRENT_USER_SESSION_KEY, String(userId));
    } else {
      storage.removeItem(CURRENT_USER_SESSION_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

/**
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function stripSessionFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { currentUserId: _omitted, ...clean } = /** @type {Record<string, unknown>} */ (obj);
  return /** @type {T} */ (clean);
}

/**
 * @template {{ id?: string }} T
 * @param {T[]} [seedItems]
 * @param {T[]} [storedItems]
 * @returns {T[]}
 */
function mergeById(seedItems = [], storedItems = []) {
  /** @type {Map<string, T>} */
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

/**
 * @param {import('../../types/kord.d.ts').Skill[]} [seedSkills]
 * @param {import('../../types/kord.d.ts').Skill[]} [storedSkills]
 * @returns {import('../../types/kord.d.ts').Skill[]}
 */
function mergeSkills(seedSkills = [], storedSkills = []) {
  const storedById = new Map(storedSkills.filter((s) => s?.id).map((s) => [s.id, s]));
  /** @type {import('../../types/kord.d.ts').Skill[]} */
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
      categoryId: seedSkill.categoryId,
      category: seedSkill.category,
      supportedByCourseSlug: seedSkill.supportedByCourseSlug ?? null,
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

/**
 * @param {import('../../types/kord.d.ts').KordUser[]} [seedUsers]
 * @param {import('../../types/kord.d.ts').KordUser[]} [storedUsers]
 * @returns {import('../../types/kord.d.ts').KordUser[]}
 */
function mergeUsers(seedUsers = [], storedUsers = []) {
  /** @type {Map<string, import('../../types/kord.d.ts').KordUser>} */
  const byId = new Map();
  const seenEmails = new Set();
  storedUsers.forEach((u) => {
    if (!u?.id) return;
    byId.set(u.id, { ...u, accountStatus: u.accountStatus || 'active' });
    if (u.email) seenEmails.add(String(u.email).toLowerCase());
  });
  seedUsers.forEach((u) => {
    const email = String(u.email || '').toLowerCase();
    if (!byId.has(u.id) && (!email || !seenEmails.has(email))) {
      byId.set(u.id, { ...u, accountStatus: u.accountStatus || 'active' });
    }
  });
  return Array.from(byId.values());
}

/** @param {unknown} parsed */
function needsCurriculumMigration(parsed) {
  if (!parsed || typeof parsed !== 'object') return true;
  const obj = /** @type {{ seedVersion?: unknown; courses?: Array<{ id?: string }> }} */ (parsed);
  if (obj.seedVersion !== CURRENT_SEED_VERSION) return true;
  const courseIds = new Set((obj.courses || []).map((c) => c.id));
  return REQUIRED_FLAGSHIP_COURSE_IDS.some((id) => !courseIds.has(id));
}

/**
 * @param {Record<string, any>} parsed
 * @returns {import('../../types/kord.d.ts').DemoState}
 */
function migrateDemoState(parsed) {
  const seed = createInitialSeed();
  const cleanParsed = stripSessionFields(parsed);
  const merged = {
    ...seed,
    ...cleanParsed,
    seedVersion: CURRENT_SEED_VERSION,
    users: mergeUsers(seed.users, cleanParsed.users || []),
    categories: mergeById(seed.categories, cleanParsed.categories || []),
    skills: mergeSkills(seed.skills, cleanParsed.skills || []),
    courses: mergeById(seed.courses, cleanParsed.courses || []),
    courseVersions: mergeById(seed.courseVersions, cleanParsed.courseVersions || []),
    quizzes: mergeById(seed.quizzes, cleanParsed.quizzes || []),
    privateQuizAnswers: {
      ...(cleanParsed.privateQuizAnswers || {}),
      ...(seed.privateQuizAnswers || {}),
    },
    challenges: mergeById(seed.challenges, cleanParsed.challenges || []),
    opportunities: mergeById(seed.opportunities, cleanParsed.opportunities || []),
    userSkills: Array.isArray(cleanParsed.userSkills) ? cleanParsed.userSkills : [],
    courseEnrollments: Array.isArray(cleanParsed.courseEnrollments) ? cleanParsed.courseEnrollments : [],
    lessonProgress: Array.isArray(cleanParsed.lessonProgress) ? cleanParsed.lessonProgress : [],
    activityProgress: Array.isArray(cleanParsed.activityProgress) ? cleanParsed.activityProgress : [],
    quizAttempts: Array.isArray(cleanParsed.quizAttempts) ? cleanParsed.quizAttempts : [],
    quizSessions: Array.isArray(cleanParsed.quizSessions) ? cleanParsed.quizSessions : [],
    submissions: Array.isArray(cleanParsed.submissions) ? cleanParsed.submissions : [],
    courseCompletions: Array.isArray(cleanParsed.courseCompletions) ? cleanParsed.courseCompletions : [],
    adminAuditLogs: Array.isArray(cleanParsed.adminAuditLogs) ? cleanParsed.adminAuditLogs : [],
  };
  return stripSessionFields(merged);
}

/**
 * @param {string | null} raw
 * @param {{ persistIfSeeded?: boolean }} [opts]
 * @returns {import('../../types/kord.d.ts').DemoState}
 */
function parseOrSeedState(raw, { persistIfSeeded = true } = {}) {
  try {
    if (!raw) {
      const seed = stripSessionFields(createInitialSeed());
      const serialized = JSON.stringify(seed);
      if (persistIfSeeded) {
        localStorage.setItem(STORAGE_KEY, serialized);
        lastSerializedState = serialized;
      }
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
      const seed = stripSessionFields(createInitialSeed());
      const serialized = JSON.stringify(seed);
      if (persistIfSeeded) {
        localStorage.setItem(STORAGE_KEY, serialized);
        lastSerializedState = serialized;
      }
      return seed;
    }

    if (needsCurriculumMigration(parsed) || Object.prototype.hasOwnProperty.call(parsed, 'currentUserId')) {
      const migrated = migrateDemoState(parsed);
      const serialized = JSON.stringify(migrated);
      if (persistIfSeeded) {
        localStorage.setItem(STORAGE_KEY, serialized);
        lastSerializedState = serialized;
      }
      return migrated;
    }

    parsed.activityProgress = parsed.activityProgress || [];
    parsed.courseVersions = parsed.courseVersions || [];
    parsed.courseCompletions = parsed.courseCompletions || [];
    parsed.quizSessions = parsed.quizSessions || [];
    parsed.adminAuditLogs = parsed.adminAuditLogs || [];
    parsed.users = (parsed.users || []).map((/** @type {import('../../types/kord.d.ts').KordUser} */ u) => ({
      ...u,
      accountStatus: u.accountStatus || 'active',
    }));
    lastSerializedState = raw;
    return stripSessionFields(parsed);
  } catch {
    return stripSessionFields(createInitialSeed());
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Ensure sessionStorage is consulted on initial load
    getDemoCurrentUserId();
    return parseOrSeedState(raw, { persistIfSeeded: true });
  } catch {
    return stripSessionFields(createInitialSeed());
  }
}

let state = loadState();

export function syncDemoStateFromStorage({ emit = true, forceEmit = false } = {}) {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return state;
  }

  if (raw === lastSerializedState && !forceEmit) {
    return state;
  }

  const next = parseOrSeedState(raw, { persistIfSeeded: raw === null });
  state = next;

  const activeUserId = getDemoCurrentUserId();
  const activeUser = activeUserId
    ? (next?.users || []).find((u) => u.id === activeUserId) || null
    : null;
  const activeRole = activeUser?.role || null;

  if (emit) {
    listeners.forEach((fn) =>
      fn(state, {
        fromStorageEvent: true,
        previousUserId: activeUserId,
        previousRole: activeRole,
        nextUserId: activeUserId,
        nextRole: activeRole,
      })
    );
  }

  return state;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (!event || event.key === null || event.key === STORAGE_KEY) {
      syncDemoStateFromStorage({ emit: true, forceEmit: true });
    }
  });
}

export function getDemoState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== lastSerializedState) {
      syncDemoStateFromStorage({ emit: false });
    }
  } catch {
    // Ignore storage read errors in restricted contexts
  }
  return state;
}

/**
 * @param {import('../../types/kord.d.ts').DemoState | ((draft: import('../../types/kord.d.ts').DemoState) => import('../../types/kord.d.ts').DemoState)} updater
 * @returns {import('../../types/kord.d.ts').DemoState}
 */
export function updateDemoState(updater) {
  // Reconcile with any external tab writes before mutating
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== lastSerializedState) {
      syncDemoStateFromStorage({ emit: false });
    }
  } catch {
    // ignore
  }

  const next = stripSessionFields(
    typeof updater === 'function' ? updater(structuredClone(state)) : updater
  );
  state = next;
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialized);
    lastSerializedState = serialized;
  } catch {
    // Ignore storage quota errors in restricted sandboxes
  }

  const activeUserId = getDemoCurrentUserId();
  const activeRole = activeUserId
    ? (state?.users || []).find((u) => u.id === activeUserId)?.role || null
    : null;

  listeners.forEach((fn) =>
    fn(state, {
      fromStorageEvent: false,
      previousUserId: activeUserId,
      previousRole: activeRole,
      nextUserId: activeUserId,
      nextRole: activeRole,
    })
  );
  return state;
}

/** @param {DemoStateListener} fn */
export function subscribeDemoState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetDemoState() {
  runSessionCleanup();
  setDemoCurrentUserId(null);
  const fresh = stripSessionFields(createInitialSeed());
  return updateDemoState(fresh);
}
