/**
 * @test REQ-ADR-0003
 * @intent `docs/ARCHITECTURE.md` states the gate count four different ways --
 *         "6 道" in its opening line, "12 道 (Gate 0-11)" three times later, and
 *         "11 Phase Flow" while Sprint Flow has 6 phases. Measured 2026-11-19,
 *         the authoritative `XP_GATE_ORDER` holds 16 entries.
 *
 *         Nothing checked those numbers, so they decayed exactly as ADR-0003
 *         describes: a declaration nothing executes. This suite derives the true
 *         values from the code and compares them against the prose, so a gate
 *         added or removed now breaks the document instead of quietly making it
 *         wrong.
 *
 *         The rule being enforced is AGENTS.md's own: "if a command can answer
 *         it, this file does not state it". Where the prose must name a count --
 *         it is a reader's first orientation -- the count is checked here rather
 *         than trusted.
 * @covers AC-ADR-0003-04, AC-ADR-0003-05
 */
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');

function read(rel) {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** The gate list the hook actually runs, not a number someone typed. */
function authoritativeGateOrder() {
  const driver = read('githooks/gate-driver.sh');
  if (!driver) throw new Error('githooks/gate-driver.sh missing');
  const m = driver.match(/XP_GATE_ORDER="([^"]*)"/);
  if (!m) throw new Error('XP_GATE_ORDER not found in gate-driver.sh');
  return m[1].trim().split(/\s+/).filter(Boolean);
}

/** The sprint pipeline's phases, from the skill that defines them. */
function authoritativePhases() {
  const skill = read('skills/sprint-flow/SKILL.md');
  if (!skill) throw new Error('skills/sprint-flow/SKILL.md missing');
  const m = skill.match(/(\d+)-phase end-to-end feature development pipeline/);
  if (!m) throw new Error('phase count not stated in sprint-flow/SKILL.md');
  return Number(m[1]);
}

/**
 * Lines inside an explicit `<!-- historic: ... -->` region describe a past state
 * and are exempt from the present-tense checks. The marker is deliberately
 * explicit rather than inferred from words like "原始" or "曾经": a keyword rule
 * skips the WHOLE line, so a sentence mixing a historical note with a current
 * claim ("原始设计有 9 道，当前 12 道") would escape validation entirely -- which is
 * the bypass class this suite exists to catch.
 *
 * @param {string} text
 * @returns {Set<number>} 0-based line indexes that are exempt
 */
function historicLineIndexes(text) {
  const exempt = new Set();
  let inside = false;
  text.split('\n').forEach((line, i) => {
    // The marker may carry an explanatory comment after the token, so match the
    // token rather than requiring an immediate `-->`.
    if (/<!--\s*historic:start\b/i.test(line)) { inside = true; exempt.add(i); return; }
    if (/<!--\s*historic:end\b/i.test(line)) { inside = false; exempt.add(i); return; }
    if (inside) exempt.add(i);
  });
  return exempt;
}

