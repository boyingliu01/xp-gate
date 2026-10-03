/**
 * @test REQ-005-01 generated test collection boundary
 * @intent Verify Vitest never collects compiled or coverage output as source tests
 * @covers AC-005-01
 *
 * @test REQ-005-02 npm-package mirror is not re-tested
 * @intent Verify the byte-identical mirror of the test suite under
 *         `src/npm-package/` is excluded from collection, so every mirrored test
 *         does not run twice (#418). Mirror copies are byte-identical to their
 *         canonical source, so collecting them adds runtime and nothing else --
 *         and they were the direct cause of the Stryker dry run failing, because
 *         a symlink test inside the mirror cannot run on Windows.
 * @covers AC-005-02
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import config from '../../vitest.config';

/** Directories under src/npm-package that mirror a canonical sibling directory. */
const MIRRORED_TEST_DIRS = ['principles', 'mutation', 'mock-policy', 'build-integrity'];

/** Directories under src/npm-package that hold tests with no canonical sibling. */
const UNIQUE_TEST_DIRS = ['lib'];

describe('Vitest generated output boundary', () => {
  it('excludes build and coverage output from test collection', () => {
    expect(config).toMatchObject({
      test: {
        exclude: expect.arrayContaining(['dist/**', 'coverage/**']),
      },
    });
  });
});

describe('Vitest mirror boundary (#418)', () => {
  it('excludes every mirrored test directory from collection', () => {
    const exclude = config.test?.exclude ?? [];

    for (const dir of MIRRORED_TEST_DIRS) {
      expect(exclude).toContain(`src/npm-package/${dir}/**`);
    }
  });

  it('still collects the mirror tests that have no canonical source', () => {
    // `lib/` holds the CLI implementation tests -- they exist ONLY under
    // src/npm-package and are real coverage, so excluding the whole mirror tree
    // would silently delete them.
    const exclude = config.test?.exclude ?? [];

    expect(exclude).not.toContain('src/npm-package/**');
    for (const dir of UNIQUE_TEST_DIRS) {
      expect(exclude.some((pattern: string) => pattern.startsWith(`src/npm-package/${dir}`))).toBe(
        false,
      );
    }
    expect(fs.existsSync(path.resolve(__dirname, '../../src/npm-package/lib/__tests__'))).toBe(true);
  });

  it('excludes the mirrored skills tree, which also shadows canonical skills', () => {
    // The exclude list already dropped `plugins/**`; `skills/**` is the same
    // situation and was missed, so clipboard-vision ran twice (#418).
    const exclude = config.test?.exclude ?? [];

    expect(exclude).toContain('src/npm-package/skills/**');
    expect(exclude).toContain('skills/**');
  });
});
