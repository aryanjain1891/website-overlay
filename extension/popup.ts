/**
 * Extension popup: shows queue, handles Copy for AI / Send to project.
 */

import type { QueueItem, SidecarStatus } from '../shared/types';

const queueList = document.getElementById('queue-list')!;
const countBadge = document.getElementById('count-badge')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
const btnSend = document.getElementById('btn-send') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

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

async function refresh() {
  const { queue, sidecarStatus }: { queue: QueueItem[]; sidecarStatus: SidecarStatus } = await sendMsg({ type: 'getQueue' });

  countBadge.textContent = String(queue.length);
  btnCopy.disabled = queue.length === 0;
  btnSend.disabled = queue.length === 0 || sidecarStatus !== 'connected';
  btnClear.disabled = queue.length === 0;

  statusDot.className = `status-dot ${sidecarStatus}`;
  statusText.textContent = sidecarStatus === 'connected'
    ? 'Sidecar: connected'
    : 'Sidecar: not detected — "Copy for AI" always works';

  if (queue.length === 0) {
    queueList.innerHTML = `
      <div class="empty-state">
        Queue is empty.<br>
        Press <b>Alt+Shift+C</b> on any page to start picking elements.
      </div>`;
    return;
  }

  queueList.innerHTML = queue
    .map((item, i) => {
      const elPreviews = item.elements
        .map((el) => {
          const loc = el.sourceFile
            ? `${escapeHtml(shortPath(el.sourceFile))}:${el.sourceLine ?? '?'}`
            : escapeHtml(el.selector.slice(0, 60));
          return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:6px">
            <span style="display:inline-flex;align-items:center;justify-content:center;min-width:14px;height:14px;padding:0 3px;background:#2563eb;color:#fff;border-radius:999px;font:600 9px sans-serif">${escapeHtml(el.label)}</span>
            <code style="font-size:10px">${loc}</code>
          </span>`;
        })
        .join('');
      return `
        <div class="queue-item">
          <div class="elements">${elPreviews}</div>
          <div class="comment">${escapeHtml(item.comment)}</div>
          <button class="remove" data-idx="${i}">Remove</button>
        </div>`;
    })
    .join('');

  queueList.querySelectorAll<HTMLButtonElement>('.remove').forEach((b) => {
    b.addEventListener('click', async () => {
      const idx = parseInt(b.dataset.idx ?? '-1', 10);
      if (idx < 0) return;
      const { queue } = await sendMsg({ type: 'getQueue' });
      queue.splice(idx, 1);
      await sendMsg({ type: 'updateQueue', queue });
      refresh();
    });
  });
}

btnCopy.addEventListener('click', async () => {
  btnCopy.textContent = 'Copying…';
  const result = await sendMsg({ type: 'flushToClipboard' });
  if (result.ok && result.text) {
    await navigator.clipboard.writeText(result.text);
    btnCopy.textContent = 'Copied ✓';
    setTimeout(() => { btnCopy.textContent = '📋 Copy for AI'; refresh(); }, 1500);
  } else {
    btnCopy.textContent = '📋 Copy for AI';
  }
});

btnSend.addEventListener('click', async () => {
  btnSend.textContent = 'Sending…';
  const result = await sendMsg({ type: 'flushToSidecar' });
  if (result.ok) {
    btnSend.textContent = 'Sent ✓';
    setTimeout(() => { btnSend.textContent = '📡 Send to project'; refresh(); }, 1500);
  } else {
    alert(`Send failed: ${result.error}`);
    btnSend.textContent = '📡 Send to project';
  }
});

btnClear.addEventListener('click', async () => {
  if (!confirm('Clear the entire queue?')) return;
  await sendMsg({ type: 'clearQueue' });
  refresh();
});

refresh();
