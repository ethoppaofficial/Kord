// Lightweight DOM & browser-tab harness for testing Kord SPA routing, auth, and cross-tab events in Node.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function parseAttributes(attrText) {
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

function matchesSelector(el, selector) {
  const groups = selector.split(',').map((s) => s.trim()).filter(Boolean);
  for (const group of groups) {
    const parts = group.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    if (!matchesSimpleSelector(el, parts[parts.length - 1])) continue;
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
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this._rawInnerHTML = '';
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

  setAttribute(name, value) {
    const val = String(value ?? '');
    this.attributes.set(name, val);
    if (name === 'value') this.value = val;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

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

  get textContent() {
    return this._textNodes.join('') + this.children.map((c) => c.textContent).join('');
  }

  set textContent(val) {
    this.children = [];
    this._textNodes = [String(val ?? '')];
    this._rawInnerHTML = String(val ?? '');
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  contains(target) {
    if (!target) return false;
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (matchesSelector(cur, selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

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
      await globalThis.document.dispatchEvent({
        type: 'click',
        target: this,
        preventDefault() {},
      });
    }
    return evt;
  }
}

export function installDomHarness() {
  const docListeners = new Map();
  const body = new TestElement('body');

  const doc = {
    body,
    visibilityState: 'visible',
    createElement(tag) {
      return new TestElement(tag);
    },
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
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
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
    querySelector(sel) {
      return body.querySelector(sel);
    },
  };

  const OriginalFormData = globalThis.FormData;
  class TestFormData {
    constructor(formEl) {
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
    get(name) {
      return this.map.has(name) ? this.map.get(name) : null;
    }
  }

  globalThis.document = doc;
  globalThis.FormData = TestFormData;

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