describe('ARCHITECTURE.md cannot contradict the code it describes', () => {
  it('AC-ADR-0003-04: the opening line does not name a gate count that disagrees', () => {
    const doc = read('docs/ARCHITECTURE.md');
    expect(doc).not.toBeNull();
    // The opening line is what every reader meets first. It used to say
    // "6 道质量门禁" while the rest of the same file said 12.
    const firstLine = doc.split('\n').slice(0, 5).join('\n');
    const claimed = [...firstLine.matchAll(/(\d+)\s*道(?:质量)?门禁/g)].map((m) => Number(m[1]));
    // Either no count at all (preferred -- the file should point at
    // `xp-gate gate-capability`), or one that matches the real list length.
    const actual = authoritativeGateOrder().length;
    const wrong = claimed.filter((n) => n !== actual);
    expect(wrong).toEqual([]);
  });

  it('AC-ADR-0003-05: no "N 道门禁" claim in the file contradicts XP_GATE_ORDER', () => {
    const doc = read('docs/ARCHITECTURE.md');
    const actual = authoritativeGateOrder().length;
    // Every numeric gate-count claim must agree with the order list, except inside
    // an explicit historic region (see historicLineIndexes for why the exemption
    // is marker-based rather than keyword-based).
    const exempt = historicLineIndexes(doc);
    const offenders = [];
    doc.split('\n').forEach((line, i) => {
      if (exempt.has(i)) return;
      for (const m of line.matchAll(/(\d+)\s*道(?:编号)?门禁/g)) {
        if (Number(m[1]) !== actual) offenders.push(`line ${i + 1}: ${m[0]}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it('AC-ADR-0003-06: the phase count matches sprint-flow, not a remembered number', () => {
    const doc = read('docs/ARCHITECTURE.md');
    const actual = authoritativePhases();
    expect(actual).toBeGreaterThan(0);
    // "<N> Phase(s)" optionally followed by "Flow" -- not "<N> Phase Check", which
    // names a different thing.
    const exempt = historicLineIndexes(doc);
    const offenders = [];
    doc.split('\n').forEach((line, i) => {
      if (exempt.has(i)) return;
      for (const m of line.matchAll(/(\d+)\s*Phases?(?:\s+Flow)?(?!\s*Check)/g)) {
        if (Number(m[1]) !== actual) offenders.push(`line ${i + 1}: ${m[0]}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it('AC-ADR-0003-10: documented rule thresholds match the code that applies them', () => {
    const doc = read('docs/ARCHITECTURE.md');
    expect(doc).not.toBeNull();
    // A threshold is worse than a count to get wrong: a reader plans around it.
    // Measured 2026-11-20, two were stale by a wide margin --
    //   large-file   documented 300  -> code says 1150
    //   too-many-params documented 4 -> code says 7
    //
    // Every documented threshold is compared against the rule's own `threshold:`
    // field. Crucially, a rule this test cannot resolve is a FAILURE, not a skip:
    // a guard that passes when it cannot find its source is worse than no guard,
    // because it reports success it did not earn -- the exact defect this suite
    // exists to catch.
    const rules = [
      ['clean-code.long-function', 'src/npm-package/principles/rules/clean-code/long-function.ts'],
      ['clean-code.large-file', 'src/npm-package/principles/rules/clean-code/large-file.ts'],
      ['clean-code.god-class', 'src/npm-package/principles/rules/clean-code/god-class.ts'],
      ['clean-code.deep-nesting', 'src/npm-package/principles/rules/clean-code/deep-nesting.ts'],
      ['clean-code.too-many-params', 'src/npm-package/principles/rules/clean-code/too-many-params.ts'],
    ];

    const docLines = doc.split('\n');
    const offenders = [];
    for (const [ruleId, rel] of rules) {
      const src = read(rel);
      if (!src) {
        // That may be a legitimate deletion, but this test cannot verify the
        // documentation against a file it cannot see, so it must not pass.
        offenders.push(`${ruleId}: source ${rel} missing -- documentation NOT verified`);
        continue;
      }
      const m = src.match(/threshold:\s*(\d+)/);
      if (!m) {
        offenders.push(`${ruleId}: no \`threshold:\` field in ${rel} -- documentation NOT verified`);
        continue;
      }
      const real = Number(m[1]);

      const row = docLines.find((l) => l.includes('`' + ruleId + '`'));
      if (!row) {
        offenders.push(`${ruleId}: not documented in docs/ARCHITECTURE.md -- cannot verify`);
        continue;
      }
      const cells = row.split('|').map((c) => c.trim());
      const thresholdCell = cells[cells.length - 2] ?? '';
      const claimed = thresholdCell.match(/(\d+)\s*(?:行|个|层)?/);
      if (!claimed) {
        // A non-numeric descriptor ("—", "白名单: …") means the row makes no
        // numeric claim, so there is nothing to contradict. This is the ONLY
        // legitimate skip in this file, and it is stated explicitly so that
        // "no claim" cannot be confused with "could not check".
        continue;
      }
      if (Number(claimed[1]) !== real) {
        offenders.push(`${ruleId}: doc says ${claimed[1]}, code says ${real}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
