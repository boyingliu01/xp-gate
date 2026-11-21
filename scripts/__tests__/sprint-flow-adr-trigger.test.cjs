/**
 * @test REQ-ADR-0003
 * @intent Measured 2026-11-20: `docs/adr/` holds 3 records and the repository has
 *         existed for far longer than 3 decisions. The mechanism exists
 *         (`grill-with-docs` -> `domain-modeling` writes ADRs) but nothing makes
 *         Phase 2 DESIGN produce one, so in practice it produces none -- the same
 *         shape ADR-0003 describes: a declaration with nothing executing it.
 *
 *         Two separate defects are pinned here:
 *
 *         1. **No trigger.** `phase-2-design.md` listed "ADR 文件" under 输出 (an
 *            output list) rather than under a completion condition, so a sprint
 *            could close Phase 2 having written no ADR and nothing objected.
 *         2. **Wrong filename convention.** The same file said
 *            `docs/adr/ADR-NNNN-*.md` while the authoritative
 *            `skills/domain-modeling/ADR-FORMAT.md` says
 *            `docs/adr/{NNNN}-{kebab-case-title}.md`, which is what the three
 *            existing records actually use. An instruction that names a path no
 *            existing file matches sends every future ADR to the wrong place.
 *
 *         Fixing (1) without (2) would produce a mandatory ADR at the wrong path,
 *         which is why both are asserted.
 * @covers AC-ADR-0003-07, AC-ADR-0003-08, AC-ADR-0003-09
 */
const { readFileSync, existsSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');
const PHASE2 = 'skills/sprint-flow/references/phase-2-design.md';
const ADR_FORMAT = 'skills/domain-modeling/ADR-FORMAT.md';
const ADR_DIR = 'docs/adr';

function read(rel) {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

describe('Phase 2 DESIGN treats an ADR as a deliverable, not a suggestion', () => {
  it('AC-ADR-0003-07: the ADR gate is a required artifact, not a judgement call', () => {
    const doc = read(PHASE2);
    expect(doc).not.toBeNull();

    // Round-2 review finding: five prose "signals" are a judgement with no
    // product, and an executor will drift toward answering "not architectural".
    // The gate must therefore require a FILE whose existence is checkable.
    expect(doc).toMatch(/\.sprint-state\/phase-outputs\/phase-2-adr\.json/);

    // And that file must have a closed set of decisions with a mandatory reason --
    // a schema a script can evaluate, not a sentence a reader must interpret.
    expect(doc).toMatch(/"decision"\s*:\s*"recorded"/);
    expect(doc).toMatch(/"decision"\s*:\s*"not_needed"/);
    expect(doc).toMatch(/"reason"\s*:/);

    // The gate must state that a missing artifact blocks, so "no file" cannot be
    // read as "nothing to record".
    const gate = doc.slice(doc.indexOf('门禁行为'));
    expect(gate).toMatch(/BLOCK/);
  });

  it('AC-ADR-0003-11: the documented artifact schema is the one the gate can evaluate', () => {
    const doc = read(PHASE2);
    expect(doc).not.toBeNull();

    // Every JSON example in Step 4b must parse. A schema shown as a code block is
    // an instruction; if it is invalid JSON, every sprint that copies it produces
    // a file the gate must reject -- and the doc would be the cause.
    const step4bStart = doc.indexOf('Step 4b');
    const step4b = doc.slice(step4bStart, doc.indexOf('### 暂停点', step4bStart));
    const blocks = [...step4b.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);

    // The gate is only real if it has examples to follow -- zero examples would
    // mean this test asserts nothing, so require both decisions be demonstrated.
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const parsed = blocks.map((b) => JSON.parse(b)); // throws on malformed JSON
    const decisions = parsed.map((p) => p.decision);
    expect(decisions).toContain('recorded');
    expect(decisions).toContain('not_needed');

    for (const ex of parsed) {
      expect(typeof ex.reason).toBe('string');
      expect(ex.reason.length).toBeGreaterThanOrEqual(20);
      if (ex.decision === 'recorded') {
        expect(ex.adr).toMatch(/^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/);
      }
    }
  });

  it('AC-ADR-0003-08: the ADR filename instruction matches the authoritative format', () => {
    const doc = read(PHASE2);
    const format = read(ADR_FORMAT);
    expect(doc).not.toBeNull();
    expect(format).not.toBeNull();

    // The authority states {NNNN}-{kebab-case-title}.md. The design reference must
    // not contradict it -- an "ADR-NNNN-" prefix matches none of the real files.
    expect(format).toMatch(/\{NNNN\}-\{kebab-case-title\}\.md/);
    const bogus = [...doc.matchAll(/docs\/adr\/ADR-NNNN[^\s`)]*/g)].map((m) => m[0]);
    expect(bogus).toEqual([]);
  });

  it('AC-ADR-0003-09: every path the design reference points at actually exists or matches the archive', () => {
    const doc = read(PHASE2);
    const dir = resolve(ROOT, ADR_DIR);
    expect(doc).not.toBeNull();
    expect(existsSync(dir)).toBe(true);

    // Whatever directory the doc sends an ADR to must be the one that is really
    // used, so "where did we put the decisions" has exactly one answer.
    const dirs = [...new Set([...doc.matchAll(/docs\/adr/gi)].map(() => 'docs/adr'))];
    expect(dirs.length).toBeLessThanOrEqual(1);
    expect(dirs[0]).toBe(ADR_DIR);

    // And the existing records must follow the stated shape, so the instruction is
    // demonstrably followable rather than aspirational.
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'AGENTS.md');
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f).toMatch(/^\d{4}-[a-z0-9-]+\.md$/);
    }
  });
});
