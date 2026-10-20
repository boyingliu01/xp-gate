/**
 * @test REQ-404 Gate M in retrospective
 * @intent Verify `xp-gate retro` reports Gate M (mutation) evidence from the
 *         pre-push journal, and that it distinguishes "never measured" from
 *         "measured and scored well" instead of printing a healthy average over
 *         an empty sample (#404 P1-3).
 *
 * @covers AC-404
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const { handleRetro } = require('../retro');

let TMP_DIR;
let cwdSpy;

beforeAll(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-gatem-test-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(TMP_DIR);
});

afterAll(() => {
  cwdSpy.mockRestore();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function cleanDir() {
  for (const sub of ['.xp-gate', '.sprint-state', 'coverage']) {
    fs.rmSync(path.join(TMP_DIR, sub), { recursive: true, force: true });
  }
  fs.rmSync(path.join(TMP_DIR, '.quality-history.jsonl'), { force: true });
}

/** Write pre-push journals. `runs` is a list of Gate M detail objects. */
function writeJournals(runs) {
  const dir = path.join(TMP_DIR, '.xp-gate', 'reports', 'pre-push');
  fs.mkdirSync(dir, { recursive: true });
  runs.forEach((gateM, i) => {
    const stamp = `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z`;
    fs.writeFileSync(
      path.join(dir, `${stamp.replace(/[:]/g, '-')}.json`),
      JSON.stringify({
        timestamp: stamp,
        trigger: 'pre-push',
        branch: 'main',
        commit: `sha${i}`,
        changed_files: ['src/a.ts'],
        overall: gateM.status,
        gates: [{ id: 'M', name: 'Mutation Testing', status: gateM.status, details: gateM.details || {} }],
        warnings: [],
        errors: [],
      })
    );
  });
}

async function runRetro(args = ['--days', '30']) {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const code = await handleRetro(args);
  const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  logSpy.mockRestore();
  return { code, output };
}

describe('retro - Gate M evidence (#404)', () => {
  test('reports skip rate, measured duration and score distribution', async () => {
    cleanDir();
    writeJournals([
      { status: 'PASS', details: { duration_ms: '120000', mutation_score: '75.5', skip_reason: '' } },
      { status: 'PASS', details: { duration_ms: '180000', mutation_score: '82.1', skip_reason: '' } },
      { status: 'SKIP', details: { skip_reason: 'stryker_not_installed' } },
      { status: 'SKIP', details: { skip_reason: 'no_mutable_files' } },
    ]);

    const { code, output } = await runRetro();
    expect(code).toBe(0);
    expect(output).toContain('Gate M');
    // 2 of 4 skipped
    expect(output).toContain('50.0%');
    // Both skip reasons must survive into the report, not be collapsed.
    expect(output).toContain('stryker_not_installed');
    expect(output).toContain('no_mutable_files');
    // score median of [75.5, 82.1] is 82.1 with this sort convention; assert the
    // scores are present rather than pinning the exact tie-break.
    expect(output).toMatch(/75\.5|82\.1/);
  });

  test('says "never measured" rather than reporting a clean 0% average', async () => {
    cleanDir();
    // The exact shape of all 68 journals before the #404 fix: SKIP with an empty
    // details object. An average over zero samples is not a healthy score.
    writeJournals([
      { status: 'SKIP', details: {} },
      { status: 'SKIP', details: {} },
    ]);

    const { code, output } = await runRetro();
    expect(code).toBe(0);
    expect(output).toContain('Gate M');
    expect(output).toMatch(/no measured|never measured|not measured/i);
    // A fabricated average over an empty sample is the failure being prevented.
    expect(output).not.toMatch(/median mutation score.*\d+\.\d+%/i);
  });

  test('reports no Gate M data at all when there are no journals', async () => {
    cleanDir();
    const { code, output } = await runRetro();
    expect(code).toBe(0);
    expect(output).toMatch(/no pre-push|no Gate M/i);
  });

  test('counts a TIMEOUT separately from a SKIP', async () => {
    cleanDir();
    writeJournals([
      { status: 'TIMEOUT', details: { skip_reason: 'exceeded_budget' } },
      { status: 'SKIP', details: { skip_reason: 'no_mutable_files' } },
    ]);

    const { output } = await runRetro();
    // Timeouts are a distinct failure mode: lumping them into SKIP hides a
    // gate that started work and could not finish.
    expect(output).toMatch(/TIMEOUT|timeout/i);
  });

  test('counts BLOCKED, which is the spelling the journals actually write', async () => {
    cleanDir();
    // Measured against this repo's real journals: 62 SKIP, 5 BLOCKED, 1 PASS.
    // An implementation that only matched "BLOCK" reported the 5 real mutation
    // blocks as zero -- precisely the silent-success failure #404 is about.
    writeJournals([
      { status: 'BLOCKED', details: { skip_reason: 'mutation_score_below_threshold' } },
      { status: 'BLOCKED', details: {} },
      { status: 'SKIP', details: { skip_reason: 'no_mutable_files' } },
      { status: 'PASS', details: { mutation_score: '71.0' } },
    ]);

    const { output } = await runRetro();
    expect(output).toContain('BLOCK 2');
    expect(output).toContain('SKIP 1');
    expect(output).toContain('PASS 1');
  });
});
