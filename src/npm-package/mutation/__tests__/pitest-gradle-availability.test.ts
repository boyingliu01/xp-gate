/**
 * @test REQ-630
 * @intent A Gradle build file alone is not enough: PITest is launched through
 *         `./gradlew` or a `gradle` on PATH. The pre-existing isAvailable tests
 *         mocked EVERY existsSync to true and mocked the gradle launcher to
 *         succeed, so "build.gradle configures pitest but no launcher can be
 *         run" was never exercised, and deleting the launcher guard left the
 *         suite green. On a machine with a pom-free Gradle project and no gradle
 *         installed, isAvailable() would claim the runner works, and Gate M
 *         would fail later with a confusing "gradle not found".
 *
 *         These cases live here rather than in pitest-runner.test.ts because
 *         that file carries pre-existing warnings; editing it would trigger the
 *         Boy Scout "<=5 warnings must clear to zero" rule for unrelated code.
 * @covers AC-630-01, AC-630-02
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PitestRunner } from '../runners/pitest-runner';

// `fs` is mocked module-wide; each case sets the answers it needs.
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));
// `execSync` decides whether a launcher runs; `spawn` is unused by isAvailable
// but is imported by the runner module.
vi.mock('child_process', () => ({ execSync: vi.fn(), spawn: vi.fn() }));

describe('PitestRunner.isAvailable — Gradle launcher requirement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-630-01: no ./gradlew and gradle not runnable -> unavailable despite a pitest build file', async () => {
    const { existsSync, readFileSync } = await import('fs');
    const { execSync } = await import('child_process');
    // Maven throws; the gradle launcher also throws (not installed).
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });
    // build.gradle exists and configures pitest; ./gradlew does NOT exist.
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      String(p).endsWith('build.gradle'),
    );
    vi.mocked(readFileSync).mockReturnValue(
      'plugins { id "info.solidsoft.pitest" version "1.15.0" }',
    );

    const runner = new PitestRunner();
    expect(await runner.isAvailable()).toBe(false);
  });

  it('AC-630-02: ./gradlew present -> the gradle launcher is not required on PATH', async () => {
    const { existsSync, readFileSync } = await import('fs');
    const { execSync } = await import('child_process');
    // Every launcher probe throws, but ./gradlew exists, so a wrapper-based
    // build must still count as available.
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });
    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const s = String(p);
      return s.includes('gradlew') || s.endsWith('build.gradle.kts');
    });
    vi.mocked(readFileSync).mockReturnValue(
      'plugins { id("info.solidsoft.gradle.pitest") version "1.15.0" }',
    );

    const runner = new PitestRunner();
    expect(await runner.isAvailable()).toBe(true);
  });
});
