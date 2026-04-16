/**
 * Service worker (Manifest V3 background script).
 * Manages the queue in chrome.storage.local and detects the sidecar server.
 */

import type { QueueItem, SidecarStatus } from '../shared/types';
import { formatQueueForClipboard } from '../shared/format';

const STORAGE_KEY = 'wo:queue';
const SIDECAR_URL_KEY = 'wo:sidecarUrl';
const DEFAULT_SIDECAR = 'http://localhost:7171';

let sidecarStatus: SidecarStatus = 'disconnected';

// ── Queue helpers ────────────────────────────────────────────

async function getQueue(): Promise<QueueItem[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as QueueItem[]) ?? [];
}

async function setQueue(queue: QueueItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: queue });
  broadcastCount(queue.length);
}

function broadcastCount(count: number) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'queueUpdated', count }).catch(() => {});
      }
    }
  });
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
}

// ── Sidecar detection ────────────────────────────────────────

async function getSidecarUrl(): Promise<string> {
  const data = await chrome.storage.local.get(SIDECAR_URL_KEY);
  return (data[SIDECAR_URL_KEY] as string) ?? DEFAULT_SIDECAR;
}

async function pingSidecar(): Promise<SidecarStatus> {
  try {
    const url = await getSidecarUrl();
    const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(2000) });
    sidecarStatus = res.ok ? 'connected' : 'disconnected';
  } catch {
    sidecarStatus = 'disconnected';
  }
  return sidecarStatus;
}

// Poll every 30s
setInterval(pingSidecar, 30_000);
pingSidecar();

// ── Flush to sidecar ─────────────────────────────────────────

async function flushToSidecar(): Promise<{ ok: boolean; error?: string }> {
  const queue = await getQueue();
  if (queue.length === 0) return { ok: true };
  const url = await getSidecarUrl();
  try {
    for (const item of queue) {
      const res = await fetch(`${url}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, queuedAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    await setQueue([]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Flush to clipboard ───────────────────────────────────────

async function flushToClipboard(): Promise<{ ok: boolean; text?: string; error?: string }> {
  const queue = await getQueue();
  if (queue.length === 0) return { ok: true, text: '' };
  const text = formatQueueForClipboard(queue);
  // Can't use navigator.clipboard in service worker — send to active tab
  // The popup handles the actual clipboard write.
  await setQueue([]);
  return { ok: true, text };
}

// ── Message handler ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'addToQueue': {
        const queue = await getQueue();
        queue.push(msg.item);
        await setQueue(queue);
        sendResponse({ ok: true, count: queue.length });
        break;
      }
      case 'getQueue': {
        const queue = await getQueue();
        sendResponse({ queue, sidecarStatus });
        break;
      }
      case 'clearQueue': {
        await setQueue([]);
        sendResponse({ ok: true });
        break;
      }
      case 'flushToClipboard': {
        const result = await flushToClipboard();
        sendResponse(result);
        break;
      }
      case 'flushToSidecar': {
        const result = await flushToSidecar();
        sendResponse(result);
        break;
      }
      case 'getSidecarStatus': {
        const status = await pingSidecar();
        sendResponse({ sidecarStatus: status });
        break;
      }
      case 'updateQueue': {
        await setQueue(msg.queue);
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ error: 'unknown message type' });
    }
  })();
  return true; // async sendResponse
});
