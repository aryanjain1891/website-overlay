/** Rich context captured from a picked DOM element. */
export interface PickedElement {
  /** Unique CSS selector path to this element. */
  selector: string;
  /** Tag name, e.g. "button", "div". */
  tagName: string;
  /** First ~160 chars of textContent. */
  text: string;
  /** Space-separated class list. */
  classes: string;
  /** Notable attributes: id, data-testid, aria-label, role, href, etc. */
  attributes: Record<string, string>;
  /** Full page URL where the element was picked. */
  pageUrl: string;
  /** Pathname portion of the URL. */
  pageRoute: string;
  /** Circled-number label: "①", "②", etc. */
  label: string;

  /** Absolute source file path (only if data-overlay-src stamped). */
  sourceFile?: string;
  /** Source line (only if stamped or React dev fiber found). */
  sourceLine?: number;
  /** Source column. */
  sourceColumn?: number;
}

/** A single queued item: one or more elements + one comment. */
export interface QueueItem {
  elements: PickedElement[];
  comment: string;
  /** ISO timestamp when flushed. */
  queuedAt?: string;
}

/** Queue storage is bucketed by origin (scheme + host + port). */
export type QueueByOrigin = Record<string, QueueItem[]>;

/** Response shape from the background for `getQueue`. */
export interface GetQueueResponse {
  /** Items for the caller's origin (or all, if origin omitted). */
  queue: QueueItem[];
  /** Current origin the response is scoped to, if any. */
  origin?: string;
  /** Item counts for every origin that has pending items. */
  countsByOrigin: Record<string, number>;
  sidecarStatus: SidecarStatus;
  /** Origins the sidecar is willing to accept. Empty when disconnected. */
  sidecarOrigins: string[];
}

/** Messages sent between content script ↔ background script. */
export type Message =
  | { type: 'addToQueue'; item: QueueItem }
  | { type: 'getQueue'; origin?: string }
  | { type: 'clearQueue'; origin?: string }
  | { type: 'flushToClipboard'; origin?: string }
  | { type: 'flushToSidecar' }
  | { type: 'getSidecarStatus' }
  | { type: 'updateQueue'; origin: string; queue: QueueItem[] }
  | { type: 'queueUpdated'; count: number; origin: string };

export type SidecarStatus = 'connected' | 'disconnected';
