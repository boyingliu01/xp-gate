/**
 * TDD: written RED first (Phase G per design §12)
 * @test REQ-RETRO-001 Sprint engineering retrospective CLI
 * @intent Validate xp-gate retro generates Markdown report with rework trend + skip exposure sections
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const { handleRetro } = require('../retro');

let TMP_DIR;
let cwdSpy;

beforeAll(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-test-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(TMP_DIR);
});

afterAll(() => {
  cwdSpy.mockRestore();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function writeAudit(entries) {
  const dir = path.join(TMP_DIR, '.xp-gate');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'audit.jsonl'),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  );
}

function writeHistory(entry) {
  const dir = path.join(TMP_DIR, '.sprint-state', 'sprint-history');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
}

function cleanDir() {
  for (const sub of ['.xp-gate', '.sprint-state', '.quality-history.jsonl']) {
    fs.rmSync(path.join(TMP_DIR, sub), { recursive: true, force: true });
  }
}

describe('retro: report generation', () => {
  // TDD: written RED first (G phase per design §12)
  test('(a) empty data sources → skeleton report with "No data" sections', async () => {
    cleanDir();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleRetro(['--days', '7']);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('# Sprint Engineering Retrospective');
    expect(output).toContain('## Activity Summary');
    expect(output).toContain('## Rework Rate Trend (#369)');
    expect(output).toContain('## Evidence Skip Exposure');
    expect(output).toContain('## Quality Trend');
    expect(output).toContain('No data');
  });

  // TDD: written RED first (G phase per design §12)
  test('(b) rework rate > 30% → alert line present with sprint id', async () => {
    cleanDir();
    writeHistory({
      id: 'sprint-high-rework',
      task_description: 'High rework sprint',
      metrics: {
        completed_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        total_sprint_commits: 10,
        rework_rate: 0.42,
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleRetro(['--days', '7']);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('⚠️');
    expect(output).toContain('sprint-high-rework');
    expect(output).toContain('exceeds 30% threshold');
  });

  // TDD: written RED first (G phase per design §12)
  test('(c) skip-evidence events > 2 per sprint → alert present', async () => {
    cleanDir();
    const ts = new Date().toISOString();
    writeAudit([
      { event: 'evidence_skipped', phase: '3', reason: 'r1', timestamp: ts, sprint_id: 'sprint-skip' },
      { event: 'evidence_skipped', phase: '4', reason: 'r2', timestamp: ts, sprint_id: 'sprint-skip' },
      { event: 'evidence_skipped', phase: '5', reason: 'r3', timestamp: ts, sprint_id: 'sprint-skip' },
    ]);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleRetro(['--days', '7']);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('⚠️');
    expect(output).toContain('sprint-skip');
    expect(output).toContain('used skip 3 times');
  });

  // TDD: written RED first (G phase per design §12)
  test('(d) duration_anomaly entries excluded from avg_ms', async () => {
    cleanDir();
    const ts = new Date().toISOString();
    writeAudit([
      { gate_id: 'gate-1', gate_name: 'g1', passed: true, issues_found: 0, duration_ms: 100, timestamp: ts, trigger: 'manual', repo_path: TMP_DIR, commit_hash: 'abc' },
      { gate_id: 'gate-1', gate_name: 'g1', passed: true, issues_found: 0, duration_ms: 200, timestamp: ts, trigger: 'manual', repo_path: TMP_DIR, commit_hash: 'abc' },
      { gate_id: 'gate-1', gate_name: 'g1', passed: true, issues_found: 0, duration_ms: 99999, duration_anomaly: true, timestamp: ts, trigger: 'manual', repo_path: TMP_DIR, commit_hash: 'abc' },
    ]);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleRetro(['--days', '7']);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    // avg_ms = (100+200)/2 = 150 (anomaly excluded)
    expect(output).toContain('150ms');
    // If anomaly were included: (100+200+99999)/3 ≈ 33433ms
    expect(output).not.toContain('33433ms');
  });
});
