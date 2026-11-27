// Lightweight DOM & browser-tab harness for testing Kord SPA routing, auth, and cross-tab events in Node.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * @param {string} attrText
 * @returns {Map<string, string>}
 */
function parseAttributes(attrText) {
  /** @type {Map<string, string>} */
  const attrs = new Map();
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs.set(key, val);
  }
  return attrs;
}

/**
 * @param {TestElement | null} el
 * @param {string} part
 * @returns {boolean}
 */
function matchesSimpleSelector(el, part) {
  if (!el || el.nodeType !== 1) return false;
  let rest = part.trim();
  if (!rest) return false;

  const tagMatch = rest.match(/^[a-zA-Z0-9_-]+/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }

  while (rest.length > 0) {
    if (rest.startsWith('#')) {
      const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
      if (!m || el.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('.')) {
      const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!m) return false;
      const classes = String(el.className || '').split(/\s+/).filter(Boolean);
      if (!classes.includes(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('[')) {
      const m = rest.match(/^\[([^=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/);
      if (!m) return false;
      const attrName = m[1].trim();
      const expected = m[2] ?? m[3] ?? m[4];
      if (!el.hasAttribute(attrName)) return false;
      if (expected !== undefined && el.getAttribute(attrName) !== expected) return false;
      rest = rest.slice(m[0].length);
    } else {
      return false;
    }
  }
  return true;
}

/**
 * @param {TestElement} el
 * @param {string} selector
 * @returns {boolean}
 */
function matchesSelector(el, selector) {
  const groups = selector.split(',').map((s) => s.trim()).filter(Boolean);
  for (const group of groups) {
    const parts = group.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    if (!matchesSimpleSelector(el, parts[parts.length - 1])) continue;
    /** @type {TestElement | null} */
    let cur = el.parentNode;
    let idx = parts.length - 2;
    while (idx >= 0 && cur) {
      if (matchesSimpleSelector(cur, parts[idx])) {
        idx -= 1;
      }
      cur = cur.parentNode;
    }
    if (idx < 0) return true;
  }
  return false;
}

/**
 * @param {TestElement} parent
 * @param {string} html
 */
function parseHtmlInto(parent, html) {
  parent.children = [];
  const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z0-9_-]+)([^>]*)>|([^<]+)/g;
  const stack = [parent];
  let match;
  while ((match = tokenRe.exec(String(html || ''))) !== null) {
    const full = match[0];
    if (full.startsWith('<!--')) continue;

    if (match[3] !== undefined) {
      const top = stack[stack.length - 1];
      top._textNodes.push(match[3]);
      continue;
    }

    const tag = match[1].toLowerCase();
    const isClosing = full.startsWith('</');
    const isSelfClosing = full.endsWith('/>') || VOID_TAGS.has(tag);

    if (isClosing) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === tag.toUpperCase()) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const el = new TestElement(tag);
    const attrs = parseAttributes(match[2] || '');
    for (const [k, v] of attrs.entries()) {
      el.setAttribute(k, v);
    }
    stack[stack.length - 1].appendChild(el);
    if (!isSelfClosing) {
      stack.push(el);
    }
  }
}

export class TestElement {
  constructor(tagName = 'div') {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    /** @type {TestElement[]} */
    this.children = [];
    /** @type {TestElement | null} */
    this.parentNode = null;
    /** @type {Map<string, string>} */
    this.attributes = new Map();
    /** @type {Map<string, Set<(event: unknown) => unknown>>} */
    this.listeners = new Map();
    /** @type {Record<string, string>} */
    this.style = {};
    this._rawInnerHTML = '';
    /** @type {string[]} */
    this._textNodes = [];
    this.value = '';
    this.disabled = false;
    this.checked = false;
  }

  get id() {
    return this.attributes.get('id') || '';
  }

  set id(val) {
    this.setAttribute('id', val);
  }

  get className() {
    return this.attributes.get('class') || '';
  }

  set className(val) {
    this.setAttribute('class', val);
  }

  get dataset() {
    const el = this;
    return /** @type {Record<string, string | undefined>} */ (new Proxy(
      /** @type {Record<string, string | undefined>} */ ({}),
      {
        get(_t, prop) {
          const kebab = String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          return el.getAttribute(`data-${kebab}`) ?? undefined;
        },
        set(_t, prop, val) {
          const kebab = String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          el.setAttribute(`data-${kebab}`, String(val));
          return true;
        },
      }
    ));
  }

  /**
   * @param {string} name
   * @param {unknown} value
   */
  setAttribute(name, value) {
    const val = String(value ?? '');
    this.attributes.set(name, val);
    if (name === 'value') this.value = val;
  }

  /**
   * @param {string} name
   * @returns {string | null}
   */
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  hasAttribute(name) {
    return this.attributes.has(name);
  }

  get innerHTML() {
    return this._rawInnerHTML;
  }

  set innerHTML(val) {
    this._rawInnerHTML = String(val ?? '');
    this._textNodes = [];
    parseHtmlInto(this, this._rawInnerHTML);
  }

  /** @returns {string} */
  get textContent() {
    return this._textNodes.join('') + this.children.map((c) => c.textContent).join('');
  }

  set textContent(val) {
    this.children = [];
    this._textNodes = [String(val ?? '')];
    this._rawInnerHTML = String(val ?? '');
  }

  /**
   * @param {TestElement} child
   * @returns {TestElement}
   */
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  /**
   * @param {TestElement} child
   * @returns {TestElement}
   */
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  /**
   * @param {TestElement | null | undefined} target
   * @returns {boolean}
   */
  contains(target) {
    if (!target) return false;
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
  }

  /**
   * @param {string} selector
   * @returns {TestElement | null}
   */
  closest(selector) {
    /** @type {TestElement | null} */
    let cur = this;
    while (cur) {
      if (matchesSelector(cur, selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  /**
   * @param {string} selector
   * @returns {TestElement[]}
   */
  querySelectorAll(selector) {
    /** @type {TestElement[]} */
    const out = [];
    /** @param {TestElement} node */
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /**
   * @param {string} selector
   * @returns {TestElement | null}
   */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  /**
   * @param {string} type
   * @param {(event: unknown) => unknown} fn
   */
  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(fn);
  }

  /**
   * @param {string} type
   * @param {(event: unknown) => unknown} fn
   */
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  /**
   * @param {{ type: string; [key: string]: unknown }} event
   */
  async dispatchEvent(event) {
    const evt = {
      defaultPrevented: false,
      target: this,
      currentTarget: this,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event,
    };
    for (const fn of Array.from(this.listeners.get(evt.type) || [])) {
      await fn(evt);
    }
    return evt;
  }

  async click() {
    const evt = await this.dispatchEvent({ type: 'click', target: this });
    if (globalThis.document && !evt.defaultPrevented) {
      await globalThis.document.dispatchEvent(
        /** @type {Event} */ (/** @type {unknown} */ ({
          type: 'click',
          target: this,
          preventDefault() {},
        }))
      );
    }
    return evt;
  }
}

export function installDomHarness() {
  /** @type {Map<string, Set<(event: unknown) => unknown>>} */
  const docListeners = new Map();
  const body = new TestElement('body');

  const doc = {
    body,
    visibilityState: 'visible',
    /** @param {string} tag */
    createElement(tag) {
      return new TestElement(tag);
    },
    /**
     * @param {string} type
     * @param {(event: unknown) => unknown} fn
     */
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      let bucket = docListeners.get(type);
      if (!bucket) {
        bucket = new Set();
        docListeners.set(type, bucket);
      }
      bucket.add(fn);
    },
    /**
     * @param {string} type
     * @param {(event: unknown) => unknown} fn
     */
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
    /** @param {{ type: string; [key: string]: unknown }} event */
    async dispatchEvent(event) {
      const evt = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...event,
      };
      for (const fn of Array.from(docListeners.get(evt.type) || [])) {
        await fn(evt);
      }
      return evt;
    },
    /** @param {string} sel */
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
    /** @param {string} sel */
    querySelector(sel) {
      return body.querySelector(sel);
    },
  };

  const OriginalFormData = globalThis.FormData;
  class TestFormData {
    /** @param {TestElement} formEl */
    constructor(formEl) {
      /** @type {Map<string, string>} */
      this.map = new Map();
      if (formEl && typeof formEl.querySelectorAll === 'function') {
        const inputs = formEl.querySelectorAll('input, textarea, select');
        for (const el of inputs) {
          const name = el.getAttribute('name');
          if (!name) continue;
          this.map.set(name, el.value ?? el.getAttribute('value') ?? '');
        }
      }
    }
    /** @param {string} name */
    get(name) {
      return this.map.get(name) ?? null;
    }
  }

  globalThis.document = /** @type {Document} */ (/** @type {unknown} */ (doc));
  globalThis.FormData = /** @type {typeof FormData} */ (/** @type {unknown} */ (TestFormData));

  return {
    document: doc,
    body,
    createRoot() {
      const root = new TestElement('div');
      root.id = 'root';
      body.appendChild(root);
      return root;
    },
    cleanup() {
      body.children = [];
      globalThis.FormData = OriginalFormData;
    },
  };
}

export async function flushMicrotasks(ticks = 6) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}
