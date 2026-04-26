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
| **Queue** | Hit **Queue**. Pick more things on the same page or navigate to other pages — your queue persists, and so does an in-progress draft (see *Multi-screen flows* below). |
| **Send to AI** | Click the extension icon → **Copy for AI**. Paste into your AI tool. Done. |

### Multi-screen flows

Real tasks usually span screens — you want to comment on the login page *and* the dashboard that comes after it. Website Overlay handles this:

- **Queued items persist across navigation.** Pick on `/login`, hit Queue, go to `/dashboard`, pick more, hit Queue. Both items travel together.
- **Unfinished drafts survive navigation too.** If you pick an element and start typing but navigate before hitting Queue, your draft isn't lost. Land on any page of the same site and you'll see a **💬 Resume draft (N)** button — click it and the compose popover reopens with all your prior picks + your half-written comment, ready to keep going or submit.
- **The popup groups your queue by screen.** Each page path gets its own section with an item count, so a flow like `/login → /dashboard → /settings` is easy to scan.
- **Edit or remove queued items from the popup.** Each item has **Edit** (revise the comment, drop individual elements) and **Remove**. Useful for fixing a typo or trimming an over-broad pick before sending.
- **Copy for AI keeps the queue.** Clicking Copy puts the formatted prompt on your clipboard but leaves the queue intact, so you can iterate on the comment, copy again, then explicitly Clear when you're done. (Send to project still removes items as it ships them, since they now live as files in your repo.)
- **Queues are scoped per site.** Picks on `myapp.com` and picks on `news.ycombinator.com` live in separate buckets; the popup only shows the current site's queue, and the toolbar badge counts only the current site.

**Keyboard shortcuts inside pick mode:**
- `ESC` exits pick mode *without discarding* your draft. To throw a draft away, click **Cancel** inside the compose popover.
- **⏸ Pause** (button next to the Pick pill) lets clicks pass through to the page so you can follow links, fill forms, or navigate to another screen without leaving pick mode. Click **▶ Resume** to keep picking. The pill switches to "⏸ Paused — clicks pass through" so the state is obvious.
- **Hold `Alt`** for momentary passthrough — useful for opening a drawer or expanding a menu without picking it. Note: browsers intercept `Alt+click` on links (it triggers a download on macOS), so use **Pause** when you need to actually navigate.

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

This starts a tiny local server. The extension auto-detects it and unlocks a **Send to project** button in the popup. Clicking it writes your picks directly to `.website-overlay.jsonl` in your project so your AI tool can read them. Tell your AI *"apply the overlay queue"* and it reads the file and applies every change.

**Tell the sidecar which sites belong to this project.** So picks from unrelated tabs (say, you were browsing Twitter) never leak into your project's queue file:

```bash
# One or more --origin flags — repeatable
npx website-overlay --origin http://localhost:3000 --origin https://staging.myapp.com
```

Or commit a `.website-overlay.json` in your project root:

```json
{ "origins": ["http://localhost:3000", "https://staging.myapp.com"] }
```

The sidecar will reject anything picked on an origin that isn't on the list. If you skip origins entirely, it falls back to accepting any `localhost` / `127.0.0.1` origin so the zero-config local-dev flow still works. The popup tells you whether the sidecar claims the current site (✓) or not.

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
