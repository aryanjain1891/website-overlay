/**
 * Extension popup: shows the queue for the active tab's origin and handles
 * Copy for AI / Send to project. Scoped to the active origin so picks from
 * different sites never mix.
 */

import type { GetQueueResponse, QueueItem } from '../shared/types';

const queueList = document.getElementById('queue-list')!;
const countBadge = document.getElementById('count-badge')!;
const originLabel = document.getElementById('origin-label')!;
const otherOrigins = document.getElementById('other-origins')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
const btnSend = document.getElementById('btn-send') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnPick = document.getElementById('btn-pick') as HTMLButtonElement;
const toggleDisabled = document.getElementById('toggle-disabled') as HTMLInputElement;

let currentOrigin: string | undefined;
// Edit state. Tracks the queue index being edited and the working draft so
// the user can remove individual elements without committing until Save.
let editingIndex: number | null = null;
let editDraft: QueueItem | null = null;

function sendMsg(msg: any): Promise<any> {
  return chrome.runtime.sendMessage(msg);
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

function sidecarAccepts(origin: string | undefined, origins: string[]): boolean {
  if (!origin || origins.length === 0) return false;
  for (const adv of origins) {
    if (adv === origin) return true;
    if (adv.endsWith(':*')) {
      const host = adv.slice(0, -2);
      if (origin.startsWith(host + ':') || origin === host) return true;
    }
  }
  return false;
}

async function refresh() {
  const resp: GetQueueResponse = await sendMsg({ type: 'getQueue' });
  const { queue, origin, countsByOrigin, sidecarStatus, sidecarOrigins } = resp;
  currentOrigin = origin;

  // Per-site disable state
  const siteState = await sendMsg({ type: 'getSiteState' });
  toggleDisabled.checked = !!siteState?.disabled;
  toggleDisabled.disabled = !origin;
  btnPick.disabled = !origin || !!siteState?.disabled;
  btnPick.textContent = siteState?.disabled
    ? '⚠ Disabled on this site'
    : '🎯 Start picking';

  originLabel.textContent = origin ?? '(no page)';
  countBadge.textContent = String(queue.length);

  const accepted = sidecarAccepts(origin, sidecarOrigins);
  btnCopy.disabled = queue.length === 0;
  btnSend.disabled = queue.length === 0 || sidecarStatus !== 'connected' || !accepted;
  btnClear.disabled = queue.length === 0;

  statusDot.className = `status-dot ${sidecarStatus}`;
  if (sidecarStatus !== 'connected') {
    statusText.textContent = 'Sidecar: not detected — "Copy for AI" always works';
  } else if (!origin) {
    statusText.textContent = 'Sidecar: connected';
  } else if (accepted) {
    statusText.textContent = `Sidecar: claims this origin ✓`;
  } else {
    statusText.textContent = `Sidecar running, but does not claim ${origin}`;
  }

  // Other origins with pending items (informational, not flushable from here).
  const others = Object.entries(countsByOrigin).filter(([o]) => o !== origin);
  if (others.length === 0) {
    otherOrigins.innerHTML = '';
    otherOrigins.style.display = 'none';
  } else {
    otherOrigins.style.display = 'block';
    otherOrigins.innerHTML =
      `<div style="font:11px sans-serif;color:#6b7280;padding:6px 16px">Other origins with pending picks:</div>` +
      others
        .map(
          ([o, n]) =>
            `<div style="font:11px ui-monospace,monospace;color:#374151;padding:2px 16px 2px 28px">${escapeHtml(
              o,
            )} · ${n}</div>`,
        )
        .join('');
  }

  if (queue.length === 0) {
    queueList.innerHTML = `
      <div class="empty-state">
        No picks on this origin yet.<br>
        Press <b>Alt+Shift+C</b> to start picking.
      </div>`;
    return;
  }

  // Group queue items by page route (pathname) for multi-screen flows.
  // An item's route is taken from its first element — typical case since
  // elements in a single comment come from the same screen.
  const groups = new Map<string, { indexes: number[] }>();
  queue.forEach((item, i) => {
    const route = item.elements[0]?.pageRoute || '/';
    if (!groups.has(route)) groups.set(route, { indexes: [] });
    groups.get(route)!.indexes.push(i);
  });

  const renderElementChips = (item: QueueItem, editing: boolean): string =>
    item.elements
      .map((el, ei) => {
        const loc = el.sourceFile
          ? `${escapeHtml(shortPath(el.sourceFile))}:${el.sourceLine ?? '?'}`
          : escapeHtml(el.selector.slice(0, 60));
        const removeBtn = editing
          ? `<button class="el-remove" data-el-idx="${ei}" title="Remove element">×</button>`
          : '';
        return `<span class="el-chip">
          <span class="el-badge">${escapeHtml(el.label)}</span>
          <code>${loc}</code>
          ${removeBtn}
        </span>`;
      })
      .join('');

  const renderItem = (item: QueueItem, i: number): string => {
    const isEditing = editingIndex === i && editDraft !== null;
    const displayItem = isEditing ? editDraft! : item;
    const chips = renderElementChips(displayItem, isEditing);

    if (isEditing) {
      return `
        <div class="queue-item editing">
          <div class="elements">${chips || '<span style="color:#9ca3af;font-size:11px">No elements — saving will remove this item.</span>'}</div>
          <textarea class="edit-comment" data-idx="${i}">${escapeHtml(displayItem.comment)}</textarea>
          <div class="edit-actions">
            <button class="cancel" data-idx="${i}">Cancel</button>
            <button class="save" data-idx="${i}">Save</button>
          </div>
        </div>`;
    }
    return `
      <div class="queue-item">
        <div class="elements">${chips}</div>
        <div class="comment">${escapeHtml(item.comment)}</div>
        <div class="item-actions">
          <button class="edit" data-idx="${i}">Edit</button>
          <button class="remove" data-idx="${i}">Remove</button>
        </div>
      </div>`;
  };

  queueList.innerHTML = Array.from(groups.entries())
    .map(
      ([route, { indexes }]) => `
      <div class="route-group">
        <div class="route-header">
          <span class="route-path">${escapeHtml(route)}</span>
          <span class="route-count">${indexes.length}</span>
        </div>
        ${indexes.map((i) => renderItem(queue[i], i)).join('')}
      </div>`,
    )
    .join('');

  queueList.querySelectorAll<HTMLButtonElement>('.remove').forEach((b) => {
    b.addEventListener('click', async () => {
      const idx = parseInt(b.dataset.idx ?? '-1', 10);
      if (idx < 0 || !currentOrigin) return;
      const next: QueueItem[] = [...queue];
      next.splice(idx, 1);
      if (editingIndex === idx) { editingIndex = null; editDraft = null; }
      await sendMsg({ type: 'updateQueue', origin: currentOrigin, queue: next });
      refresh();
    });
  });

  queueList.querySelectorAll<HTMLButtonElement>('.edit').forEach((b) => {
    b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.idx ?? '-1', 10);
      if (idx < 0 || idx >= queue.length) return;
      editingIndex = idx;
      // Deep-copy elements so removing element chips doesn't mutate the live queue.
      editDraft = { comment: queue[idx].comment, elements: queue[idx].elements.map((e) => ({ ...e })) };
      refresh();
    });
  });

  queueList.querySelectorAll<HTMLButtonElement>('.cancel').forEach((b) => {
    b.addEventListener('click', () => {
      editingIndex = null;
      editDraft = null;
      refresh();
    });
  });

  queueList.querySelectorAll<HTMLTextAreaElement>('.edit-comment').forEach((ta) => {
    ta.addEventListener('input', () => {
      if (editDraft) editDraft.comment = ta.value;
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        (queueList.querySelector<HTMLButtonElement>('.save') ?? null)?.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editingIndex = null;
        editDraft = null;
        refresh();
      }
    });
    // Focus and place caret at end on render.
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
  });

  queueList.querySelectorAll<HTMLButtonElement>('.el-remove').forEach((b) => {
    b.addEventListener('click', () => {
      if (!editDraft) return;
      const ei = parseInt(b.dataset.elIdx ?? '-1', 10);
      if (ei < 0 || ei >= editDraft.elements.length) return;
      editDraft.elements.splice(ei, 1);
      refresh();
    });
  });

  queueList.querySelectorAll<HTMLButtonElement>('.save').forEach((b) => {
    b.addEventListener('click', async () => {
      const idx = parseInt(b.dataset.idx ?? '-1', 10);
      if (idx < 0 || !currentOrigin || !editDraft) return;
      const comment = editDraft.comment.trim();
      const next: QueueItem[] = [...queue];
      if (editDraft.elements.length === 0) {
        // No elements left — remove the item entirely.
        next.splice(idx, 1);
      } else if (!comment) {
        // Empty comment — keep editing, focus textarea.
        const ta = queueList.querySelector<HTMLTextAreaElement>('.edit-comment');
        ta?.focus();
        return;
      } else {
        next[idx] = { comment, elements: editDraft.elements };
      }
      editingIndex = null;
      editDraft = null;
      await sendMsg({ type: 'updateQueue', origin: currentOrigin, queue: next });
      refresh();
    });
  });
}

