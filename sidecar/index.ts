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

interface ParsedArgs {
  port: number;
  dir: string;
  origins: string[];
}

function parseArgs(args: string[]): ParsedArgs {
  let port = 7171;
  let dir = '';
  const origins: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if ((args[i] === '--dir' || args[i] === '-d') && args[i + 1]) {
      dir = args[i + 1];
      i++;
    } else if ((args[i] === '--origin' || args[i] === '-o') && args[i + 1]) {
      origins.push(args[i + 1]);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
  website-overlay — sidecar server for the Website Overlay browser extension

  Usage:
    npx website-overlay [options]

  Options:
    --port, -p <number>    Port to listen on (default: 7171)
    --dir,  -d <path>      Project directory (default: auto-detect from cwd)
    --origin, -o <url>     Origin this project owns (repeatable).
                           e.g. --origin http://localhost:3000 --origin https://staging.myapp.com
                           Items picked on other origins are rejected.
    --help, -h             Show this help

  Config file:
    You can also create .website-overlay.json in the project root:
      { "origins": ["http://localhost:3000", "https://staging.myapp.com"] }

  If no origins are declared, the sidecar falls back to accepting any
  localhost / 127.0.0.1 origin (so local dev still works out of the box).
`);
      process.exit(0);
    }
  }
  if (!dir) dir = findProjectRoot(process.cwd());
  return { port, dir, origins };
}

function readConfigOrigins(dir: string): string[] {
  const configPath = path.join(dir, '.website-overlay.json');
  if (!fs.existsSync(configPath)) return [];
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.origins)) {
      return parsed.origins.filter((o: unknown): o is string => typeof o === 'string');
    }
  } catch (e) {
    console.warn(`  ⚠ Could not parse ${configPath}: ${(e as Error).message}`);
  }
  return [];
}

const { port, dir, origins: cliOrigins } = parseArgs(process.argv.slice(2));
const configOrigins = readConfigOrigins(dir);
const origins = Array.from(new Set([...cliOrigins, ...configOrigins]));

startServer({
  port,
  dir,
  filename: '.website-overlay.jsonl',
  origins,
});
