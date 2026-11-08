#!/usr/bin/env node
/**
 * Layer-baseline comparison for Gate 6's layer check.
 *
 * Reads findings on stdin (one per line, fields separated by real TABs) and a
 * JSON ledger as argv[2], and writes the findings that are NOT in the ledger.
 *
 * Exit 4 when the ledger exists but cannot be parsed. The caller treats that as
 * BLOCK (fail-closed): a ledger that silently reads as empty would turn every
 * accepted violation back into a new one, and the next natural response — re-run
 * with a bigger baseline — quietly launders the debt.
 *
 * Why this is a file and not an inline `node -e`: the first version embedded
 * this in bash single quotes, and the TAB separators ended up inside a JSON
 * string literal, which JSON.parse rejects (raw control character). The error
 * was then swallowed by `2>/dev/null`, so the ratchet silently reset on every
 * run. Three levels of quoting is where that hid; one level is enough.
 *
 * Ledger shape:
 *   { "accepted": [ { "file", "from", "to", "imports" }, ... ] }
 *
 * A plain tab-joined string is also accepted for entries, so hand-written and
 * generated ledgers both work.
 */

'use strict';

const fs = require('fs');

const SEVERITY_EXIT_UNREADABLE = 4;

/** Normalise one ledger entry to the tab-joined form used on stdin. */
function toKey(entry) {
  if (typeof entry === 'string') {
    return entry;
  }
  if (entry && typeof entry === 'object') {
    return [entry.file, entry.from, entry.to, entry.imports].join('\t');
  }
  return '';
}

/** Read and validate the ledger. Throws when it cannot be used. */
function readLedger(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  const accepted = Array.isArray(parsed.accepted) ? parsed.accepted : [];
  return new Set(accepted.map(toKey).filter(Boolean));
}

/** Split stdin into findings and drop the baselined ones. */
function filterFindings(raw, known) {
  return raw
    .split('\n')
    .filter(Boolean)
    .filter(line => !known.has(line));
}

function main() {
  const ledgerPath = process.argv[2];
  if (!ledgerPath) {
    process.stderr.write('usage: layer-baseline.cjs <ledger.json> < findings\n');
    process.exit(SEVERITY_EXIT_UNREADABLE);
    return;
  }

  let known;
  try {
    known = readLedger(ledgerPath);
  } catch (err) {
    process.stderr.write(`layer-baseline unreadable: ${err.message}\n`);
    process.exit(SEVERITY_EXIT_UNREADABLE);
    return;
  }

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    process.stdout.write(filterFindings(raw, known).join('\n'));
  });
}

main();

module.exports = { toKey, readLedger, filterFindings };
