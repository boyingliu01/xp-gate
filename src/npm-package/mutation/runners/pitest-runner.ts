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
    // Check Maven availability: mvn exists + pom.xml with pitest-maven plugin
    try {
      execSync('mvn --version', { stdio: 'pipe', timeout: 5000 });
      if (existsSync('pom.xml')) {
        const pom = readFileSync('pom.xml', 'utf-8');
        if (
          pom.includes('pitest-maven') ||
          pom.includes('org.pitest')
        ) {
          return true;
        }
      }
    } catch {
      // Maven not available
    }

    // Check Gradle availability: gradle/gradlew exists + build.gradle(.kts) with pitest plugin
    const gradlewPath = './gradlew';
    const hasGradlew = existsSync(gradlewPath);
    try {
      if (!hasGradlew) {
        execSync('gradle --version', { stdio: 'pipe', timeout: 5000 });
      }
      const buildGradle = existsSync('build.gradle.kts')
        ? 'build.gradle.kts'
        : existsSync('build.gradle')
          ? 'build.gradle'
          : null;
      if (buildGradle) {
        const content = readFileSync(buildGradle, 'utf-8');
        if (
          content.includes('info.solidsoft.pitest') ||
          content.includes('info.solidsoft.gradle.pitest')
        ) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
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
          shell: false,
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
        shell: false,
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
