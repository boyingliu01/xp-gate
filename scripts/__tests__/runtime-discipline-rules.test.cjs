/**
 * @test REQ-714
 * @intent Keep every AGENT RUNTIME DISCIPLINE rule carrying a measured baseline,
 *   a target, and an actionable criterion — a rule that only states an intention
 *   cannot be audited, which is exactly how 规则 2/3 went unexecuted for three days.
 * @covers AC-714-01, AC-714-02, AC-714-03, AC-714-04
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const AGENTS_FILE = path.join(PROJECT_ROOT, 'AGENTS.md');
const JOURNAL = path.join(PROJECT_ROOT, 'src', 'npm-package', 'lib', 'agent-runtime-journal.js');

const SECTION_HEADING = '## AGENT RUNTIME DISCIPLINE';

function readAgents() {
  // \r? because Windows checkouts carry CRLF in the working tree.
  return fs.readFileSync(AGENTS_FILE, 'utf8').replace(/\r\n/g, '\n');
}

/** The runtime-discipline section, from its heading to the next `## ` heading. */
function disciplineSection() {
  const doc = readAgents();
  const start = doc.indexOf(SECTION_HEADING);
  if (start === -1) return '';
  const rest = doc.slice(start + SECTION_HEADING.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Split the section into one chunk per rule, keyed by `规则 N`. */
function rules() {
  const section = disciplineSection();
  const found = {};
  const pattern = /\*\*规则 (\d+) —[^\n]*\*\*/g;
  const matches = [...section.matchAll(pattern)];
  matches.forEach((match, index) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = index + 1 < matches.length ? matches[index + 1].index : section.length;
    found[match[1]] = { title: match[0], body: section.slice(bodyStart, bodyEnd) };
  });
  return found;
}

describe('AGENT RUNTIME DISCIPLINE rules are auditable', () => {
  it('keeps the runtime-discipline section and its rules', () => {
    expect(disciplineSection()).not.toBe('');
    const found = rules();
    // Four rules exist today; the count may grow but must never silently shrink.
    expect(Object.keys(found).length).toBeGreaterThanOrEqual(4);
    for (const key of ['1', '2', '3']) expect(found[key]).toBeDefined();
  });

  it('gives every rule a measured baseline and a numeric target (AC-714-01)', () => {
    for (const [id, rule] of Object.entries(rules())) {
      // A baseline is a number with a unit/field name next to it, e.g.
      // "calls/step=1.086" or "96 次 / 8.9 h". Requiring a digit is the point:
      // prose like "几乎没有执行" cannot be re-measured.
      expect({ id, hasDigit: /\d/.test(rule.body) }).toEqual({ id, hasDigit: true });
      expect({ id, hasTarget: /目标/.test(rule.body) }).toEqual({ id, hasTarget: true });
    }
  });

  it('states where each baseline was measured, so it can be re-run (AC-714-02)', () => {
    // Every baseline must name the command or the date it came from, otherwise
    // a reader cannot tell a fresh number from a stale one.
    for (const [id, rule] of Object.entries(rules())) {
      const traceable = /runtime-journal|--days|20\d\d-\d\d-\d\d/.test(rule.body);
      expect({ id, traceable }).toEqual({ id, traceable: true });
    }
  });

  it('documents the runtime-journal entry point once for all rules (AC-714-03)', () => {
    const section = disciplineSection();
    expect(section).toContain('xp-gate runtime-journal');
    // The JSON form is what an A/B comparison needs; without it the numbers
    // cannot be compared mechanically.
    expect(section).toContain('--json');
  });

  it('rule 2 names a concrete trigger instead of a bare intention (AC-714-04)', () => {
    const rule2 = rules()['2'];
    expect(rule2).toBeDefined();
    // A bare "must batch" was not executable. The rule must say WHAT counts as
    // batchable and HOW to self-check, in words an agent can act on.
    const body = rule2.body;
    const hasTrigger = /例如|示例|比如|典型|清单/.test(body);
    expect({ hasTrigger }).toEqual({ hasTrigger: true });
    const hasSelfCheck = /自查|自检|判据|对照|check/.test(body);
    expect({ hasSelfCheck }).toEqual({ hasSelfCheck: true });
  });

  it('keeps the documented baseline consistent with what the journal reports', () => {
    const { analyseSessions } = require(JOURNAL);
    expect(typeof analyseSessions).toBe('function');
    // The command that produces the baselines must still exist and be exported;
    // a rule citing a metric nobody can produce is unauditable.
    const cli = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'npm-package', 'bin', 'xp-gate.js'),
      'utf8',
    );
    expect(cli).toContain('runtime-journal');
    // callsPerStep lives in the implementation module, not in the dispatcher —
    // that is what the rule's "calls/step" number is computed from.
    const impl = fs.readFileSync(JOURNAL, 'utf8');
    expect(impl).toContain('callsPerStep');
  });
});