btnCopy.addEventListener('click', async () => {
  btnCopy.textContent = 'Copying…';
  const result = await sendMsg({ type: 'flushToClipboard', origin: currentOrigin });
  if (result.ok && result.text) {
    await navigator.clipboard.writeText(result.text);
    btnCopy.textContent = 'Copied ✓ (queue kept)';
    setTimeout(() => { btnCopy.textContent = '📋 Copy for AI'; refresh(); }, 1500);
  } else {
    btnCopy.textContent = '📋 Copy for AI';
  }
});

btnSend.addEventListener('click', async () => {
  btnSend.textContent = 'Sending…';
  const result = await sendMsg({ type: 'flushToSidecar' });
  if (result.ok) {
    const label = result.skipped > 0
      ? `Sent ${result.sent} · kept ${result.skipped}`
      : `Sent ${result.sent} ✓`;
    btnSend.textContent = label;
    setTimeout(() => { btnSend.textContent = '📡 Send to project'; refresh(); }, 1800);
  } else {
    alert(`Send failed: ${result.error ?? 'unknown error'}`);
    btnSend.textContent = '📡 Send to project';
  }
});

btnClear.addEventListener('click', async () => {
  if (!currentOrigin) return;
  if (!confirm(`Clear queue for ${currentOrigin}?`)) return;
  await sendMsg({ type: 'clearQueue', origin: currentOrigin });
  refresh();
});

btnPick.addEventListener('click', async () => {
  await sendMsg({ type: 'activatePick' });
  // Close the popup so the user is back on the page in pick mode.
  window.close();
});

toggleDisabled.addEventListener('change', async () => {
  if (!currentOrigin) return;
  await sendMsg({
    type: 'setSiteDisabled',
    origin: currentOrigin,
    disabled: toggleDisabled.checked,
  });
  refresh();
});

refresh();
