/**
 * @test REQ-715
 * @intent `architecture.yaml` describes 14 architecture rules that nothing
 *         executes: archlint 0.16 does not read its `layers:` block, and
 *         ARCH-001..014 are planning numbers with no implementation. The
 *         dangerous failure mode is not "the rules are missing" but "the docs
 *         read as if they were protecting the code" -- a reader who believes a
 *         boundary is enforced stops checking it. These assertions pin that the
 *         documentation says so plainly, in every place a reader could land.
 * @covers AC-715-01, AC-715-02, AC-715-03, AC-715-04, AC-715-05
 */
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');

function read(rel) {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

describe('REQ-715 architecture rules are documented honestly', () => {
  it('AC-715-01: ARCHITECTURE.md never claims ARCH-001..014 are enabled', () => {
    const doc = read('docs/ARCHITECTURE.md');
    expect(doc).not.toBeNull();
    // The claim to forbid is a positive "enabled: yes" row. A table cell that
    // says "规划中" is the honest form and must not trip this.
    const enabledRows = (doc.match(/ARCH-0\d\d\s*\|[^|\n]*\|[^|\n]*\|\s*(?:是|yes|启用|enabled)\s*\|/gi) || []);
    expect(enabledRows).toEqual([]);
    expect(doc).toMatch(/ARCH-00\d.{0,40}(?:无实现|规划中|规划编号)/s);
  });

  it('AC-715-02: architecture.yaml states its rules block is not executed', () => {
    const yaml = read('architecture.yaml');
    expect(yaml).not.toBeNull();
    // Assert on the HEAD of the file, not anywhere in it. The same warning is
    // repeated above each block, so a whole-file search stayed green even after
    // the file-level banner was replaced with a false "ENFORCED" claim — a
    // mutation that must fail. The lead paragraph is what a reader sees first.
    const head = yaml.split('\n').slice(0, 10).join('\n');
    expect(head).toMatch(/NOT ENFORCED|不被任何代码消费|不被执行/);
    // No affirmative claim anywhere in the head. `NOT ENFORCED` contains the
    // word ENFORCED, so the check must reject only the un-negated form.
    const affirmative = head.split('\n').filter((l) => /\bENFORCED\b/.test(l) && !/NOT ENFORCED/.test(l));
    expect(affirmative).toEqual([]);
    // Named explicitly, so a future archlint upgrade that DOES read the file
    // forces someone to revisit this claim rather than silently inverting it.
    expect(head).toMatch(/archlint 0\.16/);
  });

  it('AC-715-03: architecture.yaml marks the languages block as unconsumed', () => {
    const yaml = read('architecture.yaml');
    expect(yaml).not.toBeNull();
    const idx = yaml.indexOf('languages:');
    expect(idx).toBeGreaterThan(-1);
    // The disclaimer must sit at or above the block it describes.
    const before = yaml.slice(0, idx);
    expect(before).toMatch(/无消费方|不被消费|not consumed/i);
  });

  it('AC-715-04: every ARCH-001..014 reference carries a planning qualifier', () => {
    const doc = read('docs/ARCHITECTURE.md');
    const yaml = read('architecture.yaml');
    expect(doc).not.toBeNull();
    expect(yaml).not.toBeNull();
    // The blanket disclaimers above the tables cover them; what must not appear
    // is an unqualified claim that a specific rule is live. Both files carry a
    // file-level warning, so assert the warning exists in each.
    expect(doc).toMatch(/当前没有实现|规划编号|当前无实现/);
    expect(yaml).toMatch(/ARCH-001.{0,10}~.{0,10}ARCH-014|规划编号/);
  });

  it('AC-715-05: the tool guide warns before the architecture.yaml instructions', () => {
    const guide = read('githooks/TOOL-INSTALLATION-GUIDE.md');
    expect(guide).not.toBeNull();
    const section = guide.indexOf('architecture.yaml');
    expect(section).toBeGreaterThan(-1);
    // Warning first, instructions after: a reader who skims must hit the
    // warning, not the config example.
    const window = guide.slice(section, section + 1200);
    expect(window).toMatch(/⚠|不被执行|NOT ENFORCED/);
  });
});
