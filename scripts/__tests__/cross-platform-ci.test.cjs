/**
 * @test REQ-010-01 npm mirror parity enforcement
 * @intent Verify CI detects committed build-integrity mirror drift after synchronization
 * @covers AC-010-01
 */

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');

describe('cross-platform mirror parity workflow', () => {
  it('tracks build-integrity in the post-sync Git diff guard', () => {
    // Given
    const workflowPath = path.resolve(__dirname, '../../.github/workflows/cross-platform-ci.yml');
    const workflow = parse(fs.readFileSync(workflowPath, 'utf8'));

    // When
    const runScript = workflow.jobs['mirror-parity'].steps.find((step) => step.run).run;
    const trackedDiff = runScript.match(/git diff[^\n]+/)[0];

    // Then
    expect(trackedDiff).toContain('src/npm-package/build-integrity');
  });
});
