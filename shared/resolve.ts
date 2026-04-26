/**
 * Source resolution: given a DOM element, figure out where it's defined.
 *
 * Priority:
 *   1. data-overlay-src attribute (stamped by framework plugin)
 *   2. React fiber _debugSource (React dev builds)
 *   3. CSS selector fallback (always works)
 */

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

// ── data-overlay-src (framework plugin stamp) ──────────────────

function resolveFromStamp(el: Element): SourceLocation | null {
  let cur: Element | null = el;
  while (cur) {
    const attr = cur.getAttribute?.('data-overlay-src');
    if (attr) {
      const parts = attr.split(':');
      const col = parts.pop();
      const line = parts.pop();
      const file = parts.join(':');
      if (file && line) {
        return {
          file,
          line: parseInt(line, 10),
          column: col ? parseInt(col, 10) : undefined,
        };
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

// ── React fiber _debugSource ───────────────────────────────────

function getFiber(node: Element): unknown {
  const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
  return key ? (node as unknown as Record<string, unknown>)[key] : null;
}

function resolveFromFiber(el: Element): SourceLocation | null {
  const fiber = getFiber(el);
  if (!fiber) return null;
  let cur = fiber as
    | { _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number }; return?: unknown }
    | null;
  while (cur) {
    const src = cur._debugSource;
    if (src?.fileName && !src.fileName.includes('node_modules')) {
      return { file: src.fileName, line: src.lineNumber, column: src.columnNumber };
    }
    cur = cur.return as typeof cur;
  }
  return null;
}

// ── CSS selector builder (always works) ────────────────────────

export function buildSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${cssEscape(testId)}"]`;

  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    let seg = cur.tagName.toLowerCase();
    if (cur.className && typeof cur.className === 'string') {
      const cls = cur.className
        .trim()
        .split(/\s+/)
        .filter((c) => !c.startsWith('__') && c.length < 40)
        .slice(0, 2)
        .map(cssEscape)
        .join('.');
      if (cls) seg += `.${cls}`;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const tag = cur.tagName;
      const siblings = Array.from(parent.children).filter(
        (c: Element) => c.tagName === tag,
      );
      if (siblings.length > 1) {
        seg += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(seg);
    if (parts.length >= 4) break;
    cur = parent;
  }
  return parts.join(' > ');
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return s.replace(/([^\w-])/g, '\\$1');
}

// ── Notable attributes ─────────────────────────────────────────

const NOTABLE_ATTRS = ['id', 'data-testid', 'aria-label', 'role', 'href', 'name', 'type', 'placeholder'];

export function captureAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of NOTABLE_ATTRS) {
    const v = el.getAttribute(name);
    if (v) out[name] = v.slice(0, 200);
  }
  return out;
}

// ── Combined resolver ──────────────────────────────────────────

export function resolveSource(el: Element): SourceLocation | null {
  return resolveFromStamp(el) ?? resolveFromFiber(el) ?? null;
}
