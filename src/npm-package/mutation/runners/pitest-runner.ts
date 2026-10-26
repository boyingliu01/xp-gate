// @no-test-required: PITest wrapper — tested via gate-m integration + pre-push Gate M
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type {
  MutationRunner,
  RunMutationOptions,
  MutationRunOutcome,
  MutationRunResult,
} from './types';

/** JSON shape emitted by PITest when run with -DoutputFormats=JSON */
interface PitestJsonReport {
  mutations?: {
    /** One of: KILLED, SURVIVED, NO_COVERAGE, TIMED_OUT, NON_VIABLE, MEMORY_ERROR, RUN_ERROR */
    status?: string;
    mutatedClass?: string;
    sourceFile?: string;
  }[];
  /** PITest also writes "totals" in some versions — prefer counting from mutations array */
}

/**
 * PITest mutation runner for Java and Kotlin files.
 *
 * Supports Maven (pom.xml with pitest-maven plugin) and Gradle
 * (build.gradle/build.gradle.kts with info.solidsoft.pitest plugin).
 *
 * PITest CLI:
 *   Maven:  mvn org.pitest:pitest-maven:mutationCoverage -DoutputFormats=JSON
 *   Gradle: ./gradlew pitest
 *
 * Parses the target/pit-reports/.../mutations.json (Maven) or
 * build/reports/pitest/mutations.json (Gradle) into MutationRunResult.
 */
export class PitestRunner implements MutationRunner {
  readonly name = 'pitest';
  readonly extensions = ['java', 'kt', 'kts'];

  async isAvailable(): Promise<boolean> {
    return mavenPitestConfigured() || gradlePitestConfigured();
  }

  async run(options: RunMutationOptions): Promise<MutationRunOutcome> {
    const buildTool = this.detectBuildTool(options.cwd);

    if (buildTool === 'maven') {
      return this.runMaven(options);
    } else if (buildTool === 'gradle') {
      return this.runGradle(options);
    }

    return {
      report: null,
      timedOut: false,
      error: 'No supported build tool found (need Maven pom.xml with pitest-maven or Gradle with info.solidsoft.pitest)',
    };
  }

  private detectBuildTool(cwd: string): 'maven' | 'gradle' | null {
    if (existsSync(join(cwd, 'pom.xml'))) {
      try {
        execSync('mvn --version', { stdio: 'pipe', timeout: 5000 });
        return 'maven';
      } catch {
        // mvn not available
      }
    }

    if (
      existsSync(join(cwd, 'build.gradle')) ||
      existsSync(join(cwd, 'build.gradle.kts'))
    ) {
      if (existsSync(join(cwd, 'gradlew'))) {
        return 'gradle';
      }
      try {
        execSync('gradle --version', { stdio: 'pipe', timeout: 5000 });
        return 'gradle';
      } catch {
        // gradle not available
      }
    }

    return null;
  }

