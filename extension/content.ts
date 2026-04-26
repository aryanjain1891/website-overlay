/**
 * Content script: injected into every page. Creates the pick overlay inside
 * a Shadow DOM so styles are fully isolated from the host page.
 */

import type { PickedElement, QueueItem, SidecarStatus } from '../shared/types';
import { resolveSource, buildSelector, captureAttributes } from '../shared/resolve';
import { formatQueueForClipboard } from '../shared/format';

const ATTR = 'data-wo-overlay';

function circleNumber(i: number): string {
  if (i < 20) return String.fromCodePoint(0x2460 + i);
  return `#${i + 1}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c],
  );
}

function shortPath(abs: string): string {
  const srcIdx = abs.lastIndexOf('/src/');
  if (srcIdx >= 0) return abs.slice(srcIdx + 1);
  const parts = abs.split('/');
  return parts.slice(-2).join('/');
}

function sendMsg(msg: any): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

interface BufferSlot {
  picked: PickedElement;
  el: Element | null;
  badge: HTMLDivElement | null;
}

export function mount() {
  if ((window as any).__websiteOverlayMounted) return;
  (window as any).__websiteOverlayMounted = true;

  // ── Shadow host ─────────────────────────────────────────
  const host = document.createElement('div');
  host.setAttribute(ATTR, 'true');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  // ── Drawer/modal anchoring ──────────────────────────────
  // When the user picks an element that lives inside a drawer/dialog/popup,
  // we move the shadow host INTO that container. The drawer's
  // outside-click check (`!drawer.contains(target)` or composedPath-based)
  // then sees our host as *inside* the drawer and leaves it open.
  //
  // Detection is best-effort across frameworks: explicit ARIA/DOM markers
  // first, then a positional fallback (closest fixed/absolute ancestor with
  // the highest z-index containing the picked element).
  const DEFAULT_HOST_PARENT = document.documentElement;
  const DRAWER_CLASS_RE =
    /drawer|modal|sheet|sidebar|popover|popup|panel|dialog|flyout|overlay|offcanvas/i;

  function looksLikeDrawer(el: Element): boolean {
    const role = el.getAttribute?.('role') || '';
    if (el.tagName === 'DIALOG') return true;
    if (el.hasAttribute?.('aria-modal')) return true;
    if (['dialog', 'complementary', 'menu', 'listbox', 'tooltip'].includes(role)) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (DRAWER_CLASS_RE.test(cls)) return true;
    if (el.hasAttribute?.('data-radix-popper-content-wrapper')) return true;
    if (el.hasAttribute?.('data-headlessui-state')) return true;
    if (el.hasAttribute?.('data-floating-ui-portal')) return true;
    const dataState = el.getAttribute?.('data-state');
    if (dataState && /open|visible/i.test(dataState)) return true;
    return false;
  }

  function findDrawerAncestor(el: Element | null): Element | null {
    if (!el) return null;
    // Phase 1 — explicit markers walking up the tree.
    let cur: Element | null = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (looksLikeDrawer(cur)) return cur;
      cur = cur.parentElement;
    }
    // Phase 2 — positional fallback: the highest-z-index fixed/absolute
    // ancestor that contains the picked element.
    cur = el;
    let best: Element | null = null;
    let bestZ = -Infinity;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      if (cs.position === 'fixed' || cs.position === 'absolute') {
        const z = parseInt(cs.zIndex, 10);
        if (!isNaN(z) && z >= bestZ) {
          bestZ = z;
          best = cur;
        }
      }
      cur = cur.parentElement;
    }
    // Only treat positional match as a drawer if it has nontrivial z-index;
    // otherwise we'd anchor into random positioned wrappers.
    return bestZ > 0 ? best : null;
  }

  /**
   * Re-parenting host into an ancestor that has `transform`, `perspective`,
   * `filter`, or `will-change: transform` would break our `position: fixed`
   * positioning (it becomes fixed-relative-to-that-ancestor). Detect that.
   */
  function hasTransformedAncestor(target: Element): boolean {
    let cur: Element | null = target;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      if (
        cs.transform !== 'none' ||
        cs.perspective !== 'none' ||
        cs.filter !== 'none' ||
        /transform/.test(cs.willChange)
      ) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function anchorHostTo(target: Element) {
    if (host.parentElement === target) return;
    if (hasTransformedAncestor(target)) {
      // Don't move — transformed ancestor would clip/offset our fixed UI.
      // Drawer will close in this case; there's no safe in-DOM anchor.
      return;
    }
    target.appendChild(host);
  }

  function restoreHostParent() {
    if (host.parentElement !== DEFAULT_HOST_PARENT) {
      DEFAULT_HOST_PARENT.appendChild(host);
    }
  }

  // Frameworks (React, Vue) re-render and may detach our host along with the
  // drawer. Watch for that and reattach to documentElement so the overlay
  // never disappears.
  const hostWatcher = new MutationObserver(() => {
    if (!document.documentElement.contains(host)) {
      DEFAULT_HOST_PARENT.appendChild(host);
    }
  });
  hostWatcher.observe(document.documentElement, { childList: true, subtree: true });

  // AbortController binds the lifetime of every window/document listener
  // below to a single signal — calling ac.abort() in deactivate() removes
  // them all atomically. Without this, "Disable here" would leave dead
  // listeners attached to the page, causing both UI ghosts and memory
  // leaks across enable/disable cycles.
  const ac = new AbortController();


  // Inject styles into shadow
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .wo-highlight {
      position: fixed; pointer-events: none;
      border: 2px solid #3b82f6; background: rgba(59,130,246,0.12);
      border-radius: 3px; transition: all 50ms ease; display: none;
    }
    .wo-btn {
      border: 0; cursor: pointer; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      user-select: none; outline: none;
    }
    .wo-pill {
      position: fixed; bottom: 16px; right: 16px;
      padding: 8px 14px; border-radius: 999px;
      background: #111827; color: #fff; border: 1px solid #374151;
      font: 500 12px -apple-system, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.18);
      pointer-events: auto;
    }
    .wo-pill.picking { background: #dc2626; }
    .wo-queue-btn {
      position: fixed; bottom: 16px; right: auto;
      padding: 8px 12px; border-radius: 999px;
      background: #fff; color: #111827; border: 1px solid #d1d5db;
      font: 500 12px -apple-system, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      pointer-events: auto; display: none;
    }
    .wo-comment-btn {
      position: fixed; bottom: 72px; left: 50%; transform: translateX(-50%);
      padding: 10px 18px; border-radius: 999px;
      background: #16a34a; color: #fff;
      font: 600 13px -apple-system, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      pointer-events: auto; display: none;
    }
    .wo-badge {
      position: fixed; transform: translate(-35%, -35%);
      background: #2563eb; color: #fff; min-width: 22px; height: 22px;
      padding: 0 6px; border-radius: 999px;
      display: flex; align-items: center; justify-content: center;
      font: 600 12px -apple-system, sans-serif;
      pointer-events: none; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      border: 2px solid #fff; white-space: nowrap;
    }
    .wo-popover {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      width: 460px; max-width: calc(100vw - 32px);
      background: #fff; color: #111827; border: 1px solid #e5e7eb;
      border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,0.28);
      font: 13px -apple-system, sans-serif;
      pointer-events: auto; display: none; padding: 12px;
    }
    .wo-popover textarea {
      width: 100%; min-height: 84px; border: 1px solid #d1d5db;
      border-radius: 6px; padding: 8px; font: 13px -apple-system, sans-serif;
      resize: vertical; outline: none;
    }
    .wo-popover textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
    .wo-small-btn {
      padding: 6px 10px; border: 1px solid #d1d5db; background: #fff;
      border-radius: 6px; font: 12px -apple-system, sans-serif;
    }
    .wo-primary-btn {
      padding: 6px 14px; border: 0; background: #111827; color: #fff;
      border-radius: 6px; font: 600 12px -apple-system, sans-serif;
    }
    .wo-primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* In-page queue panel */
    .wo-queue-panel {
      position: fixed; bottom: 110px; right: 16px;
      width: 380px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 160px);
      background: #fff; color: #111827; border: 1px solid #e5e7eb;
      border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,0.28);
      font: 13px -apple-system, sans-serif;
      pointer-events: auto; display: none;
      flex-direction: column; overflow: hidden;
    }
    .wo-queue-panel.open { display: flex; }
    .wo-qp-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid #e5e7eb;
    }
    .wo-qp-title { font: 600 13px -apple-system, sans-serif; flex: 1; }
    .wo-qp-status {
      font: 11px -apple-system, sans-serif; color: #6b7280;
      display: flex; align-items: center; gap: 4px;
    }
    .wo-qp-status::before {
      content: ''; width: 7px; height: 7px; border-radius: 50%;
      background: #d1d5db;
    }
    .wo-qp-status.connected::before { background: #16a34a; }
    .wo-qp-close {
      width: 22px; height: 22px; line-height: 18px; text-align: center;
      border: 0; background: transparent; color: #9ca3af;
      font: 18px sans-serif; cursor: pointer; padding: 0;
    }
    .wo-qp-list { flex: 1; overflow-y: auto; padding: 0; }
    .wo-qp-empty {
      padding: 28px 16px; text-align: center; color: #9ca3af; font-size: 12px;
    }
    .wo-qp-item {
      padding: 10px 12px; border-bottom: 1px solid #f3f4f6;
    }
    .wo-qp-item.editing { background: #f9fafb; }
    .wo-qp-item .els {
      font: 11px ui-monospace, monospace; color: #374151; margin-bottom: 4px;
    }
    .wo-qp-item .comment { font-size: 12px; color: #111827; white-space: pre-wrap; }
    .wo-qp-item .row-actions { margin-top: 6px; display: flex; gap: 10px; }
    .wo-qp-item .row-actions button {
      font: 11px sans-serif; background: none; border: 0;
      cursor: pointer; padding: 0;
    }
    .wo-qp-item .edit { color: #2563eb; }
    .wo-qp-item .remove { color: #dc2626; }
    .wo-qp-item textarea {
      width: 100%; min-height: 60px; margin-top: 6px;
      border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px;
      font: 12px -apple-system, sans-serif; resize: vertical; outline: none;
    }
    .wo-qp-item textarea:focus {
      border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15);
    }
    .wo-qp-item .edit-actions {
      margin-top: 8px; display: flex; gap: 6px; justify-content: flex-end;
    }
    .wo-qp-item .edit-actions button {
      font: 600 11px sans-serif; padding: 4px 10px;
      border-radius: 4px; cursor: pointer;
    }
    .wo-qp-item .save { background: #111827; color: #fff; border: 0; }
    .wo-qp-item .cancel { background: #fff; color: #6b7280; border: 1px solid #d1d5db; }
    .wo-qp-chip {
      display: inline-flex; align-items: center; gap: 3px; margin-right: 6px;
      margin-bottom: 3px;
    }
    .wo-qp-chip .badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 14px; height: 14px; padding: 0 3px;
      background: #2563eb; color: #fff; border-radius: 999px;
      font: 600 9px sans-serif;
    }
    .wo-qp-chip code { font-size: 10px; }
    .wo-qp-chip .x {
      width: 14px; height: 14px; line-height: 12px; text-align: center;
      border: 0; background: #e5e7eb; color: #6b7280;
      border-radius: 999px; cursor: pointer; padding: 0;
      font: 600 11px sans-serif;
    }
    .wo-qp-chip .x:hover { background: #fecaca; color: #b91c1c; }
    .wo-qp-actions {
      padding: 10px 12px; display: flex; gap: 6px;
      border-top: 1px solid #e5e7eb; background: #f9fafb;
    }
    .wo-qp-actions button {
      flex: 1; padding: 7px; border-radius: 6px;
      font: 600 12px -apple-system, sans-serif;
      cursor: pointer; border: 0;
    }
    .wo-qp-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
    .wo-qp-actions .clear-btn {
      flex: 0 0 60px; background: #fff; color: #6b7280;
      border: 1px solid #d1d5db;
    }
    .wo-qp-actions .copy-btn { background: #111827; color: #fff; }
    .wo-qp-actions .send-btn { background: #16a34a; color: #fff; }

    /* Help button + panel */
    .wo-help-btn {
      width: 28px; height: 28px; padding: 0;
      border-radius: 50%;
      background: #f3f4f6; color: #374151;
      border: 1px solid #d1d5db;
      font: 700 13px -apple-system, sans-serif;
      pointer-events: auto; cursor: pointer;
    }
    .wo-help-btn:hover { background: #e5e7eb; }
    .wo-help-panel {
      position: fixed; bottom: 110px; right: 16px;
      width: 380px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 160px);
      background: #fff; color: #111827; border: 1px solid #e5e7eb;
      border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,0.28);
      font: 13px -apple-system, sans-serif;
      pointer-events: auto; display: none;
      flex-direction: column; overflow: hidden;
    }
    .wo-help-panel.open { display: flex; }
    .wo-help-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid #e5e7eb;
    }
    .wo-help-header span { font: 600 13px -apple-system, sans-serif; flex: 1; }
    .wo-help-close {
      width: 22px; height: 22px; line-height: 18px; text-align: center;
      border: 0; background: transparent; color: #9ca3af;
      font: 18px sans-serif; cursor: pointer; padding: 0;
    }
    .wo-help-body {
      flex: 1; overflow-y: auto; padding: 8px 14px 14px;
    }
    .wo-help-body section { padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .wo-help-body section:last-child { border-bottom: 0; }
    .wo-help-body h4 {
      font: 600 12px -apple-system, sans-serif; color: #111827;
      margin: 0 0 4px 0;
    }
    .wo-help-body ul {
      margin: 0; padding-left: 16px;
      font: 12px -apple-system, sans-serif; color: #374151;
      line-height: 1.5;
    }
    .wo-help-body li { margin-bottom: 2px; }
    .wo-help-body kbd {
      display: inline-block; padding: 0 5px;
      background: #f3f4f6; border: 1px solid #d1d5db;
      border-radius: 3px; font: 600 11px ui-monospace, monospace;
      color: #111827;
    }
  `;
  shadow.appendChild(style);

  // ── State ───────────────────────────────────────────────
  let pickMode = false;
  let buffer: BufferSlot[] = [];
  let composeCommentDraft = '';
  let composeOpen = false;
  let queueCount = 0;
  let altHeld = false;
  let paused = false; // user-toggled passthrough; survives Alt key state

  // In-page queue panel (opened by clicking the floating "Queue · N" pill).
  // Mirrors the toolbar popup's edit/remove/copy/send so users can manage
  // the queue without leaving the page.
  let queuePanelOpen = false;
  let queueItems: QueueItem[] = [];
  let queueOrigin: string | undefined;
  let sidecarStatus: SidecarStatus = 'disconnected';
  let sidecarOrigins: string[] = [];
  let panelEditingIndex: number | null = null;
  let panelEditDraft: QueueItem | null = null;

  // ── Cross-page draft persistence ────────────────────────
  // Compose buffer + comment survive navigation within the same origin so a
  // user can pick on /login, navigate to /dashboard, pick more, then submit.
  const DRAFT_KEY = `wo:draft:${location.origin}`;

  interface PersistedDraft {
    elements: PickedElement[];
    comment: string;
  }

  let saveDraftQueued = false;
  function saveDraft() {
    if (saveDraftQueued) return;
    saveDraftQueued = true;
    queueMicrotask(async () => {
      saveDraftQueued = false;
      const payload: PersistedDraft = {
        elements: buffer.map((s) => ({ ...s.picked })),
        comment: composeCommentDraft,
      };
      if (payload.elements.length === 0 && !payload.comment) {
        await chrome.storage.local.remove(DRAFT_KEY).catch(() => {});
      } else {
        await chrome.storage.local.set({ [DRAFT_KEY]: payload }).catch(() => {});
      }
    });
  }

  async function clearDraft() {
    await chrome.storage.local.remove(DRAFT_KEY).catch(() => {});
  }

  async function loadDraft(): Promise<PersistedDraft | null> {
    const data = await chrome.storage.local.get(DRAFT_KEY).catch(() => ({} as any));
    return (data[DRAFT_KEY] as PersistedDraft) ?? null;
  }

  // ── DOM elements ────────────────────────────────────────
  const highlight = document.createElement('div');
  highlight.className = 'wo-highlight';
  shadow.appendChild(highlight);

  // Controls cluster lives bottom-right. Pause sits ABOVE the row of small
  // buttons (help/queue/pill) on its own line, big and amber, so it's the
  // first thing users see when they need to navigate without losing picks.
  const controls = document.createElement('div');
  controls.style.cssText =
    'position:fixed;bottom:16px;right:16px;display:flex;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none;';
  shadow.appendChild(controls);

  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'wo-btn wo-pause-btn';
  pauseBtn.style.cssText =
    'padding:12px 22px;border-radius:999px;background:#fbbf24;color:#111827;border:0;font:700 14px -apple-system,sans-serif;box-shadow:0 10px 28px rgba(251,191,36,0.45);pointer-events:auto;display:none;cursor:pointer;letter-spacing:0.2px;';
  controls.appendChild(pauseBtn);

  const controlsRow = document.createElement('div');
  controlsRow.style.cssText = 'display:flex;gap:6px;align-items:center;pointer-events:auto;';
  controls.appendChild(controlsRow);

  const helpBtn = document.createElement('button');
  helpBtn.className = 'wo-btn wo-help-btn';
  helpBtn.textContent = '?';
  helpBtn.title = 'Shortcuts and how it works';
  controlsRow.appendChild(helpBtn);

  const queueBtn = document.createElement('button');
  queueBtn.className = 'wo-btn wo-queue-btn';
  controlsRow.appendChild(queueBtn);

  const pill = document.createElement('button');
  pill.className = 'wo-btn wo-pill';
  controlsRow.appendChild(pill);

  const commentBtn = document.createElement('button');
  commentBtn.className = 'wo-btn wo-comment-btn';
  shadow.appendChild(commentBtn);

  const popover = document.createElement('div');
  popover.className = 'wo-popover';
  shadow.appendChild(popover);

  const queuePanel = document.createElement('div');
  queuePanel.className = 'wo-queue-panel';
  shadow.appendChild(queuePanel);

  const helpPanel = document.createElement('div');
  helpPanel.className = 'wo-help-panel';
  shadow.appendChild(helpPanel);

  // ── Helpers ─────────────────────────────────────────────
  const isOurs = (el: EventTarget | null): boolean => {
    if (!el || !(el instanceof Node)) return false;
    return host.contains(el) || el === host;
  };

  function makePickedElement(el: Element, index: number): PickedElement {
    const src = resolveSource(el);
    const text = (el.textContent ?? '').trim();
    return {
      selector: buildSelector(el),
      tagName: el.tagName.toLowerCase(),
      text: text.slice(0, 160),
      classes: (typeof el.className === 'string' ? el.className : '').trim(),
      attributes: captureAttributes(el),
      pageUrl: location.href,
      pageRoute: location.pathname,
      label: circleNumber(index),
      sourceFile: src?.file,
      sourceLine: src?.line,
      sourceColumn: src?.column,
    };
  }

  function createBadge(label: string, el: Element): HTMLDivElement {
    const b = document.createElement('div');
    b.className = 'wo-badge';
    b.textContent = label;
    const r = el.getBoundingClientRect();
    b.style.left = r.left + 'px';
    b.style.top = r.top + 'px';
    return b;
  }

  function addBufferSlot(picked: PickedElement, el: Element | null) {
    let badge: HTMLDivElement | null = null;
    if (el) {
      badge = createBadge(picked.label, el);
      shadow.appendChild(badge);
    }
    buffer.push({ picked, el, badge });
    saveDraft();
  }

  function relabelBuffer() {
    buffer.forEach((slot, i) => {
      slot.picked.label = circleNumber(i);
      if (slot.badge) slot.badge.textContent = slot.picked.label;
    });
    saveDraft();
  }

  function clearBuffer() {
    for (const slot of buffer) {
      if (slot.badge?.parentNode) slot.badge.parentNode.removeChild(slot.badge);
    }
    buffer = [];
    composeCommentDraft = '';
    clearDraft();
  }

  function refreshBadges() {
    for (const slot of buffer) {
      if (slot.el && slot.badge) {
        const r = slot.el.getBoundingClientRect();
        slot.badge.style.left = r.left + 'px';
        slot.badge.style.top = r.top + 'px';
      }
    }
  }

  function updateCommentBtn() {
    if (buffer.length > 0 && !composeOpen) {
      const anchored = buffer.filter((s) => s.el !== null).length;
      const label = pickMode
        ? `💬 Comment (${buffer.length}) — Enter`
        : anchored < buffer.length
          ? `💬 Resume draft (${buffer.length})`
          : `💬 Comment (${buffer.length})`;
      commentBtn.textContent = label;
      commentBtn.style.display = 'block';
    } else {
      commentBtn.style.display = 'none';
    }
  }

  function renderPill() {
    if (pickMode) {
      const passing = paused || altHeld;
      pill.textContent = passing
        ? '⏸ Paused — clicks pass through'
        : buffer.length > 0
          ? `● Picking · ${buffer.length}`
          : '● Picking — ESC to exit';
      pill.classList.add('picking');
      pauseBtn.style.display = 'inline-block';
      pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    } else {
      pill.textContent = '🎯 Pick';
      pill.classList.remove('picking');
      pauseBtn.style.display = 'none';
    }
    if (queueCount > 0) {
      queueBtn.style.display = 'inline-block';
      queueBtn.textContent = `Queue · ${queueCount}`;
    } else {
      queueBtn.style.display = 'none';
    }
  }

  function enterPick() {
    pickMode = true;
    document.documentElement.style.cursor = 'crosshair';
    renderPill();
    updateCommentBtn();
  }

  function exitPick() {
    pickMode = false;
    paused = false;
    document.documentElement.style.cursor = '';
    highlight.style.display = 'none';
    restoreHostParent();
    renderPill();
    updateCommentBtn();
  }

  // ── Compose popover ─────────────────────────────────────
  function openComposePopover() {
    composeOpen = true;
    popover.style.display = 'block';
    updateCommentBtn();

    const rows = buffer
      .map((slot, i) => {
        const p = slot.picked;
        const rel = p.sourceFile ? shortPath(p.sourceFile) : '';
        const loc = rel ? `${escapeHtml(rel)}:${p.sourceLine ?? '?'}` : escapeHtml(p.selector);
        const textPart = p.text
          ? ` · "${escapeHtml(p.text.slice(0, 40))}${p.text.length > 40 ? '…' : ''}"`
          : '';
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #f3f4f6">
            <div style="flex:0 0 auto;min-width:22px;height:22px;padding:0 6px;background:#2563eb;color:#fff;border-radius:999px;display:flex;align-items:center;justify-content:center;font:600 12px sans-serif">${escapeHtml(p.label)}</div>
            <div style="flex:1;min-width:0">
              <div style="font:600 11px ui-monospace,monospace;color:#374151;word-break:break-all">${loc}</div>
              <div style="font:11px ui-monospace,monospace;color:#6b7280">&lt;${escapeHtml(p.tagName)}&gt;${textPart}</div>
            </div>
            <button data-rmref="${i}" class="wo-btn" title="Remove" style="flex:0 0 24px;width:24px;height:24px;border:0;background:none;color:#9ca3af;cursor:pointer;font:16px sans-serif;padding:0">×</button>
          </div>`;
      })
      .join('');

    const emptyState = `<div style="padding:14px;color:#9ca3af;font-size:12px;text-align:center">No elements selected. Click <b>+ Add element</b> to pick.</div>`;

    popover.innerHTML = `
      <div style="font:600 12px -apple-system,sans-serif;color:#6b7280;margin-bottom:6px">
        Compose comment
      </div>
      <div style="max-height:180px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:10px">${rows || emptyState}</div>
      <textarea id="__wo-comment" placeholder="What should change? Reference elements by badge, e.g. 'move ① above ②'"></textarea>
      <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
        <button id="__wo-addmore" class="wo-btn wo-small-btn">+ Add element</button>
        <span style="font:11px sans-serif;color:#9ca3af;flex:1;text-align:right;min-width:0">⌘↵ queue · ESC cancel</span>
        <button id="__wo-cancel" class="wo-btn wo-small-btn">Cancel</button>
        <button id="__wo-submit" class="wo-btn wo-primary-btn">Queue</button>
      </div>`;

    const textarea = popover.querySelector<HTMLTextAreaElement>('#__wo-comment')!;
    textarea.value = composeCommentDraft;
    const submitBtn = popover.querySelector<HTMLButtonElement>('#__wo-submit')!;
    const syncDisabled = () => {
      submitBtn.disabled = buffer.length === 0;
    };
    syncDisabled();
    setTimeout(() => textarea.focus(), 0);

    textarea.addEventListener('input', () => {
      composeCommentDraft = textarea.value;
      saveDraft();
    });

    popover.querySelectorAll<HTMLButtonElement>('[data-rmref]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.rmref ?? '-1', 10);
        if (i < 0 || i >= buffer.length) return;
        const slot = buffer[i];
        if (slot.badge?.parentNode) slot.badge.parentNode.removeChild(slot.badge);
        buffer.splice(i, 1);
        relabelBuffer();
        composeCommentDraft = textarea.value;
        saveDraft();
        openComposePopover();
      });
    });

    popover.querySelector<HTMLButtonElement>('#__wo-addmore')?.addEventListener('click', () => {
      composeCommentDraft = textarea.value;
      composeOpen = false;
      popover.style.display = 'none';
      if (!pickMode) enterPick();
      updateCommentBtn();
    });

    popover.querySelector<HTMLButtonElement>('#__wo-cancel')?.addEventListener('click', cancelCompose);
    popover.querySelector<HTMLButtonElement>('#__wo-submit')?.addEventListener('click', submitCompose);

    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitCompose(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelCompose(); }
    });
  }

  function cancelCompose() {
    composeOpen = false;
    popover.style.display = 'none';
    clearBuffer();
    exitPick();
    restoreHostParent();
  }

  async function submitCompose() {
    if (buffer.length === 0) return;
    const textarea = popover.querySelector<HTMLTextAreaElement>('#__wo-comment');
    const comment = (textarea?.value ?? composeCommentDraft).trim();
    if (!comment) { textarea?.focus(); return; }

    const item: QueueItem = {
      elements: buffer.map((s) => ({ ...s.picked })),
      comment,
    };
    await sendMsg({ type: 'addToQueue', item });
    queueCount++;

    composeOpen = false;
    popover.style.display = 'none';
    clearBuffer();
    renderPill();
    exitPick();
    restoreHostParent();
  }

  // ── In-page queue panel ─────────────────────────────────
  function sidecarAcceptsCurrent(): boolean {
    if (!queueOrigin || sidecarOrigins.length === 0) return false;
    for (const adv of sidecarOrigins) {
      if (adv === queueOrigin) return true;
      if (adv.endsWith(':*')) {
        const host = adv.slice(0, -2);
        if (queueOrigin.startsWith(host + ':') || queueOrigin === host) return true;
      }
    }
    return false;
  }

  async function loadQueueState() {
    const resp = await sendMsg({ type: 'getQueue' });
    queueItems = (resp?.queue ?? []) as QueueItem[];
    queueOrigin = resp?.origin;
    sidecarStatus = (resp?.sidecarStatus ?? 'disconnected') as SidecarStatus;
    sidecarOrigins = resp?.sidecarOrigins ?? [];
    queueCount = queueItems.length;
  }

  async function openQueuePanel() {
    queuePanelOpen = true;
    panelEditingIndex = null;
    panelEditDraft = null;
    queuePanel.classList.add('open');
    await loadQueueState();
    renderQueuePanel();
  }

  function closeQueuePanel() {
    queuePanelOpen = false;
    panelEditingIndex = null;
    panelEditDraft = null;
    queuePanel.classList.remove('open');
    queuePanel.innerHTML = '';
  }

  function renderChip(el: PickedElement, idx: number, editing: boolean): string {
    const loc = el.sourceFile
      ? `${escapeHtml(shortPath(el.sourceFile))}:${el.sourceLine ?? '?'}`
      : escapeHtml(el.selector.slice(0, 50));
    const x = editing
      ? `<button class="x" data-el="${idx}" title="Remove element">×</button>`
      : '';
    return `<span class="wo-qp-chip">
      <span class="badge">${escapeHtml(el.label)}</span>
      <code>${loc}</code>
      ${x}
    </span>`;
  }

  function renderQueuePanel() {
    const accepted = sidecarAcceptsCurrent();
    const canSend = sidecarStatus === 'connected' && accepted && queueItems.length > 0;
    const canCopy = queueItems.length > 0;
    const statusText =
      sidecarStatus !== 'connected'
        ? 'Sidecar off'
        : accepted
          ? 'Sidecar ✓'
          : 'Sidecar (other site)';

    const itemsHtml = queueItems.length === 0
      ? `<div class="wo-qp-empty">No picks queued for this site yet.</div>`
      : queueItems
          .map((item, i) => {
            const isEditing = panelEditingIndex === i && panelEditDraft !== null;
            const display = isEditing ? panelEditDraft! : item;
            const chips = display.elements
              .map((el, ei) => renderChip(el, ei, isEditing))
              .join('');
            if (isEditing) {
              return `
                <div class="wo-qp-item editing">
                  <div class="els">${chips || '<span style="color:#9ca3af;font-size:11px">No elements — saving will remove this item.</span>'}</div>
                  <textarea data-comment="${i}">${escapeHtml(display.comment)}</textarea>
                  <div class="edit-actions">
                    <button class="cancel" data-cancel="${i}">Cancel</button>
                    <button class="save" data-save="${i}">Save</button>
                  </div>
                </div>`;
            }
            return `
              <div class="wo-qp-item">
                <div class="els">${chips}</div>
                <div class="comment">${escapeHtml(item.comment)}</div>
                <div class="row-actions">
                  <button class="edit" data-edit="${i}">Edit</button>
                  <button class="remove" data-remove="${i}">Remove</button>
                </div>
              </div>`;
          })
          .join('');

    queuePanel.innerHTML = `
      <div class="wo-qp-header">
        <span class="wo-qp-title">Queue · ${queueItems.length}</span>
        <span class="wo-qp-status ${sidecarStatus}">${statusText}</span>
        <button class="wo-qp-close" title="Close">×</button>
      </div>
      <div class="wo-qp-list">${itemsHtml}</div>
      <div class="wo-qp-actions">
        <button class="clear-btn" ${canCopy ? '' : 'disabled'}>Clear</button>
        <button class="copy-btn" ${canCopy ? '' : 'disabled'}>📋 Copy</button>
        <button class="send-btn" ${canSend ? '' : 'disabled'}>📡 Send</button>
      </div>`;

    queuePanel.querySelector<HTMLButtonElement>('.wo-qp-close')?.addEventListener('click', closeQueuePanel);

    // Edit / Remove / Save / Cancel / element-X / Copy / Send / Clear
    queuePanel.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.edit ?? '-1', 10);
        if (i < 0 || i >= queueItems.length) return;
        panelEditingIndex = i;
        panelEditDraft = {
          comment: queueItems[i].comment,
          elements: queueItems[i].elements.map((e) => ({ ...e })),
        };
        renderQueuePanel();
      });
    });

    queuePanel.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => {
      b.addEventListener('click', async () => {
        const i = parseInt(b.dataset.remove ?? '-1', 10);
        if (i < 0 || !queueOrigin) return;
        const next = [...queueItems];
        next.splice(i, 1);
        await sendMsg({ type: 'updateQueue', origin: queueOrigin, queue: next });
        await loadQueueState();
        renderQueuePanel();
      });
    });

    queuePanel.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) => {
      b.addEventListener('click', () => {
        panelEditingIndex = null;
        panelEditDraft = null;
        renderQueuePanel();
      });
    });

    queuePanel.querySelectorAll<HTMLTextAreaElement>('[data-comment]').forEach((ta) => {
      ta.addEventListener('input', () => {
        if (panelEditDraft) panelEditDraft.comment = ta.value;
      });
      ta.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          (queuePanel.querySelector<HTMLButtonElement>('[data-save]'))?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          panelEditingIndex = null;
          panelEditDraft = null;
          renderQueuePanel();
        }
      });
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }, 0);
    });

    queuePanel.querySelectorAll<HTMLButtonElement>('.wo-qp-chip .x').forEach((b) => {
      b.addEventListener('click', () => {
        if (!panelEditDraft) return;
        const ei = parseInt(b.dataset.el ?? '-1', 10);
        if (ei < 0 || ei >= panelEditDraft.elements.length) return;
        panelEditDraft.elements.splice(ei, 1);
        renderQueuePanel();
      });
    });

    queuePanel.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((b) => {
      b.addEventListener('click', async () => {
        const i = parseInt(b.dataset.save ?? '-1', 10);
        if (i < 0 || !queueOrigin || !panelEditDraft) return;
        const comment = panelEditDraft.comment.trim();
        const next = [...queueItems];
        if (panelEditDraft.elements.length === 0) {
          next.splice(i, 1);
        } else if (!comment) {
          queuePanel.querySelector<HTMLTextAreaElement>('[data-comment]')?.focus();
          return;
        } else {
          next[i] = { comment, elements: panelEditDraft.elements };
        }
        panelEditingIndex = null;
        panelEditDraft = null;
        await sendMsg({ type: 'updateQueue', origin: queueOrigin, queue: next });
        await loadQueueState();
        renderQueuePanel();
      });
    });

    // Copy: format synchronously inside the click handler so we keep the
    // user gesture context for navigator.clipboard.writeText. The flush
    // message also runs in the background to keep popup queue state in sync.
    queuePanel.querySelector<HTMLButtonElement>('.copy-btn')?.addEventListener('click', async () => {
      if (queueItems.length === 0) return;
      const text = formatQueueForClipboard(queueItems);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API can fail on insecure contexts — surface gracefully.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        host.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const btn = queuePanel.querySelector<HTMLButtonElement>('.copy-btn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied ✓';
        setTimeout(() => { if (btn) btn.textContent = orig ?? '📋 Copy'; }, 1200);
      }
    });

    queuePanel.querySelector<HTMLButtonElement>('.send-btn')?.addEventListener('click', async () => {
      if (!canSend) return;
      const result = await sendMsg({ type: 'flushToSidecar' });
      if (result?.ok) {
        await loadQueueState();
        renderQueuePanel();
      }
    });

    queuePanel.querySelector<HTMLButtonElement>('.clear-btn')?.addEventListener('click', async () => {
      if (!queueOrigin || queueItems.length === 0) return;
      await sendMsg({ type: 'clearQueue', origin: queueOrigin });
      await loadQueueState();
      renderQueuePanel();
    });
  }

  // ── Help panel ──────────────────────────────────────────
  // Always-available reference for users. Spelled out plainly because not
  // everyone using the extension will have read the README; the floating
  // pill alone can't fit every shortcut.
  let helpOpen = false;

  function openHelpPanel() {
    helpOpen = true;
    helpPanel.innerHTML = `
      <div class="wo-help-header">
        <span>Website Overlay — how to use</span>
        <button class="wo-help-close" title="Close">×</button>
      </div>
      <div class="wo-help-body">
        <section>
          <h4>Activate / deactivate</h4>
          <ul>
            <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> — toggle pick mode on this tab</li>
            <li>Or open the extension popup and click <b>🎯 Start picking</b></li>
            <li>To stop on this site permanently: extension popup → <b>Disable here</b></li>
          </ul>
        </section>
        <section>
          <h4>While picking</h4>
          <ul>
            <li>Click any element to add it. It gets a numbered badge ①, ②, ③.</li>
            <li><kbd>Enter</kbd> — open the comment box</li>
            <li><kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> — submit the comment to the queue</li>
          </ul>
        </section>
        <section>
          <h4>Navigating without losing your picks</h4>
          <ul>
            <li><b>⏸ Pause</b> (button next to the Pick pill) — clicks pass through to the page so you can navigate, fill forms, scroll. Click <b>▶ Resume</b> to keep picking. <i>This is the right tool for clicking links.</i></li>
            <li><kbd>Esc</kbd> — exits pick mode but keeps your queue and any unfinished draft. Press <kbd>Alt+Shift+C</kbd> on the new page to keep going.</li>
            <li><kbd>Alt</kbd> held + click — momentary passthrough for opening a drawer or menu. <i>On Mac, browsers download links for Alt+click — use Pause for navigating links instead.</i></li>
          </ul>
        </section>
        <section>
          <h4>Multi-page flows</h4>
          <ul>
            <li>Picks travel across pages on the <b>same site</b>. Pick on /login → navigate → pick on /dashboard → same queue.</li>
            <li>Different sites get their own queue. Picks on app.com and picks on example.com never mix.</li>
            <li>Cross-site navigation deactivates us on the new site for privacy. Press <kbd>Alt+Shift+C</kbd> there to start picking.</li>
            <li>If you abandon a comment mid-typing and navigate, a <b>💬 Resume draft (N)</b> button appears on the new page so you can pick up where you left off.</li>
          </ul>
        </section>
        <section>
          <h4>Managing the queue</h4>
          <ul>
            <li>Click <b>Queue · N</b> next to the Pick pill — opens an in-page panel with edit, remove, copy, send.</li>
            <li>Or open the extension popup for the same actions.</li>
            <li><b>Copy for AI</b> keeps the queue around so you can revise and re-copy. <b>Send to project</b> (sidecar) ships items to a file in your repo.</li>
          </ul>
        </section>
      </div>
    `;
    helpPanel.classList.add('open');
    helpPanel.querySelector<HTMLButtonElement>('.wo-help-close')?.addEventListener('click', closeHelpPanel);
  }

  function closeHelpPanel() {
    helpOpen = false;
    helpPanel.classList.remove('open');
    helpPanel.innerHTML = '';
  }

  // ── Event wiring ────────────────────────────────────────
  // When Alt is held in pick mode, picks pass through to the page so the user
  // can open drawers/menus/dropdowns before picking elements inside them.
  const isPassthrough = (e: MouseEvent | KeyboardEvent) => e.altKey && !e.shiftKey;

  window.addEventListener(
    'mousemove',
    (e) => {
      if (!pickMode || composeOpen) { highlight.style.display = 'none'; return; }
      if (paused || isPassthrough(e)) { highlight.style.display = 'none'; return; }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isOurs(el)) { highlight.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = r.left + 'px';
      highlight.style.top = r.top + 'px';
      highlight.style.width = r.width + 'px';
      highlight.style.height = r.height + 'px';
    },
    { capture: true, signal: ac.signal },
  );

  window.addEventListener(
    'click',
    (e) => {
      if (!pickMode || composeOpen) return;
      const el = e.target as Element | null;
      if (!el || isOurs(el)) return;
      // Pause toggled OR Alt held → let the page handle the click normally.
      // (Pause is the recommended path; Alt is kept for muscle memory but has
      // browser-native side effects like downloading <a href> targets.)
      if (paused || isPassthrough(e)) return;
      e.preventDefault();
      e.stopPropagation();

      const picked = makePickedElement(el, buffer.length);
      addBufferSlot(picked, el);
      // If this pick is inside a drawer/modal, move our host into that drawer
      // so subsequent clicks on our UI (Comment button, popover, textarea)
      // don't count as "outside" and close the drawer.
      const drawer = findDrawerAncestor(el);
      if (drawer) anchorHostTo(drawer);
      renderPill();
      updateCommentBtn();
    },
    { capture: true, signal: ac.signal },
  );

  // Keep the pill hint in sync with Alt being held (visual affordance).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !altHeld) { altHeld = true; if (pickMode) renderPill(); }
  }, { signal: ac.signal });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && altHeld) { altHeld = false; if (pickMode) renderPill(); }
  }, { signal: ac.signal });
  window.addEventListener('blur', () => { if (altHeld) { altHeld = false; renderPill(); } }, { signal: ac.signal });

  window.addEventListener('keydown', (e) => {
    if (composeOpen) return;
    if (helpOpen && e.key === 'Escape') {
      e.preventDefault();
      closeHelpPanel();
      return;
    }
    if (queuePanelOpen && e.key === 'Escape') {
      // Don't close while editing inside the panel — the textarea handler
      // owns that Esc and just cancels the edit.
      if (panelEditingIndex !== null) return;
      e.preventDefault();
      closeQueuePanel();
      return;
    }
    if (pickMode && e.key === 'Escape') {
      // Only exit pick mode; keep the buffer intact so prior picks (including
      // cross-page drafts) are preserved. Use the Cancel button in the
      // compose popover to explicitly discard the draft.
      e.preventDefault();
      exitPick();
      return;
    }
    if (pickMode && e.key === 'Enter') {
      const tgt = e.target as Element | null;
      if (tgt?.tagName === 'INPUT' || tgt?.tagName === 'TEXTAREA') return;
      if (buffer.length > 0) { e.preventDefault(); openComposePopover(); }
      return;
    }
    // Alt+Shift+C is owned by chrome.commands (manifest.json) and handled by
    // the background service worker, which sends us a 'togglePickMode' message.
    // The browser consumes the keystroke before it reaches the page, so no
    // window-level fallback is needed here.
  }, { signal: ac.signal });

  window.addEventListener('scroll', refreshBadges, { capture: true, signal: ac.signal });
  window.addEventListener('resize', refreshBadges, { signal: ac.signal });

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pickMode) exitPick(); else enterPick();
  });

  helpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpOpen) closeHelpPanel(); else openHelpPanel();
  });

  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!pickMode) return;
    paused = !paused;
    highlight.style.display = 'none';
    renderPill();
  });

  queueBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (queuePanelOpen) closeQueuePanel(); else openQueuePanel();
  });

  commentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (buffer.length > 0) openComposePopover();
  });

  // Tear ourselves down completely. Called when the user toggles "Disable
  // here" in the popup. Removes the host (so the pill, panel, badges all
  // vanish) and aborts every window/document listener via ac. The
  // __websiteOverlayMounted guard is cleared so a future re-injection
  // (after the user re-enables) starts from a clean slate.
  function deactivate() {
    try { exitPick(); } catch {}
    try { closeQueuePanel(); } catch {}
    ac.abort();
    chrome.runtime.onMessage.removeListener(messageListener);
    hostWatcher.disconnect();
    if (host.parentNode) host.parentNode.removeChild(host);
    document.documentElement.style.cursor = '';
    (window as any).__websiteOverlayMounted = false;
  }

  // Listen for queue count updates and external activation commands.
  const messageListener = (msg: any, _sender: any, sendResponse?: (r: any) => void) => {
    if (msg.type === 'queueUpdated') {
      queueCount = msg.count;
      renderPill();
      // Keep the in-page panel in sync if it's open (e.g., when the popup
      // edits the queue while the panel is showing).
      if (queuePanelOpen) {
        loadQueueState().then(renderQueuePanel);
      }
    }
    if (msg.type === 'enterPickMode') {
      if (!pickMode) enterPick();
      sendResponse?.({ ok: true });
    }
    if (msg.type === 'togglePickMode') {
      if (pickMode) exitPick(); else enterPick();
      sendResponse?.({ ok: true });
    }
    if (msg.type === 'deactivate') {
      sendResponse?.({ ok: true });
      // Defer one tick so the response actually flushes before we tear down.
      setTimeout(deactivate, 0);
    }
  };
  chrome.runtime.onMessage.addListener(messageListener);

  // Initialize queue count
  sendMsg({ type: 'getQueue' }).then((response) => {
    if (response?.queue) {
      queueCount = response.queue.length;
      renderPill();
    }
  });

  // Hydrate any compose draft left behind when navigating within this origin.
  loadDraft().then((draft) => {
    if (!draft) return;
    if (draft.elements.length === 0 && !draft.comment) return;
    for (let i = 0; i < draft.elements.length; i++) {
      const picked: PickedElement = { ...draft.elements[i], label: circleNumber(i) };
      let el: Element | null = null;
      try {
        el = document.querySelector(picked.selector);
      } catch {
        el = null;
      }
      addBufferSlot(picked, el);
    }
    composeCommentDraft = draft.comment;
    renderPill();
    updateCommentBtn();
  });

  renderPill();
  updateCommentBtn();
  console.info('[website-overlay] ready — click 🎯 Pick (or Alt+Shift+C) to start.');
}

mount();
