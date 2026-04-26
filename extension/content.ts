/**
 * Content script: injected into every page. Creates the pick overlay inside
 * a Shadow DOM so styles are fully isolated from the host page.
 */

import type { PickedElement, QueueItem } from '../shared/types';
import { resolveSource, buildSelector, captureAttributes } from '../shared/resolve';

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
  `;
  shadow.appendChild(style);

  // ── State ───────────────────────────────────────────────
  let pickMode = false;
  let buffer: BufferSlot[] = [];
  let editingIndex: number | null = null;
  let composeCommentDraft = '';
  let composeOpen = false;
  let queueCount = 0;
  let altHeld = false;
  let paused = false; // user-toggled passthrough; survives Alt key state

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

  const controls = document.createElement('div');
  controls.style.cssText = 'position:fixed;bottom:16px;right:16px;display:flex;gap:6px;pointer-events:auto;';
  shadow.appendChild(controls);

  const queueBtn = document.createElement('button');
  queueBtn.className = 'wo-btn wo-queue-btn';
  controls.appendChild(queueBtn);

  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'wo-btn wo-pause-btn';
  pauseBtn.style.cssText =
    'padding:8px 12px;border-radius:999px;background:#fff;color:#111827;border:1px solid #d1d5db;font:500 12px -apple-system,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.12);pointer-events:auto;display:none;';
  controls.appendChild(pauseBtn);

  const pill = document.createElement('button');
  pill.className = 'wo-btn wo-pill';
  controls.appendChild(pill);

  const commentBtn = document.createElement('button');
  commentBtn.className = 'wo-btn wo-comment-btn';
  shadow.appendChild(commentBtn);

  const popover = document.createElement('div');
  popover.className = 'wo-popover';
  shadow.appendChild(popover);

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
    editingIndex = null;
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

    const isEdit = editingIndex !== null;
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
        ${isEdit ? 'Editing queued item' : 'Compose comment'}
      </div>
      <div style="max-height:180px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:10px">${rows || emptyState}</div>
      <textarea id="__wo-comment" placeholder="What should change? Reference elements by badge, e.g. 'move ① above ②'"></textarea>
      <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
        <button id="__wo-addmore" class="wo-btn wo-small-btn">+ Add element</button>
        <span style="font:11px sans-serif;color:#9ca3af;flex:1;text-align:right;min-width:0">⌘↵ ${isEdit ? 'save' : 'queue'} · ESC cancel</span>
        <button id="__wo-cancel" class="wo-btn wo-small-btn">Cancel</button>
        <button id="__wo-submit" class="wo-btn wo-primary-btn">${isEdit ? 'Save' : 'Queue'}</button>
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
    true,
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
    true,
  );

  // Keep the pill hint in sync with Alt being held (visual affordance).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !altHeld) { altHeld = true; if (pickMode) renderPill(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && altHeld) { altHeld = false; if (pickMode) renderPill(); }
  });
  window.addEventListener('blur', () => { if (altHeld) { altHeld = false; renderPill(); } });

  window.addEventListener('keydown', (e) => {
    if (composeOpen) return;
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
    if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.code === 'KeyC')) {
      e.preventDefault();
      if (pickMode) exitPick(); else enterPick();
    }
  });

  window.addEventListener('scroll', refreshBadges, true);
  window.addEventListener('resize', refreshBadges);

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pickMode) exitPick(); else enterPick();
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
    // Open popup to manage queue
    chrome.runtime.sendMessage({ type: 'openPopup' });
  });

  commentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (buffer.length > 0) openComposePopover();
  });

  // Listen for queue count updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'queueUpdated') {
      queueCount = msg.count;
      renderPill();
    }
  });

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
