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
  }

  function relabelBuffer() {
    buffer.forEach((slot, i) => {
      slot.picked.label = circleNumber(i);
      if (slot.badge) slot.badge.textContent = slot.picked.label;
    });
  }

  function clearBuffer() {
    for (const slot of buffer) {
      if (slot.badge?.parentNode) slot.badge.parentNode.removeChild(slot.badge);
    }
    buffer = [];
    composeCommentDraft = '';
    editingIndex = null;
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
    if (pickMode && buffer.length > 0 && !composeOpen) {
      commentBtn.textContent = `💬 Comment (${buffer.length}) — Enter`;
      commentBtn.style.display = 'block';
    } else {
      commentBtn.style.display = 'none';
    }
  }

  function renderPill() {
    if (pickMode) {
      pill.textContent = buffer.length > 0
        ? `● Picking · ${buffer.length} selected`
        : '● Picking — ESC to cancel';
      pill.classList.add('picking');
    } else {
      pill.textContent = '🎯 Pick';
      pill.classList.remove('picking');
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
    document.documentElement.style.cursor = '';
    highlight.style.display = 'none';
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
  }

  // ── Event wiring ────────────────────────────────────────
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!pickMode || composeOpen) { highlight.style.display = 'none'; return; }
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
      e.preventDefault();
      e.stopPropagation();

      const picked = makePickedElement(el, buffer.length);
      addBufferSlot(picked, el);
      renderPill();
      updateCommentBtn();
    },
    true,
  );

  window.addEventListener('keydown', (e) => {
    if (composeOpen) return;
    if (pickMode && e.key === 'Escape') {
      e.preventDefault();
      clearBuffer();
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
      if (pickMode) { clearBuffer(); exitPick(); } else enterPick();
    }
  });

  window.addEventListener('scroll', refreshBadges, true);
  window.addEventListener('resize', refreshBadges);

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pickMode) { clearBuffer(); exitPick(); } else enterPick();
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

  renderPill();
  updateCommentBtn();
  console.info('[website-overlay] ready — click 🎯 Pick (or Alt+Shift+C) to start.');
}

mount();
