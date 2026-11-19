// Read the JSONL the matrix probe writes and judge every (gate, language) pair.
//
// The judgement is the point, not the table. Three questions per cell:
//
//   1. CLEAN, did the gate BLOCK?              -> false positive
//   2. DIRTY, did the gate whose subject is    -> the gate reported something
//      the planted defect PASS or SKIP?           it did not compute
//   3. Did the gate not run at all?            -> chain stopped, or the gate is
//                                                 not reachable in this shape
//
// (2) needs a mapping from defect to the gate that owns it. A type error belongs
// to Gate 1 (lint/type) or Gate 13 (compiler); a secret belongs to Gate 8; an
// unused duplicate belongs to Gate 2. Naming the owner per language is the only
// judgement this script makes on its own -- everything else is read from data.

const fs = require('fs');

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/analyze-gate-matrix.cjs <matrix.jsonl>');
  process.exit(2);
}

const rows = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byKey = new Map();
for (const r of rows) byKey.set(`${r.language}/${r.mode}`, r);

const langs = [...new Set(rows.map((r) => r.language))];
const GATES = ['0', '1', '2', '3', '8', '10', '7', '5', '6', '4', '9', '11', '12', '13'];

// Which gate is supposed to own the planted defect, per language. A planted type
// error is a compiler/lint matter; several languages can be caught by either.
// An empty list means "no gate is expected to catch this on this machine" --
// e.g. a Swift type error where swiftc is not installed. That is recorded as a
// coverage gap rather than a defect.
const DEFECT_OWNER = {
  go: ['1', '13'],
  typescript: ['1', '9'],
  python: ['1'],
  java: ['1', '13'],
  kotlin: ['1', '13'],
  dart: ['1', '13'],
  cpp: ['1', '13'],
  csharp: ['1', '13'],
  php: ['1'],
  shell: ['1'],
  powershell: ['1'],
  swift: ['13'],
  objectivec: ['1', '13'],
  iac: ['7'],
  flutter: ['1', '13'],
};

function verdictOf(run, gid) {
  if (!run) return 'NO_RUN';
  const g = run.gates.find((x) => x.gate === gid);
  return g ? g.verdict : 'ABSENT';
}

const lines = [];
const findings = [];

lines.push('| 语言 | 模式 | ' + GATES.map((g) => `G${g}`).join(' | ') + ' |');
lines.push('|---|---|' + GATES.map(() => '---').join('|') + '|');
for (const lang of langs) {
  for (const mode of ['clean', 'dirty']) {
    const run = byKey.get(`${lang}/${mode}`);
    const cells = GATES.map((g) => {
      const v = verdictOf(run, g);
      // Short cells keep the table readable; the legend below defines them.
      return { PASS: 'P', FAIL: 'F', BLOCK: 'B', SKIP: 'S', WARN: 'W', NOT_REACHED: 'N', ABSENT: '-', NO_REPORT: '?', NO_RUN: '?' }[v] || v;
    });
    lines.push(`| ${lang} | ${mode} | ${cells.join(' | ')} |`);
  }
}

lines.push('');
lines.push('图例: P=PASS F=FAIL B=BLOCK S=SKIP W=WARN N=NOT_REACHED -=absent ?=无报告');

// --- finding 1: a clean project blocked by a gate ----------------------------
//
// Two possible causes, and the analyzer must not pick one for the reader:
//
//   (a) the gate really is a false positive on clean code -- a product defect;
//   (b) the fixture has a second defect the probe did not intend -- a probe bug.
//
// Six of these turned out to be (b) while building the probe. So the finding
// carries the first diagnostic line from the captured run: a reader sees
// "ST1023 should omit type int" and knows instantly it is the fixture, and sees
// "cannot use X as Y" on a clean file and knows it is the gate.
function firstDiagnostic(logPath) {
  let text;
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    // Skip the report's own decoration and the gate banners.
    if (!t) continue;
    if (/^[━─=]/.test(t)) continue;
    if (/^(→|⚙|✅|❌|⚠️|ℹ️|⏭️|📊|Proceeding|Fix )/.test(t)) continue;
    if (/^Gate \d+ \(/.test(t)) continue;
    if (/(error|Error|cannot|unused|undefined|should omit|would be reformatted|mismatch|is not)/.test(t)) {
      return t.slice(0, 160);
    }
  }
  return null;
}

for (const lang of langs) {
  const run = byKey.get(`${lang}/clean`);
  if (!run) continue;
  const blocked = run.gates.filter((g) => g.verdict === 'FAIL' || g.verdict === 'BLOCK');
  if (blocked.length) {
    const diag = firstDiagnostic(`${process.env.MATRIX_LOG_DIR || ''}${lang}-clean.log`);
    findings.push({
      kind: '待判定（产品缺陷或 fixture 缺陷）',
      detail: `${lang} 干净项目被 G${blocked.map((b) => b.gate).join(',G')} 拦截`,
      evidence: blocked.map((b) => `G${b.gate} ${b.verdict}`).join('; ') +
        (diag ? ` — 诊断: ${diag}` : ''),
    });
  }
}

// --- finding 2: the planted defect was not caught by its owner ---------------
for (const lang of langs) {
  const dirty = byKey.get(`${lang}/dirty`);
  if (!dirty) continue;
  const owners = DEFECT_OWNER[lang] || [];
  if (!owners.length) continue;
  const seen = owners.filter((g) => {
    const v = verdictOf(dirty, g);
    return v === 'FAIL' || v === 'BLOCK';
  });
  const attempted = owners.filter((g) => {
    const v = verdictOf(dirty, g);
    return v !== 'ABSENT' && v !== 'NO_REPORT' && v !== 'NOT_REACHED';
  });
  if (attempted.length === 0) {
    findings.push({
      kind: '门禁不可达',
      detail: `${lang} 的负责门禁根本没有运行`,
      evidence: owners.map((g) => `G${g}=${verdictOf(dirty, g)}`).join(' '),
    });
  } else if (!seen.length) {
    findings.push({
      kind: '可能漏检',
      detail: `${lang} 的植入缺陷没有被 G${owners.join('/G')} 抓到`,
      evidence: owners.map((g) => `G${g}=${verdictOf(dirty, g)}`).join(' '),
    });
  }
}

// --- finding 3: a gate that never runs for any language ----------------------
//
// Gate 0 is deliberately excluded from the "unreachable" test. It runs -- every
// run prints "PASSED - Gate 0: Version Consistency Check" -- but it is a
// pre-flight guard, not a scored gate, so the run report has no entry for it and
// every cell reads ABSENT. Calling that "unreachable" would be the analyzer
// reporting something it did not compute, which is the exact defect class this
// whole exercise is about.
const PREFLIGHT_GATES = new Set(['0']);
const neverRan = GATES.filter((g) => PREFLIGHT_GATES.has(g) ? false : (
  langs.every((lang) =>
    ['clean', 'dirty'].every((mode) => {
      const v = verdictOf(byKey.get(`${lang}/${mode}`), g);
      return v === 'ABSENT' || v === 'NO_REPORT';
    })
  )
));
if (neverRan.length) {
  findings.push({
    kind: '不可达',
    detail: `这 ${neverRan.length} 个门禁在任何语言下都没有运行`,
    evidence: neverRan.map((g) => 'G' + g).join(' '),
  });
}

console.log(lines.join('\n'));
console.log('');
console.log('## 发现');
if (!findings.length) {
  console.log('');
  console.log('无。');
} else {
  console.log('');
  for (const f of findings) {
    console.log(`- **[${f.kind}]** ${f.detail} — \`${f.evidence}\``);
  }
}
