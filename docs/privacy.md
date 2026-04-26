---
title: Privacy
permalink: /privacy/
---

# Privacy Policy

_Last updated: 2026-04-27_

This privacy policy describes how the Website Overlay browser extension and the optional Website Overlay sidecar (`npx website-overlay`) handle your information.

## Plain-English summary

- **Nothing leaves your device by default.** When you Copy for AI, picks go to your clipboard. When you Send to project, picks go to a local file on your own machine.
- **No analytics. No telemetry. No accounts.** We don't collect usage data. We don't have servers. There's nothing to log into.
- **No third-party services contact us, ever.** The extension never makes outbound network requests except to the local sidecar at `http://localhost:7171` if you've started it yourself.
- **You're in control of which sites we touch.** The extension only activates when you press `Alt+Shift+C` or click the toolbar icon. You can disable it per-site from the popup at any time.

## What the extension reads

When you activate Website Overlay on a tab and pick an element, the extension reads:

- The DOM of the page you're on (HTML structure, CSS classes, attributes, text content) — this is how it builds the CSS selector for the picked element.
- The page URL (origin + path) — used to scope your queue per-site and to cite which page each pick came from.
- Source-file location, if your project uses one of our framework plugins — read from a `data-overlay-src` attribute that the plugin adds at build time.

This data stays inside your browser, in `chrome.storage.local`, on your machine. We don't transmit it anywhere unless you explicitly trigger an action that does.

## What gets transmitted, and where

There are exactly two outbound paths, both initiated only by your explicit click:

1. **"Copy for AI"** writes formatted markdown to your clipboard via the standard Web Clipboard API. From there, you control where it goes (typically a paste into Claude Code, Cursor, ChatGPT, or whatever AI tool you use). This involves no network request from the extension itself.

2. **"Send to project"** sends an HTTP POST to the sidecar at `http://localhost:7171` (or whichever local URL you configured), which writes a line to `.website-overlay.jsonl` in your project directory. This is a local-only request that never leaves your machine.

## What the sidecar reads and writes

The sidecar (`npx website-overlay`) runs entirely on your computer. It accepts POSTs from the extension and appends each pick to a file in your project. The sidecar:

- Listens only on `localhost`, never on a public network interface
- Rejects requests that don't carry a `chrome-extension://...` Origin or come from an origin you've allowlisted
- Never makes outbound network requests of its own

## What we don't do

- We don't have a server. There's no "Website Overlay backend."
- We don't have user accounts.
- We don't have analytics, telemetry, error reporting, or crash collection.
- We don't sell or share data — there's no data to sell or share.
- We don't read pages you haven't activated us on. The extension only injects its content script when you press the keyboard shortcut or click the toolbar icon.

## Permissions justification

| Permission | Why we need it |
|------------|----------------|
| `activeTab` | To inject the pick UI on the tab where you press Alt+Shift+C or click our icon. |
| `scripting` | To programmatically inject the content script into the active tab on activation. |
| `webNavigation` | To re-inject the content script when you navigate to a new page on the same site, so your in-progress picks survive navigation. |
| `storage` | To persist your queue of picks per-site, the per-site disable list, and active-tab state, all locally in your browser. |
| `clipboardWrite` | To put the formatted prompt on your clipboard when you click "Copy for AI". |

## Open source

The full source code of both the extension and the sidecar is public at [github.com/aryanjain1891/website-overlay](https://github.com/aryanjain1891/website-overlay). You can read every line and audit anything described here.

## Contact

Questions, concerns, or anything that looks wrong? Open an issue at [github.com/aryanjain1891/website-overlay/issues](https://github.com/aryanjain1891/website-overlay/issues).
