/**
 * Vite plugin for Website Overlay.
 *
 * Usage:
 *   import websiteOverlay from 'website-overlay/vite';
 *   export default defineConfig({ plugins: [react(), websiteOverlay()] });
 *
 * What it does (dev only):
 *   1. Runs shared babel transform to stamp data-overlay-src on JSX elements.
 *   2. Optionally serves the sidecar endpoints (/__wo/append, /clear, /status)
 *      so you don't need to run `npx website-overlay` separately.
 */

import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { overlayBabelPlugin } from '../shared/babel-plugin.js';

interface Options {
  /** Path to the queue file. Default: <project-root>/.website-overlay.jsonl */
  queueFile?: string;
  /** Serve sidecar endpoints from the Vite dev server. Default: true */
  sidecar?: boolean;
}

export default function websiteOverlayVite(opts: Options = {}): Plugin[] {
  const serveSidecar = opts.sidecar !== false;

  const babelPlugin: Plugin = {
    name: 'website-overlay:babel',
    apply: 'serve',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.[jt]sx$/.test(id)) return;
      if (id.includes('node_modules')) return;
      try {
        const babel = await import('@babel/core');
        const result = await babel.transformAsync(code, {
          filename: id,
          plugins: [
            ['@babel/plugin-syntax-typescript', { isTSX: true }],
            overlayBabelPlugin,
          ],
          sourceMaps: true,
          configFile: false,
          babelrc: false,
        });
        if (result?.code) {
          return { code: result.code, map: result.map };
        }
      } catch {
        // Babel not installed — skip stamping silently
      }
    },
  };

  const sidecarPlugin: Plugin = {
    name: 'website-overlay:sidecar',
    apply: 'serve',
    configureServer(server) {
      if (!serveSidecar) return;
      const root = server.config.root;
      const queueFile = opts.queueFile ?? path.resolve(root, '.website-overlay.jsonl');

      const json = (res: any, status: number, data: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify(data));
      };

      const readBody = (req: any): Promise<string> =>
        new Promise((resolve) => {
          let body = '';
          req.on('data', (c: any) => (body += c));
          req.on('end', () => resolve(body));
        });

      server.middlewares.use('/__wo/ping', (_req: any, res: any) =>
        json(res, 200, { ok: true }),
      );

      server.middlewares.use('/__wo/append', async (req: any, res: any) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false });
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        fs.appendFileSync(queueFile, JSON.stringify({ ...parsed, queuedAt: new Date().toISOString() }) + '\n');
        json(res, 200, { ok: true, file: queueFile });
      });

      server.middlewares.use('/__wo/clear', async (req: any, res: any) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false });
        if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile);
        json(res, 200, { ok: true });
      });

      server.middlewares.use('/__wo/status', (_req: any, res: any) => {
        const exists = fs.existsSync(queueFile);
        const count = exists ? fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean).length : 0;
        json(res, 200, { ok: true, file: queueFile, count });
      });

      console.log(`[website-overlay] dev endpoints ready · queue: ${queueFile}`);
    },
  };

  return [babelPlugin, sidecarPlugin];
}
