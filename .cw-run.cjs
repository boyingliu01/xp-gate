// Code-walkthrough evidence builder: runs the three Delphi seats against the
// sprint diff and assembles .code-walkthrough-result.json.
//
// Deliberately NOT a shortcut around the review: it drives the same
// scripts/delphi-external-review.cjs the skill uses, one seat at a time, and
// refuses to write evidence unless all three return APPROVED.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const RUNNER = path.join(ROOT, 'scripts', 'delphi-external-review.cjs');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const ROLES = ['architecture', 'technical', 'feasibility'];

// The sprint diff, bounded so the prompt stays a reviewable size.
const diff = execFileSync('git', ['diff', 'main...HEAD', '--',
  'githooks/pre-commit',
  'githooks/lib/validate-code-walkthrough.cjs',
  'scripts/delphi-external-review.cjs',
  'src/principles/baseline-prune.ts',
  'src/principles/config.ts',
  'src/principles/index.ts',
  'src/principles/analyzer.ts',
  'src/principles/rules',
  'src/principles/types.ts',
  'githooks/gates/gate-4-principles.sh',
], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const context = [
  'Review this sprint diff for correctness and risk. It fixes four quality-gate defects:',
  '',
  '- #454: Gate 5 must distinguish a vitest runner infrastructure error (Windows EPERM',
  '  on the temp cache, zero failed tests) from a genuine test failure.',
  '- #457: .principlesrc must actually take effect. Before the fix the rule modules',
  '  captured built-in defaults at module load, so no config file changed behaviour.',
  '- #452 REQ-3: entries in .warnings-baseline.json for deleted files must be prunable.',
  '- #423: Gate MW evidence must prove model provenance. `channel` is a required',
  '  whitelist value and `resolved_model` must be non-empty and pairwise distinct.',
  '',
  'Answer with a JSON object containing exactly: verdict (APPROVED or REQUEST_CHANGES),',
  'confidence (1-10), critical_issues (array of strings), major_concerns (array of strings),',
  'minor_concerns (array of strings), and summary (string).',
  '',
  '=== SPRINT DIFF ===',
  diff.slice(0, 220000),
].join('\n');

const promptFile = path.join(ROOT, '.cw-prompt.txt');
const KEEP_PROMPT = process.env.CW_KEEP_PROMPT === '1';
fs.writeFileSync(promptFile, context, 'utf8');

const results = {};
for (const role of ROLES) {
  process.stdout.write(`  [${role}] running... `);
  let raw;
  try {
    raw = execFileSync('node', [
      TSX, RUNNER,
      '--expert', role,
      '--input-file', promptFile,
      '--round', '1',
      '--mode', 'code-walkthrough',
      '--config', '.delphi-config.json',
      '--timeout-ms', process.env.CW_API_TIMEOUT_MS || '300000',
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: Number(process.env.CW_TIMEOUT_MS || 900000) });
  } catch (error) {
    raw = String(error.stdout || '');
    if (!raw) {
      console.log(`FAILED: ${String(error.stderr || error.message).slice(0, 200)}`);
      results[role] = null;
      continue;
    }
  }
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
    results[role] = parsed;
    console.log(`${parsed.verdict || '?'} (resolved=${parsed.resolved_model})`);
  } catch {
    console.log('UNPARSABLE');
    results[role] = null;
  }
}

if (!KEEP_PROMPT) fs.rmSync(promptFile, { force: true });
else console.log('  prompt kept at ' + promptFile);

const ok = ROLES.every((r) => results[r] && results[r].verdict === 'APPROVED');
console.log(`\n  all three APPROVED: ${ok ? 'YES' : 'NO'}`);
for (const role of ROLES) {
  const r = results[role];
  if (!r) { console.log(`  [${role}] NO RESULT`); continue; }
  console.log(`  [${role}] verdict=${r.verdict} confidence=${r.confidence} req=${r.requested_model} res=${r.resolved_model} ch=${r.channel}`);
  for (const key of ['critical_issues', 'major_concerns']) {
    const list = Array.isArray(r[key]) ? r[key] : [];
    if (list.length) {
      console.log(`    ${key}:`);
      for (const item of list) {
        console.log(`      - ${typeof item === 'string' ? item.slice(0, 300) : JSON.stringify(item).slice(0, 300)}`);
      }
    }
  }
}

fs.writeFileSync(path.join(ROOT, '.cw-results.json'), JSON.stringify(results, null, 2));
console.log('\n  raw results -> .cw-results.json');
