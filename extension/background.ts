/**
 * Service worker (Manifest V3 background script).
 * Manages a per-origin queue in chrome.storage.local and detects the sidecar.
 */

import type { QueueByOrigin, QueueItem, SidecarStatus } from '../shared/types';
import { formatQueueForClipboard } from '../shared/format';

const STORAGE_KEY = 'wo:queue';
const SIDECAR_URL_KEY = 'wo:sidecarUrl';
const DEFAULT_SIDECAR = 'http://localhost:7171';
const DISABLED_KEY = 'wo:disabledOrigins';
const ACTIVE_TABS_KEY = 'wo:activeTabs';
const CONTENT_SCRIPT = 'dist/content.js';

let sidecarStatus: SidecarStatus = 'disconnected';
let sidecarOrigins: string[] = [];

// ── Origin helpers ───────────────────────────────────────────

function originOfUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function originOfItem(item: QueueItem): string | null {
  return originOfUrl(item.elements[0]?.pageUrl);
}

async function activeTabOrigin(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return originOfUrl(tab?.url);
}

// ── Per-site disable & per-tab activation ────────────────────
// activeTab is a "click-to-activate" permission: the content script only
// gets injected when the user explicitly invokes us (toolbar click, Alt+Shift+C).
// We track which tab+origin pairs have been activated so we can re-inject
// after same-origin navigation, preserving the cross-page draft flow.

async function getDisabledOrigins(): Promise<string[]> {
  const data = await chrome.storage.local.get(DISABLED_KEY);
  return (data[DISABLED_KEY] as string[]) ?? [];
}

async function isOriginDisabled(origin: string | null): Promise<boolean> {
  if (!origin) return false;
  const list = await getDisabledOrigins();
  return list.includes(origin);
}

async function setOriginDisabled(origin: string, disabled: boolean): Promise<void> {
  const list = await getDisabledOrigins();
  const i = list.indexOf(origin);
  if (disabled && i === -1) list.push(origin);
  else if (!disabled && i >= 0) list.splice(i, 1);
  await chrome.storage.local.set({ [DISABLED_KEY]: list });
}

async function getActiveTabs(): Promise<Record<number, string>> {
  // chrome.storage.session is per-browser-session; tab IDs reset on browser
  // restart so this is the right scope. Fall back to {} if unavailable.
  if (!chrome.storage.session) return {};
  const data = await chrome.storage.session.get(ACTIVE_TABS_KEY);
  return (data[ACTIVE_TABS_KEY] as Record<number, string>) ?? {};
}

async function markTabActivated(tabId: number, origin: string): Promise<void> {
  if (!chrome.storage.session) return;
  const map = await getActiveTabs();
  map[tabId] = origin;
  await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: map });
}

async function clearTabActivation(tabId: number): Promise<void> {
  if (!chrome.storage.session) return;
  const map = await getActiveTabs();
  if (map[tabId] !== undefined) {
    delete map[tabId];
    await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: map });
  }
}

async function tabActivatedOrigin(tabId: number): Promise<string | null> {
  const map = await getActiveTabs();
  return map[tabId] ?? null;
}

/** Inject content.js into a tab. Idempotent — content.js guards against
 *  double-mount. Skips chrome:// and other restricted URLs silently. */
async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT],
    });
    return true;
  } catch {
    return false;
  }
}

/** User invoked us on a tab — inject (if needed), enter or toggle pick mode,
 *  remember the origin so future navigations within it auto-reactivate. */
async function activateOnTab(
  tabId: number,
  url: string | undefined,
  mode: 'enter' | 'toggle' = 'enter',
): Promise<void> {
  const origin = originOfUrl(url);
  if (!origin) return;
  if (await isOriginDisabled(origin)) {
    chrome.action.setBadgeText({ tabId, text: 'off' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#9ca3af' });
    return;
  }
  const msgType = mode === 'toggle' ? 'togglePickMode' : 'enterPickMode';
  // Try to message an existing content script first; fall back to injecting.
  let messaged = false;
  try {
    await chrome.tabs.sendMessage(tabId, { type: msgType });
    messaged = true;
  } catch {
    /* not yet injected */
  }
  if (!messaged) {
    const ok = await injectContentScript(tabId);
    if (!ok) return;
    await chrome.tabs.sendMessage(tabId, { type: msgType }).catch(() => {});
  }
  await markTabActivated(tabId, origin);
}

// Keyboard shortcut entry point (Alt+Shift+C). Note: action.onClicked does
// NOT fire when a default_popup is set — the popup intercepts. The popup
// itself sends 'activatePick' if the user wants to start picking.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-pick' || !tab?.id) return;
  await activateOnTab(tab.id, tab.url, 'toggle');
});

