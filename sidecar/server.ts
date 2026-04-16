/**
 * Minimal HTTP server for the sidecar. Zero npm dependencies — Node stdlib only.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export interface SidecarOptions {
  port: number;
  dir: string;
  filename: string;
}

export function startServer(opts: SidecarOptions) {
  const queueFile = path.resolve(opts.dir, opts.filename);

  const json = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(data));
  };

  const readBody = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });

  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const url = new URL(req.url ?? '/', `http://localhost:${opts.port}`);

    if (url.pathname === '/ping') {
      return json(res, 200, { ok: true, version: '0.1.0', dir: opts.dir });
    }

    if (url.pathname === '/append' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        const line = JSON.stringify({ ...parsed, queuedAt: new Date().toISOString() });
        fs.appendFileSync(queueFile, line + '\n');
        return json(res, 200, { ok: true, file: queueFile });
      } catch (e) {
        return json(res, 500, { ok: false, error: (e as Error).message });
      }
    }

    if (url.pathname === '/clear' && req.method === 'POST') {
      try {
        if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile);
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 500, { ok: false, error: (e as Error).message });
      }
    }

    if (url.pathname === '/status') {
      try {
        const exists = fs.existsSync(queueFile);
        const count = exists
          ? fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean).length
          : 0;
        return json(res, 200, { ok: true, file: queueFile, count });
      } catch (e) {
        return json(res, 500, { ok: false, error: (e as Error).message });
      }
    }

    json(res, 404, { error: 'not found' });
  });

  server.listen(opts.port, () => {
    console.log(`\n  Website Overlay sidecar running`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  URL:    http://localhost:${opts.port}`);
    console.log(`  Queue:  ${queueFile}`);
    console.log(`\n  Press Ctrl+C to stop.\n`);
  });

  return server;
}
