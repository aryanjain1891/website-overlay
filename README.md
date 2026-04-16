# Website Overlay

Click any UI element on any website, describe what you want changed, and hand it off to your AI coding tool (Claude Code, Cursor, Windsurf, etc.).

Works on **any frontend** — React, Vue, Svelte, Angular, plain HTML, localhost or production.

## How it works

1. **Install the browser extension** (Chromium-based: Chrome, Edge, Brave, Arc)
2. **Press `Alt+Shift+C`** (or click the 🎯 Pick pill) on any page
3. **Click elements** — each gets a numbered badge (①②③)
4. **Press Enter** → write a comment referencing the badges: *"move ① above ②"*
5. **Flush** via the extension popup:
   - **Copy for AI** → copies structured markdown to clipboard → paste into your AI tool
   - **Send to project** → writes to a JSONL file your AI tool reads directly (requires sidecar)

## Install

### Browser extension (required)

```bash
git clone https://github.com/aryanjain1891/website-overlay.git
cd website-overlay
npm install && npm run build
```

Then load the extension:
1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder

### Sidecar server (optional — for "Send to project" mode)

```bash
npx website-overlay
# or: npx website-overlay --port 7171 --dir /path/to/project
```

The sidecar writes `.website-overlay.jsonl` in your project root. Tell your AI: *"apply the overlay queue"*.

### Framework plugins (optional — for exact source locations)

Without plugins, the extension identifies elements by CSS selector + text content. With a plugin, it stamps exact `file:line:col` on every DOM element in dev builds.

<details>
<summary><strong>Vite</strong> (React, Solid, Vue JSX)</summary>

```ts
// vite.config.ts
import websiteOverlay from 'website-overlay/vite';
export default defineConfig({ plugins: [react(), websiteOverlay()] });
```
</details>

<details>
<summary><strong>Webpack</strong> (CRA, custom)</summary>

```js
// webpack.config.js
const { WebsiteOverlayPlugin } = require('website-overlay/webpack');
module.exports = { plugins: [new WebsiteOverlayPlugin()] };
```
</details>

<details>
<summary><strong>Next.js</strong></summary>

```js
// next.config.js
const { withWebsiteOverlay } = require('website-overlay/next');
module.exports = withWebsiteOverlay({ /* your config */ });
```
</details>

## "Copy for AI" output format

When you click **Copy for AI**, the clipboard gets structured markdown like:

```markdown
## UI Changes Requested

### ① `<button class="btn-primary">Submit</button>`
- **Page**: https://app.com/settings
- **Selector**: `div.settings-form > button.btn-primary`
- **Source**: `src/components/SettingsForm.tsx:42`
- **Change**: "make this red, reduce padding"
```

Paste this into Claude Code, Cursor, Windsurf, or any AI coding tool. The AI uses the selector/source info to find the right code and apply your changes.

## Architecture

```
Browser Extension          →  Copy for AI (clipboard)
  ├─ Content script              paste into any AI tool
  │   (overlay, pick, badges)
  ├─ Background script     →  Send to project (sidecar)
  │   (queue, sidecar detect)     writes .website-overlay.jsonl
  └─ Popup
      (queue view, flush)

Optional framework plugins
  ├─ Vite plugin
  ├─ Webpack plugin         stamp data-overlay-src="file:line:col"
  └─ Next.js wrapper        on every DOM element in dev builds
```

## Development

```bash
npm install
npm run build        # builds extension + sidecar + plugins
npm run build:ext    # extension only
npm run build:sidecar # sidecar only
```

## License

MIT
