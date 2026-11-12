#!/usr/bin/env node
/**
 * Compare two hook behaviour fingerprints recorded by
 * scripts/record-hook-behaviour.cjs.
 *
 * Exit 0 only when every scenario matches on BOTH exit status and normalised
 * output. Any difference is printed with a short diff so the reviewer can see
 * which gate changed behaviour, not merely that something did.
 *
 * Usage: node scripts/compare-hook-behaviour.cjs <before.json> <after.json>
 */
const fs = require('fs');

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('usage: node scripts/compare-hook-behaviour.cjs <before.json> <after.json>');
  process.exit(2);
}
const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));

const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
let mismatch = 0;

for (const name of names) {
  const ra = a[name];
  const rb = b[name];
  if (!ra) {
    console.log('NEW      ' + name + ' (absent before)');
    mismatch++;
    continue;
  }
  if (!rb) {
    console.log('MISSING  ' + name + ' (absent after)');
    mismatch++;
    continue;
  }
  const statusSame = ra.status === rb.status;
  const outSame = ra.out === rb.out;
  if (statusSame && outSame) {
    console.log('OK       ' + name + ' (exit ' + ra.status + ')');
    continue;
  }
  mismatch++;
  console.log('DIFF     ' + name);
  if (!statusSame) console.log('    exit: ' + ra.status + ' -> ' + rb.status);
  if (!outSame) {
    const la = ra.out.split('\n');
    const lb = rb.out.split('\n');
    const max = Math.max(la.length, lb.length);
    let shown = 0;
    for (let i = 0; i < max && shown < 12; i++) {
      if (la[i] !== lb[i]) {
        console.log('    line ' + (i + 1));
        console.log('      before: ' + JSON.stringify((la[i] || '').slice(0, 110)));
        console.log('      after : ' + JSON.stringify((lb[i] || '').slice(0, 110)));
        shown++;
      }
    }
    if (shown === 0) {
      console.log('    output differs only in length: ' + ra.out.length + ' -> ' + rb.out.length);
    }
  }
}

console.log('');
console.log(mismatch === 0 ? 'BEHAVIOUR IDENTICAL across ' + names.length + ' scenarios' : 'BEHAVIOUR CHANGED in ' + mismatch + ' of ' + names.length + ' scenarios');
process.exit(mismatch === 0 ? 0 : 1);
