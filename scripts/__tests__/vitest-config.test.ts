/**
 * @test REQ-005-01 generated test collection boundary
 * @intent Verify Vitest never collects compiled or coverage output as source tests
 * @covers AC-005-01
 */

import config from '../../vitest.config';

describe('Vitest generated output boundary', () => {
  it('excludes build and coverage output from test collection', () => {
    expect(config).toMatchObject({
      test: {
        exclude: expect.arrayContaining(['dist/**', 'coverage/**']),
      },
    });
  });
});
