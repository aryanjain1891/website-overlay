# Chrome Web Store listing — copy & assets to fill in

_This is a worksheet, not user-facing. Use these answers when filling in the store dashboard._

## Item details

### Name
Website Overlay

### Short description (132 chars max)
> Click any UI element on any website, describe what should change, and hand the changes to your AI coding tool in one paste.

(118 chars)

### Detailed description (16,000 chars max)
> Stop describing UI changes in words.
>
> Website Overlay lets you click elements directly on any website — your localhost, staging, or even a live production page — annotate what you want changed, and hand it to your AI coding tool in one click.
>
> No screenshots. No copy-pasting CSS selectors. Just point, comment, go.
>
> ## How it works
>
> 1. You're on your app. You see a button that needs to be red.
> 2. Press Alt+Shift+C. Click the button. Type "make this red".
> 3. You see a nav bar that should move. Click it too. Type "move ① above ②".
> 4. Click "Copy for AI" in the popup.
> 5. Paste into Claude Code / Cursor / Windsurf / whatever you use.
> 6. Your AI has everything it needs — element location, page context, your instructions — and makes the change.
>
> ## Features
>
> - Multi-element picks with numbered references (①②③) so you can describe relationships
> - Drafts and queues that survive navigation across pages on the same site
> - Edit and remove queued items inline before sending
> - Per-site disable, friendly install prompt (active tab only)
> - Optional local sidecar that writes picks directly to a file in your project — perfect for "apply the queue" flows in Claude Code, Cursor, etc.
> - Optional framework plugins (Vite, Next.js, Webpack) that stamp every element with its exact source file and line number
>
> ## What it works with
>
> - Any Chromium browser (Chrome, Edge, Brave, Arc)
> - Any website (localhost, staging, production, third-party)
> - Any AI coding tool (Claude Code, Cursor, Windsurf, Copilot, etc.)
> - Any frontend framework (React, Vue, Svelte, Angular, plain HTML)
>
> ## Privacy
>
> No telemetry. No analytics. No servers. Everything stays on your device unless you explicitly Copy or Send.
>
> Open source: https://github.com/aryanjain1891/website-overlay

### Category
Developer Tools

### Language
English

## Privacy practices form

When the Web Store dashboard asks "Does your extension do any of the following?" answer:

- **Personally identifiable information**: No
- **Health information**: No
- **Financial / payment information**: No
- **Authentication information**: No
- **Personal communications**: No
- **Location**: No
- **Web history**: No (we only see the page you explicitly activate us on)
- **User activity**: No
- **Website content**: **Yes** — explain: "Reads the DOM, attributes, and text content of the element the user explicitly clicks while picking, in order to build a CSS selector and citation. Stays in `chrome.storage.local` until the user copies or sends it."

### Single purpose statement
> Click UI elements on any website, annotate them, and hand the annotated picks to AI coding tools.

### Permissions justifications

Paste each into the matching field in the dashboard:

- **activeTab** — "Required to inject the pick UI on the tab where the user presses Alt+Shift+C or clicks the toolbar icon. The extension does not auto-inject on every page."
- **scripting** — "Required to programmatically inject the content script into the active tab on activation."
- **webNavigation** — "Required to detect same-origin navigation so we can re-inject the content script and preserve the user's in-progress draft across page navigation. We listen only to onCommitted; no URL data leaves the device."
- **storage** — "Stores the user's queue of picks per-site, their per-site disable list, and per-tab activation state, all locally in chrome.storage.local."
- **clipboardWrite** — "Used by the 'Copy for AI' action to place a formatted prompt on the user's clipboard."

### Privacy policy URL
> https://aryanjain1891.github.io/website-overlay/privacy/

Hosted via GitHub Pages from the `docs/` folder of this repo (`docs/privacy.md`). The Pages site also has a small landing index.

## Assets needed

| Asset | Spec | Status |
|-------|------|--------|
| Store icon | 128×128 PNG | _have it (`extension/icons/icon-128.png`) — verify it looks intentional_ |
| Small promo tile | 440×280 PNG | **TODO** — needed for store listing |
| Marquee promo tile | 1400×560 PNG (optional, only if featured) | _skip for now_ |
| Screenshot 1 | 1280×800 PNG, "Pick mode active" | **TODO** |
| Screenshot 2 | 1280×800 PNG, "Compose comment" | **TODO** |
| Screenshot 3 | 1280×800 PNG, "Queue panel" | **TODO** |
| Screenshot 4 | 1280×800 PNG, "Toolbar popup" | **TODO** |
| Screenshot 5 | 1280×800 PNG, "Pasted into Claude/Cursor" | **TODO** |
| Demo video | YouTube link, 30-90s | **TODO** (highly recommended; optional but converts ~5x better) |

## Submission checklist

- [ ] Bump `version` in `extension/manifest.json` and `package.json` if changed since last submit
- [ ] Run `npm run build` and verify `extension/dist/*` is current
- [ ] Run `npm run package:extension` to produce `website-overlay-extension.zip`
- [ ] Upload zip to Chrome Web Store dashboard
- [ ] Fill in all listing fields above
- [ ] Upload screenshots and promo tile
- [ ] Add privacy policy URL
- [ ] Submit for review (1-3 day turnaround typically)
