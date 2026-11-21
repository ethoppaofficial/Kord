const cleanupHandlers = new Set();

export function registerSessionCleanup(fn) {
  if (typeof fn !== 'function') return () => {};
  cleanupHandlers.add(fn);
  return () => cleanupHandlers.delete(fn);
}

export function runSessionCleanup() {
  for (const fn of cleanupHandlers) {
    try {
      fn();
    } catch {
      // Never block session transition cleanup on a secondary cache reset error
    }
  }
}