// Re-inject on same-origin navigation so the floating UI and any in-progress
// draft survive. Different-origin navigation deactivates the tab.
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const tabId = details.tabId;
  const newOrigin = originOfUrl(details.url);
  const activatedOrigin = await tabActivatedOrigin(tabId);
  if (!activatedOrigin) return;
  if (newOrigin !== activatedOrigin) {
    // User navigated to a different site; forget the activation.
    await clearTabActivation(tabId);
    return;
  }
  await injectContentScript(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabActivation(tabId).catch(() => {});
});

// ── Queue storage ────────────────────────────────────────────

async function getAllQueues(): Promise<QueueByOrigin> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY];
  // Back-compat: if a previous build stored a flat array, migrate it in-memory.
  if (Array.isArray(raw)) {
    const migrated: QueueByOrigin = {};
    for (const item of raw as QueueItem[]) {
      const origin = originOfItem(item) ?? 'unknown';
      (migrated[origin] ??= []).push(item);
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
    return migrated;
  }
  return (raw as QueueByOrigin) ?? {};
}

async function setAllQueues(queues: QueueByOrigin): Promise<void> {
  // Drop empty buckets so storage stays tidy.
  for (const key of Object.keys(queues)) {
    if (queues[key].length === 0) delete queues[key];
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: queues });
  await broadcastCounts(queues);
}

function countsByOrigin(queues: QueueByOrigin): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [origin, items] of Object.entries(queues)) {
    if (items.length > 0) out[origin] = items.length;
  }
  return out;
}

async function broadcastCounts(queues: QueueByOrigin) {
  const counts = countsByOrigin(queues);
  // Notify each tab about its own origin's count.
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      const origin = originOfUrl(tab.url);
      const count = origin ? (counts[origin] ?? 0) : 0;
      chrome.tabs
        .sendMessage(tab.id, { type: 'queueUpdated', count, origin: origin ?? '' })
        .catch(() => {});
    }
  });
  await refreshBadgeForActiveTab(queues);
}

async function refreshBadgeForActiveTab(queues?: QueueByOrigin) {
  const q = queues ?? (await getAllQueues());
  const origin = await activeTabOrigin();
  const count = origin ? (q[origin]?.length ?? 0) : 0;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
}

chrome.tabs.onActivated.addListener(() => refreshBadgeForActiveTab());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.status === 'complete') refreshBadgeForActiveTab();
});

// ── Sidecar detection ────────────────────────────────────────

async function getSidecarUrl(): Promise<string> {
  const data = await chrome.storage.local.get(SIDECAR_URL_KEY);
  return (data[SIDECAR_URL_KEY] as string) ?? DEFAULT_SIDECAR;
}

async function pingSidecar(): Promise<SidecarStatus> {
  try {
    const url = await getSidecarUrl();
    const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      sidecarOrigins = Array.isArray(body?.origins) ? body.origins : [];
      sidecarStatus = 'connected';
    } else {
      sidecarStatus = 'disconnected';
      sidecarOrigins = [];
    }
  } catch {
    sidecarStatus = 'disconnected';
    sidecarOrigins = [];
  }
  return sidecarStatus;
}

// Ping once on service-worker boot so the popup has a fresh status the first
// time it's opened. We don't poll on a timer — that keeps the MV3 service
// worker awake constantly and burns user battery. Status is refreshed on
// demand inside getSidecarStatus / flushToSidecar instead.
pingSidecar();

// ── Flush to sidecar (origin-scoped) ─────────────────────────

/** True if the sidecar advertises a wildcard/fallback that matches origin. */
function sidecarAccepts(origin: string): boolean {
  if (sidecarOrigins.length === 0) return false;
  for (const adv of sidecarOrigins) {
    if (adv === origin) return true;
    // Wildcard form emitted in localhost-fallback mode: "http://localhost:*".
    if (adv.endsWith(':*')) {
      const host = adv.slice(0, -2);
      if (origin.startsWith(host + ':') || origin === host) return true;
    }
  }
  return false;
}

