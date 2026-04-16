#!/usr/bin/env node
/**
 * CLI entry: `npx website-overlay`
 *
 * Starts the sidecar HTTP server that receives queue items from the browser
 * extension and writes them to a JSONL file in the project directory.
 */

import path from 'node:path';
import fs from 'node:fs';
import { startServer } from './server.js';

function findProjectRoot(from: string): string {
  let dir = from;
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, '.git'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return from;
}

function parseArgs(args: string[]): { port: number; dir: string } {
  let port = 7171;
  let dir = '';
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if ((args[i] === '--dir' || args[i] === '-d') && args[i + 1]) {
      dir = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
  website-overlay — sidecar server for the Website Overlay browser extension

  Usage:
    npx website-overlay [options]

  Options:
    --port, -p <number>   Port to listen on (default: 7171)
    --dir,  -d <path>     Project directory (default: auto-detect from cwd)
    --help, -h            Show this help
`);
      process.exit(0);
    }
  }
  if (!dir) dir = findProjectRoot(process.cwd());
  return { port, dir };
}

const { port, dir } = parseArgs(process.argv.slice(2));

startServer({
  port,
  dir,
  filename: '.website-overlay.jsonl',
});
