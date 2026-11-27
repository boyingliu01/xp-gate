// @no-test-required: PITest wrapper — tested via gate-m integration + pre-push Gate M
import { execSync } from 'child_process';
import { runMutationCommand } from './spawn-with-capture';
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
/** Whether a `mvn` binary answers in this directory. */
function canRunMaven(cwd: string): boolean {
  if (!existsSync(join(cwd, 'pom.xml'))) return false;
  return toolResponds('mvn --version');
}

/** Whether a `gradle` binary answers in this directory. */
function canRunGradle(cwd: string): boolean {
  if (!hasGradleBuild(cwd)) return false;
  // The WRAPPER is preferred and needs no probe: `gradlew` in the repo is the project's
  // own pinned version, so its presence is proof enough.
  if (existsSync(join(cwd, 'gradlew'))) return true;
  return toolResponds('gradle --version');
}

/** Whether the directory declares a Gradle build, in either DSL. */
function hasGradleBuild(cwd: string): boolean {
  return existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'));
}

/**
 * Whether this command answers within the probe budget.
 *
 * A tool that is absent THROWS from `execSync`; a tool that HANGS would block the gate,
 * so the timeout is part of the check rather than an optimisation.
 */
function toolResponds(command: string): boolean {
  try {
    execSync(command, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

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

  /**
   * Which build tool can run these mutants, or null.
   *
   * MAVEN is checked first: a project with both build files is conventionally a Maven
   * project that added a Gradle wrapper experimentally. A build file alone is not
   * enough -- the tool must answer, or the run fails later with a less useful message.
   */
  private detectBuildTool(cwd: string): 'maven' | 'gradle' | null {
    if (canRunMaven(cwd)) return 'maven';
    if (canRunGradle(cwd)) return 'gradle';
    return null;
  }

  private runMaven(options: RunMutationOptions): Promise<MutationRunOutcome> {
    return this.runPitest(
      'mvn',
      ['test-compile', 'org.pitest:pitest-maven:mutationCoverage', '-DoutputFormats=JSON'],
      options,
      'maven',
    );
  }

  private runGradle(options: RunMutationOptions): Promise<MutationRunOutcome> {
    const gradlewPath = join(options.cwd, 'gradlew');
    const gradleCmd = existsSync(gradlewPath) ? gradlewPath : 'gradle';
    return this.runPitest(gradleCmd, ['pitest'], options, 'gradle');
  }

  /**
   * Run PIT and read the report it wrote.
   *
   * Maven and Gradle differ only in how PIT is invoked and which report file it
   * lands in; the spawn/timeout/capture skeleton was copied verbatim into both,
   * which is two places for the timeout policy to drift apart.
   */
  private async runPitest(
    command: string,
    args: string[],
    options: RunMutationOptions,
    flavour: 'maven' | 'gradle',
  ): Promise<MutationRunOutcome> {
    return runMutationCommand(command, args, {
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      shell: true,
    }, () => this.parsePitestJson(options.cwd, flavour));
  }

  private findMavenReportPath(cwd: string): string | null {
    const reportsDir = join(cwd, 'target', 'pit-reports');
    try {
      for (const entry of readdirSync(reportsDir)) {
        const candidate = join(reportsDir, entry, 'mutations.json');
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // A missing or unreadable reports directory means PIT wrote nothing, which
      // the caller reports as "no report" rather than as a crash. ENOENT here is
      // routine (PIT skipped, or the build failed before the report step), so
      // throwing would turn "no report" into an unhandled error.
      return null;
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