async function flushToSidecar(): Promise<{
  ok: boolean;
  sent: number;
  skipped: number;
  error?: string;
}> {
  await pingSidecar();
  if (sidecarStatus !== 'connected') {
    return { ok: false, sent: 0, skipped: 0, error: 'sidecar not connected' };
  }

  const queues = await getAllQueues();
  const url = await getSidecarUrl();
  let sent = 0;
  let skipped = 0;
  const remaining: QueueByOrigin = {};

  try {
    for (const [origin, items] of Object.entries(queues)) {
      if (!sidecarAccepts(origin)) {
        remaining[origin] = items;
        skipped += items.length;
        continue;
      }
      for (const item of items) {
        const res = await fetch(`${url}/append`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...item, queuedAt: new Date().toISOString() }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} for origin ${origin}: ${errText}`);
        }
        sent++;
      }
    }
    await setAllQueues(remaining);
    return { ok: true, sent, skipped };
  } catch (e) {
    // Keep everything on failure so no picks are lost.
    return { ok: false, sent, skipped, error: (e as Error).message };
  }
}

// ── Flush to clipboard (origin-scoped) ───────────────────────

async function flushToClipboard(
  origin: string | undefined,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const queues = await getAllQueues();
  const targetOrigin = origin ?? (await activeTabOrigin());
  if (!targetOrigin) return { ok: false, error: 'no active origin' };

  const items = queues[targetOrigin] ?? [];
  if (items.length === 0) return { ok: true, text: '' };

  // Intentionally do not clear the queue here. Unlike sidecar Send (where items
  // are written to disk and become files the user can edit/delete in code),
  // Copy just produces clipboard text — wiping the queue would destroy the
  // user's only chance to revise or re-copy. Use Clear queue / Remove to drop.
  return { ok: true, text: formatQueueForClipboard(items) };
}

// ── Message handler ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'addToQueue': {
        const item: QueueItem = msg.item;
        const origin = originOfItem(item) ?? originOfUrl(sender.tab?.url) ?? 'unknown';
        const queues = await getAllQueues();
        (queues[origin] ??= []).push(item);
        await setAllQueues(queues);
        sendResponse({ ok: true, count: queues[origin].length, origin });
        break;
      }
      case 'getQueue': {
        const queues = await getAllQueues();
        const origin: string | undefined =
          msg.origin ?? originOfUrl(sender.tab?.url) ?? (await activeTabOrigin()) ?? undefined;
        const queue = origin ? (queues[origin] ?? []) : [];
        sendResponse({
          queue,
          origin,
          countsByOrigin: countsByOrigin(queues),
          sidecarStatus,
          sidecarOrigins,
        });
        break;
      }
      case 'clearQueue': {
        const queues = await getAllQueues();
        if (msg.origin) {
          delete queues[msg.origin];
        } else {
          for (const k of Object.keys(queues)) delete queues[k];
        }
        await setAllQueues(queues);
        sendResponse({ ok: true });
        break;
      }
      case 'flushToClipboard': {
        const result = await flushToClipboard(msg.origin);
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
        sendResponse({ sidecarStatus: status, sidecarOrigins });
        break;
      }
      case 'updateQueue': {
        if (typeof msg.origin !== 'string') {
          sendResponse({ ok: false, error: 'origin required' });
          break;
        }
        const queues = await getAllQueues();
        queues[msg.origin] = msg.queue ?? [];
        await setAllQueues(queues);
        sendResponse({ ok: true });
        break;
      }
      case 'activatePick': {
        // Sent from the popup when the user clicks "Start picking".
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await activateOnTab(tab.id, tab.url);
        sendResponse({ ok: true });
        break;
      }
      case 'getSiteState': {
        const origin =
          msg.origin ?? originOfUrl(sender.tab?.url) ?? (await activeTabOrigin()) ?? null;
        const disabled = origin ? await isOriginDisabled(origin) : false;
        sendResponse({ origin, disabled });
        break;
      }
      case 'setSiteDisabled': {
        if (typeof msg.origin !== 'string') {
          sendResponse({ ok: false, error: 'origin required' });
          break;
        }
        await setOriginDisabled(msg.origin, !!msg.disabled);
        if (msg.disabled) {
          // Tear down any tab currently running our content script on this
          // origin, otherwise the pill/panel/badges remain visible until reload.
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (!tab.id) continue;
            if (originOfUrl(tab.url) !== msg.origin) continue;
            await chrome.tabs
              .sendMessage(tab.id, { type: 'deactivate' })
              .catch(() => {});
            await clearTabActivation(tab.id);
          }
        }
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ error: 'unknown message type' });
    }
  })();
  return true; // async sendResponse
});
