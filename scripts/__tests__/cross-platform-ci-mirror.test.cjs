/**
 * @test REQ-010-01 mirror parity workflow ordering
 * @intent Verify CI checks Delphi runner parity before sync and Git state after sync
 * @covers AC-010-01
 */

const fs = require('node:fs');
const path = require('node:path');

describe('cross-platform mirror parity workflow', () => {
  it('runs Delphi runner checks on both sides of package sync', () => {
    const workflow = fs.readFileSync(
      path.resolve(__dirname, '../../.github/workflows/cross-platform-ci.yml'),
      'utf8',
    );
    const precheck = workflow.indexOf('bash scripts/check-delphi-runner-mirror.sh\n');
    const sync = workflow.indexOf('node src/npm-package/scripts/sync-package-content.js');
    const postcheck = workflow.indexOf('bash scripts/check-delphi-runner-mirror.sh --post-sync');
    const trackedGuard = workflow.indexOf('src/npm-package/scripts/delphi-external-review.cjs 2>&1');

    expect(precheck).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(precheck);
    expect(postcheck).toBeGreaterThan(sync);
    expect(trackedGuard).toBeGreaterThan(postcheck);
  });
});
