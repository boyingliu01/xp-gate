#!/usr/bin/env node
'use strict';

/**
 * copy-client.cjs — put the hand-authored browser bundle where the package ships it.
 *
 * `client/client.js` is written by hand in the DSH client-module format
 * (`window.__ModuleLoader__.load`), so it must NOT pass through tsc: it is not a
 * TypeScript module and it references a browser global. The build therefore
 * compiles `src/` to `lib/` and this step adds `lib/client.js` alongside.
 *
 * Run by the `build` script, so `npm run build` and the release both produce the
 * file the `dsh.client` declaration promises.
 */

const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(PLUGIN_ROOT, 'client', 'client.js');
const OUT = path.join(PLUGIN_ROOT, 'lib', 'client.js');

if (!fs.existsSync(SRC)) {
  console.error(`[client] ERROR: browser bundle missing at ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.copyFileSync(SRC, OUT);

const rel = (p) => path.relative(PLUGIN_ROOT, p).split(path.sep).join('/');
// stderr, not stdout: this runs from `prepack`, and npm's `pack --json` contract
// is that stdout carries the JSON blob and nothing else. A single console.log here
// made `npm pack --dry-run --json | jq ...` fail with "Invalid numeric literal"
// and took the whole publish job down. `prepack.cjs` already logs to stderr for
// the same reason; match it.
console.error(`[client] ${rel(SRC)} -> ${rel(OUT)}`);
