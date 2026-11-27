// Preloaded Node test environment shim for browser globals used by Kord frontend repositories.
/** @returns {Storage} */
function createMemoryStorage() {
  /** @type {Map<string, string>} */
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    /** @param {string} key */
    getItem(key) {
      return store.get(key) ?? null;
    },
    /**
     * @param {string} key
     * @param {string} value
     */
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    /** @param {string} key */
    removeItem(key) {
      store.delete(key);
    },
    /** @param {number} index */
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

if (!globalThis.localStorage) {
  globalThis.localStorage = createMemoryStorage();
}

if (!globalThis.sessionStorage) {
  globalThis.sessionStorage = createMemoryStorage();
}

if (!globalThis.window) {
  /** @type {Map<string, Set<(event: unknown) => void>>} */
  const listeners = new Map();
  globalThis.window = /** @type {Window & typeof globalThis} */ (/** @type {unknown} */ ({
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    location: {
      origin: 'http://localhost:3000',
      pathname: '/',
      search: '',
      hash: '',
    },
    history: {
      /**
       * @param {unknown} _state
       * @param {string} _title
       * @param {string | URL | null | undefined} url
       */
      pushState(_state, _title, url) {
        if (typeof url === 'string') {
          const [pathPart, hashPart = ''] = url.split('#');
          const [pathname, search = ''] = pathPart.split('?');
          globalThis.window.location.pathname = pathname || '/';
          globalThis.window.location.search = search ? `?${search}` : '';
          globalThis.window.location.hash = hashPart ? `#${hashPart}` : '';
        }
      },
      /**
       * @param {unknown} _state
       * @param {string} _title
       * @param {string | URL | null | undefined} url
       */
      replaceState(_state, _title, url) {
        globalThis.window.history.pushState(_state, _title, url);
      },
    },
    scrollTo() {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    /**
     * @param {string} type
     * @param {(event: unknown) => void} fn
     */
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      let bucket = listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        listeners.set(type, bucket);
      }
      bucket.add(fn);
    },
    /**
     * @param {string} type
     * @param {(event: unknown) => void} fn
     */
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    /** @param {{ type?: string }} [event] */
    dispatchEvent(event) {
      const type = event?.type;
      if (!type) return true;
      for (const fn of Array.from(listeners.get(type) || [])) {
        fn(event);
      }
      return true;
    },
  }));
}
