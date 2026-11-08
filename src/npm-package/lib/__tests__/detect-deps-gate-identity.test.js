/**
 * @test REQ-gate-identity GATE_CLI_TOOLS 的门禁编号必须与 gate-registry.sh 一致
 * @intent `xp-gate doctor` 用 GATE_CLI_TOOLS 里的 gates[] 告诉用户"这个工具服务哪道门禁"。
 *   编号漂移会直接把用户指到错的门禁上——#717 曾经因为同样的漂移，把 C# SAST 的修复
 *   写进了 gate-9.sh（那是 Build Integrity，不是 SAST），修了却从未被执行。
 *   权威来源是 githooks/gate-registry.sh，本测试从它读行并逐条对照，而不是硬编码期望值：
 *   硬编码只能证明"今天两边都写 10"，读 registry 才能证明"两边不会各自漂走"。
 * @covers AC-GATE-IDENTITY-01, AC-GATE-IDENTITY-02
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REGISTRY = path.join(REPO_ROOT, 'githooks', 'gate-registry.sh');

/** Gate 9 is Build Integrity; Gate 10 is SAST. Named so the assertion reads as a claim, not a literal. */
const BUILD_INTEGRITY_GATE = 9;

/**
 * Read gate-registry.sh, naming the registry in any failure.
 *
 * A missing or unreadable registry means the FIXTURE broke, not the code under
 * test. Left unguarded it would surface as a raw ENOENT from inside a parser and
 * read like "detect-deps is wrong" — the misleading diagnosis this whole file
 * exists to prevent. Resolution is relative to the repo, so a moved file fails
 * with a path instead of a stack trace.
 *
 * @returns {string} registry file contents
 */
function readRegistryOrFail() {
  try {
    return fs.readFileSync(REGISTRY, 'utf8');
  } catch (err) {
    throw new Error(`fixture: cannot read gate registry at ${REGISTRY}: ${err.message}`);
  }
}

/**
 * Parse the `"name|N|file|sourced"` rows out of gate-registry.sh.
 *
 * @returns {Map<string, number>} gate name -> gate number
 */
function readRegistryGateNumbers() {
  const text = readRegistryOrFail();
  const numbers = new Map();
  const row = /^\s*"([a-z-]+)\|(\d+)\|/gm;
  let m;
  while ((m = row.exec(text)) !== null) numbers.set(m[1], Number(m[2]));
  return numbers;
}

/** The human title registry maps to each name, so a tool's label can be matched without guessing. */
function readGateTitles() {
  const text = readRegistryOrFail();
  const titles = new Map();
  const row = /^\s*([a-z-]+)\)\s+echo "([^"]+)"/gm;
  let m;
  while ((m = row.exec(text)) !== null) titles.set(m[1], m[2]);
  return titles;
}

/** Every `gates: ['Gate <n> (<label>)', ...]` entry, flattened to {tool, gateNumber, label}. */
function readToolGateRefs() {
  const { GATE_CLI_TOOLS } = require('../detect-deps');
  const refs = [];
  for (const entry of GATE_CLI_TOOLS) {
    for (const label of entry.gates || []) {
      const m = /^Gate\s+(\d+)\s+\(([^)]+)\)/.exec(label);
      if (m) refs.push({ tool: entry.tool, gateNumber: Number(m[1]), label: m[2] });
    }
  }
  return refs;
}

describe('GATE_CLI_TOOLS gate identity — AC-GATE-IDENTITY-01', () => {
  it('registry itself parses (guards the fixture, not the code under test)', () => {
    const numbers = readRegistryGateNumbers();
    expect(numbers.size).toBeGreaterThanOrEqual(10);
    expect(numbers.get('sast')).toBe(10);
    expect(numbers.get('build-integrity')).toBe(BUILD_INTEGRITY_GATE);
  });

  it('semgrep is attributed to the SAST gate, not Build Integrity', () => {
    const refs = readToolGateRefs().filter((r) => r.tool === 'semgrep');
    expect(refs.length).toBeGreaterThan(0);

    const sastNumber = readRegistryGateNumbers().get('sast');
    for (const ref of refs) expect(ref.gateNumber).toBe(sastNumber);
  });
});

describe('GATE_CLI_TOOLS gate identity — AC-GATE-IDENTITY-02', () => {
  it('no tool label names a gate the number does not resolve to', () => {
    const numbers = readRegistryGateNumbers();
    const titles = readGateTitles();

    // A label is a hand-written gloss, not the canonical title, so equality would be
    // too strict and would fire on legitimate synonyms (Gate 4's label says
    // "Principles via npx tsx" while its title is "Clean Code + SOLID"). What must
    // never happen is a label naming a DIFFERENT gate than the number resolves to —
    // "SAST" filed under the number that means Build Integrity.
    //
    // Detection: every word in a label must be accounted for — it appears in the
    // registry title, or it is a mechanism word. A label saying SAST while the title
    // says Build Integrity leaves "sast" unexplained and fails. The whitelist holds
    // mechanism words, not gate names, so a new gate needs no edit here to be covered.
    const MECHANISM_WORDS = new Set(['via', 'npx', 'tsx', 'docker', 'and', 'the']);

    const mismatches = [];
    for (const ref of readToolGateRefs()) {
      const name = [...numbers.entries()].find(([, n]) => n === ref.gateNumber)?.[0];
      if (!name) continue;
      // Compare against BOTH the registry key and its human title. The key is the
      // canonical slug ("principles", "sast"), the title is prose ("Clean Code +
      // SOLID", "SAST Security"); a label may legitimately use either. Matching
      // only one of them makes the test fire on naming style instead of on the
      // defect it exists to catch.
      const known = `${name} ${String(titles.get(name) || '')}`.toLowerCase();
      if (!known.trim()) continue;

      const unexplained = ref.label
        .toLowerCase()
        .split(/[\s/()—]+/)
        .filter(Boolean)
        .filter((word) => !MECHANISM_WORDS.has(word))
        .filter((word) => !known.includes(word));

      if (unexplained.length > 0) {
        mismatches.push({ tool: ref.tool, gateNumber: ref.gateNumber, registryTitle: titles.get(name), unexplained });
      }
    }

    expect(mismatches).toEqual([]);
  });
});
