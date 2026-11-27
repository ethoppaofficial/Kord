import { registerSessionCleanup } from './sessionLifecycle.js';

/** @type {Map<string, Promise<unknown>>} */
const inFlightActions = new Map();
/** @type {Map<string, unknown>} */
const completedResults = new Map();

/**
 * Generates a deterministic idempotency key from stable payload parts,
 * or a unique intent key when passed a nonce.
 * @param {string} namespace
 * @param {...unknown} parts
 */
export function buildIdempotencyKey(namespace, ...parts) {
  const normalized = parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim().toLowerCase()))
    .join('|');
  return `${namespace}:${normalized}`;
}

/**
 * Ensures an async action with the same idempotencyKey cannot run concurrently
 * or execute duplicate writes within the session window.
 * @template T
 * @param {string} idempotencyKey
 * @param {() => Promise<T> | T} fn
 * @param {{ cacheResult?: boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function runIdempotent(idempotencyKey, fn, { cacheResult = false } = {}) {
  if (!idempotencyKey) {
    return fn();
  }

  if (cacheResult && completedResults.has(idempotencyKey)) {
    return /** @type {T} */ (completedResults.get(idempotencyKey));
  }

  if (inFlightActions.has(idempotencyKey)) {
    return /** @type {Promise<T>} */ (inFlightActions.get(idempotencyKey));
  }

  const promise = Promise.resolve()
    .then(() => fn())
    .then((result) => {
      if (cacheResult) {
        completedResults.set(idempotencyKey, result);
      }
      return result;
    })
    .finally(() => {
      if (inFlightActions.get(idempotencyKey) === promise) {
        inFlightActions.delete(idempotencyKey);
      }
    });

  inFlightActions.set(idempotencyKey, promise);
  return promise;
}

export function clearIdempotencyCache(prefix = '') {
  if (!prefix) {
    completedResults.clear();
    inFlightActions.clear();
    return;
  }
  for (const key of completedResults.keys()) {
    if (key.startsWith(prefix)) completedResults.delete(key);
  }
  for (const key of inFlightActions.keys()) {
    if (key.startsWith(prefix)) inFlightActions.delete(key);
  }
}

registerSessionCleanup(() => clearIdempotencyCache());
