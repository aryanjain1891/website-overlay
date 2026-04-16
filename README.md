# Website Overlay

**Stop describing UI changes in words. Just click what you want changed.**

Website Overlay lets you click elements directly on any website — your localhost, staging, or even a live production page — annotate what you want changed, and hand it to your AI coding tool in one click. No screenshots. No copy-pasting CSS selectors. Just point, comment, go.

## What it looks like

1. You're on your app. You see a button that needs to be red.
2. Press **Alt+Shift+C**. Click the button. Type *"make this red"*.
3. You see a nav bar that should move. Click it too. Type *"move ① above ②"*.
4. Click **Copy for AI** in the extension popup.
5. Paste into Claude Code / Cursor / Windsurf / whatever you use.
6. Your AI has everything it needs — element location, page context, your instructions — and makes the change.

That's it.

## Getting started

### 1. Install the extension

```bash
git clone https://github.com/aryanjain1891/website-overlay.git
cd website-overlay
npm install && npm run build
```

Open your browser:
- Go to `chrome://extensions` (works in Chrome, Edge, Brave, Arc — any Chromium browser)
- Turn on **Developer mode** (top right)
- Click **Load unpacked** → pick the `extension/` folder

You'll see the Website Overlay icon in your toolbar. Done.

### 2. Use it

| Step | What you do |
|---|---|
| **Activate** | Press `Alt+Shift+C` on any page, or click the 🎯 Pick pill that appears bottom-right |
| **Pick elements** | Click anything on the page. Each click tags the element with a numbered badge — ①, ②, ③. You can pick as many as you need. |
| **Comment** | Press `Enter` (or click the green **Comment** button). A popover lists everything you picked. Write what you want changed — reference badges like "swap ① and ②" or "make ① match the style of ②". |
| **Queue** | Hit **Queue**. Pick more things on the same page or navigate to other pages. Your queue persists. |
| **Send to AI** | Click the extension icon → **Copy for AI**. Paste into your AI tool. Done. |

### 3. What your AI receives

When you paste, your AI gets something like this:

```
## UI Changes Requested

### ① <button class="btn-primary">Submit</button>
- Page: https://myapp.com/settings
- Selector: div.form-actions > button.btn-primary
- Source: src/components/Settings.tsx:84    ← (if you use a framework plugin)
- Change: "make this red, reduce padding to 8px"

### ② <nav class="sidebar">
- Page: https://myapp.com/settings
- Selector: aside > nav.sidebar
- Change: "move this above the header"
```

Your AI uses the page, selector, and (optionally) exact source file to find the right code and make the edit.

## Making it even better (optional)

### Direct file writes (for localhost development)

If you're working on a project locally, you can skip the clipboard entirely. Run this in your project folder:

```bash
npx website-overlay
```

This starts a tiny local server. The extension auto-detects it and unlocks a **Send to project** button in the popup. Clicking it writes your picks directly to a file in your project that your AI tool can read. Tell your AI *"apply the overlay queue"* and it reads the file and applies every change.

### Exact source locations (for React / Next.js / Webpack projects)

By default, the extension identifies elements by their CSS selector and text — which works on any website. But if you're developing locally, you can add a one-line plugin to your build config that tags every element with its exact source file and line number. This gives your AI surgical precision.

**Vite** (React, Solid, Vue):
```ts
// vite.config.ts
import websiteOverlay from 'website-overlay/vite';
export default defineConfig({ plugins: [react(), websiteOverlay()] });
```

**Next.js**:
```js
// next.config.js
const { withWebsiteOverlay } = require('website-overlay/next');
module.exports = withWebsiteOverlay({ /* your config */ });
```

**Webpack**:
```js
// webpack.config.js
const { WebsiteOverlayPlugin } = require('website-overlay/webpack');
module.exports = { plugins: [new WebsiteOverlayPlugin()] };
```

## Works with

- Any Chromium browser (Chrome, Edge, Brave, Arc)
- Any website (localhost, staging, production, third-party)
- Any AI coding tool (Claude Code, Cursor, Windsurf, Copilot, etc.)
- Any frontend framework (React, Vue, Svelte, Angular, plain HTML)

## License

MIT