  private runMaven(options: RunMutationOptions): Promise<MutationRunOutcome> {
    return new Promise((resolve) => {
      const child = spawn(
        'mvn',
        [
          'test-compile',
          'org.pitest:pitest-maven:mutationCoverage',
          '-DoutputFormats=JSON',
        ],
        {
          stdio: 'pipe',
          shell: true,
          cwd: options.cwd,
        },
      );

      let stderr = '';
      let stdout = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, options.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code === null) {
          resolve({ report: null, timedOut: true });
          return;
        }

        const report = this.parsePitestJson(options.cwd, 'maven');
        resolve({
          report,
          timedOut: false,
          error: code !== 0 ? stderr || stdout : undefined,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({ report: null, timedOut: false, error: err.message });
      });
    });
  }

  private runGradle(options: RunMutationOptions): Promise<MutationRunOutcome> {
    return new Promise((resolve) => {
      const gradlewPath = join(options.cwd, 'gradlew');
      const gradleCmd = existsSync(gradlewPath) ? gradlewPath : 'gradle';

      const child = spawn(gradleCmd, ['pitest'], {
        stdio: 'pipe',
        shell: true,
        cwd: options.cwd,
      });

      let stderr = '';
      let stdout = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, options.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code === null) {
          resolve({ report: null, timedOut: true });
          return;
        }

        const report = this.parsePitestJson(options.cwd, 'gradle');
        resolve({
          report,
          timedOut: false,
          error: code !== 0 ? stderr || stdout : undefined,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({ report: null, timedOut: false, error: err.message });
      });
    });
  }

  private findMavenReportPath(cwd: string): string | null {
    const reportsDir = join(cwd, 'target', 'pit-reports');
    if (!existsSync(reportsDir)) return null;
    for (const entry of readdirSync(reportsDir)) {
      const candidate = join(reportsDir, entry, 'mutations.json');
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  private findGradleReportPath(cwd: string): string | null {
    const candidate = join(cwd, 'build', 'reports', 'pitest', 'mutations.json');
    return existsSync(candidate) ? candidate : null;
  }

  private computeScore(data: PitestJsonReport): MutationRunResult | null {
    if (!data.mutations || data.mutations.length === 0) return null;
    const nrOfKilledMutants = data.mutations.filter(
      (m) => m.status === 'KILLED',
    ).length;
    const nrOfMutants = data.mutations.length;
    const nrOfSurvivedMutants = nrOfMutants - nrOfKilledMutants;
    const mutationScore = nrOfMutants === 0
      ? 0
      : (nrOfKilledMutants / nrOfMutants) * 100;
    return { mutationScore, nrOfMutants, nrOfKilledMutants, nrOfSurvivedMutants };
  }

  /**
   * Locate and parse the PITest JSON report file.
   *
   * Maven writes mutations.json under a timestamped subdirectory:
   *   target/pit-reports/<YYYYMMDDHHMM>/mutations.json
   * This method scans all subdirectories to find the latest report.
   *
   * Gradle writes to: build/reports/pitest/mutations.json
   */
  private parsePitestJson(
    cwd: string,
    buildTool: 'maven' | 'gradle',
  ): MutationRunResult | null {
    try {
      const jsonPath = buildTool === 'maven'
        ? this.findMavenReportPath(cwd)
        : this.findGradleReportPath(cwd);
      if (!jsonPath) return null;
      const data: PitestJsonReport = JSON.parse(readFileSync(jsonPath, 'utf-8'));
      return this.computeScore(data);
    } catch {
      return null;
    }
  }
}

/**
 * True when `command` can be executed at all.
 *
 * `execSync` with a short timeout is the cheapest cross-platform probe: the
 * command either resolves and runs, or throws (missing / not executable). Only
 * the throw matters here — the output is irrelevant.
 */
function commandRuns(command: string): boolean {
  try {
    execSync(command, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `file` exists and contains any of `markers`.
 *
 * The read is guarded: a file can exist and still be unreadable (permissions,
 * a directory named like a build file, a transient IO error). Treating that as
 * "does not mention" keeps the caller's answer honest — an unreadable build file
 * does not configure pitest — instead of throwing out of `isAvailable`.
 */
function fileMentions(file: string, markers: readonly string[]): boolean {
  if (!existsSync(file)) return false;
  try {
    const content = readFileSync(file, 'utf-8');
    return markers.some((marker) => content.includes(marker));
  } catch {
    return false;
  }
}

/** Maven is usable when `mvn` runs and the POM configures the pitest plugin. */
function mavenPitestConfigured(): boolean {
  if (!commandRuns('mvn --version')) return false;
  return fileMentions('pom.xml', ['pitest-maven', 'org.pitest']);
}

/**
 * The Gradle build file PITest would read, preferring the Kotlin DSL.
 * @returns the file name, or null when neither exists.
 */
function gradleBuildFile(): string | null {
  if (existsSync('build.gradle.kts')) return 'build.gradle.kts';
  if (existsSync('build.gradle')) return 'build.gradle';
  return null;
}

/** Gradle is usable when a launcher runs and the build file configures pitest. */
function gradlePitestConfigured(): boolean {
  const hasWrapper = existsSync('./gradlew');
  if (!hasWrapper && !commandRuns('gradle --version')) return false;
  const buildFile = gradleBuildFile();
  if (buildFile === null) return false;
  return fileMentions(buildFile, ['info.solidsoft.pitest', 'info.solidsoft.gradle.pitest']);
}
