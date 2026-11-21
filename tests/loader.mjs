// Preloaded Node test environment shim for browser globals used by Kord frontend repositories.
function createMemoryStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
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
  const listeners = new Map();
  globalThis.window = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    location: {
      origin: 'http://localhost:3000',
      pathname: '/',
      search: '',
      hash: '',
    },
    history: {
      pushState(_state, _title, url) {
        if (typeof url === 'string') {
          const [pathPart, hashPart = ''] = url.split('#');
          const [pathname, search = ''] = pathPart.split('?');
          globalThis.window.location.pathname = pathname || '/';
          globalThis.window.location.search = search ? `?${search}` : '';
          globalThis.window.location.hash = hashPart ? `#${hashPart}` : '';
        }
      },
      replaceState(_state, _title, url) {
        globalThis.window.history.pushState(_state, _title, url);
      },
    },
    scrollTo() {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      const type = event?.type;
      if (!type) return true;
      for (const fn of Array.from(listeners.get(type) || [])) {
        fn(event);
      }
      return true;
    },
  };
}
