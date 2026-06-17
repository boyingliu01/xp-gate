'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Resolves repo root for the installed xp-gate npm package, or the development
// checkout when running from source. Walks up looking for either:
//   - src/principles/index.ts (this repo / dev mode)
//   - ../../src/principles/index.ts (installed under node_modules/@boyingliu01/xp-gate)
function findPrinciplesEntry() {
  const candidates = [
    // npm package bundled layout: lib/principles.js → principles/index.ts
    path.resolve(__dirname, '..', 'principles', 'index.ts'),
    // Development layout: lib/principles.js → src/principles/index.ts
    path.resolve(__dirname, '..', '..', '..', 'src', 'principles', 'index.ts'),
    // npm package installed under node_modules/@boyingliu01/xp-gate
    path.resolve(__dirname, '..', '..', 'src', 'principles', 'index.ts'),
    // Running from repo root
    path.resolve(process.cwd(), 'src', 'principles', 'index.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function principles(args) {
  const target = args[0];
  if (!target) {
    console.error('Usage: xp-gate principles <file_or_directory> [--format console|json|sarif]');
    return Promise.resolve(1);
  }

  const formatIdx = args.indexOf('--format');
  const format = formatIdx >= 0 ? args[formatIdx + 1] : 'console';

  const entry = findPrinciplesEntry();
  if (!entry) {
    console.error('[xp-gate principles] ERROR: cannot locate src/principles/index.ts');
    console.error('  Run from inside the xp-gate repo, or install via npm install -g @boyingliu01/xp-gate');
    return Promise.resolve(1);
  }

  const result = spawnSync('npx', ['-y', 'tsx', entry, '--files', target, '--format', format], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  return Promise.resolve(result.status === null ? 1 : result.status);
}

module.exports = { principles };
