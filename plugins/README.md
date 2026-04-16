# Framework Plugins

Optional plugins that stamp `data-overlay-src="file:line:col"` on every DOM element in dev builds. This gives the extension **exact source location** instead of CSS-selector-based identification.

## Vite (React, Vue via JSX, Solid)

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import websiteOverlay from 'website-overlay/vite';

export default defineConfig({
  plugins: [react(), websiteOverlay()],
});
```

## Webpack (CRA, custom setups)

```js
// webpack.config.js
const { WebsiteOverlayPlugin } = require('website-overlay/webpack');

module.exports = {
  plugins: [new WebsiteOverlayPlugin()],
};
```

## Next.js

```js
// next.config.js
const { withWebsiteOverlay } = require('website-overlay/next');

module.exports = withWebsiteOverlay({
  // your existing config
});
```

## How it works

All plugins use the same Babel transform (`shared/babel-plugin.ts`) that adds a `data-overlay-src` attribute to every lowercase (intrinsic) JSX element:

```jsx
// Before
<button className="btn">Submit</button>

// After (dev only)
<button className="btn" data-overlay-src="/abs/path/src/Form.tsx:42:8">Submit</button>
```

The browser extension reads this attribute when you pick an element, giving your AI tool the exact file and line to edit.
