import { createInitialSeed } from './seedData.js';
import { clearIdempotencyCache } from '../idempotency.js';

const STORAGE_KEY = 'kord_app_state_v3';

const listeners = new Set();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = createInitialSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.skills) || !parsed.opportunities?.[0]?.responsibilities) {
      const seed = createInitialSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
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
