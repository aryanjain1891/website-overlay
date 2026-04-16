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

/** Messages sent between content script ↔ background script. */
export type Message =
  | { type: 'addToQueue'; item: QueueItem }
  | { type: 'getQueue' }
  | { type: 'clearQueue' }
  | { type: 'flushToClipboard' }
  | { type: 'flushToSidecar' }
  | { type: 'getSidecarStatus' }
  | { type: 'queueUpdated'; count: number };

export type SidecarStatus = 'connected' | 'disconnected';
