/**
 * @test REQ-MUT-006 PITest mutation runner
 * @intent Verify PitestRunner registration, availability checks, Maven/Gradle branch routing, and JSON report parsing
 * @covers AC-MUT-006, AC-MUT-007
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((_path: string, _encoding?: string) => {
      return '';
    }),
    existsSync: vi.fn((_path: string) => {
      return false;
    }),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
  };
});


/**
 * A child-process double that lets a test fire 'close' on demand.
 *
 * The four run tests below each built this object inline, and each re-derived
 * the same mock resets -- together 45% of this file was duplicated setup, which
 * is what the duplication rule was reporting.
 */
function makeChildDouble(): {
  child: ChildProcess;
  fireClose: (code: number | null) => void;
} {
  let closeCb: ((code: number | null) => void) | null = null;
  const child = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code: number | null) => void) => {
      if (event === 'close') closeCb = cb;
    }),
    kill: vi.fn(),
    killed: false,
  };
  return {
    child: child as unknown as ChildProcess,
    fireClose: (code) => closeCb!(code),
  };
}

/** Reset every child-process and fs mock, and stub PIT's on-disk layout. */
async function resetPitestMocks(): Promise<void> {
  const { existsSync, readFileSync, readdirSync } = await import('fs');
  vi.mocked(execSync).mockReset();
  vi.mocked(spawn).mockReset();
  vi.mocked(existsSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(readdirSync).mockReset();
  vi.mocked(execSync).mockImplementation(() => Buffer.from('Apache Maven 3.9.0'));
  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return path.endsWith('pom.xml')
      || path.includes('pit-reports')
      || path.endsWith('mutations.json');
  });
}


/** What a given fixture pretends exists on disk. */
interface FsLayout {
  pom?: boolean;
  gradle?: boolean;
  gradlew?: boolean;
  pitReports?: boolean;
  mutationsJson?: boolean;
}

/**
 * Stub `existsSync` to describe one build layout.
 *
 * Nine tests wrote this switch inline; only the booleans differed.
 */
async function stubLayout(layout: FsLayout): Promise<void> {
  const { existsSync } = await import('fs');
  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    if (path.includes('pom.xml')) return layout.pom === true;
    if (path.includes('build.gradle')) return layout.gradle === true;
    if (path.includes('gradlew')) return layout.gradlew === true;
    if (path.includes('mutations.json')) return layout.mutationsJson === true;
    if (path.includes('pit-reports')) return layout.pitReports === true;
    return false;
  });
}

/**
 * Point `readFileSync` at a PIT report built from KILLED/SURVIVED rows.
 *
 * Ten tests constructed the same JSON by hand; the mutation rows are the only
 * thing that varies, and the score assertions are derived from them.
 */
async function stubReport(rows: Array<[status: string, cls: string, file: string]>): Promise<void> {
  const { readFileSync } = await import('fs');
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
    mutations: rows.map(([status, mutatedClass, sourceFile]) => ({ status, mutatedClass, sourceFile })),
  }));
}

/** Point `readFileSync` at a build file's contents. */
async function stubBuildFile(contents: string): Promise<void> {
  const { readFileSync } = await import('fs');
  vi.mocked(readFileSync).mockReturnValue(contents);
}

/** Install a controllable child double and return its `fireClose`. */
function stubChild(): { fireClose: (code: number | null) => void } {
  const { child, fireClose } = makeChildDouble();
  vi.mocked(spawn).mockReturnValue(child);
  return { fireClose };
}

/** Pretend the given build tool answers `--version`. */
async function stubToolVersion(output: string): Promise<void> {
  const { execSync } = await import('child_process');
  vi.mocked(execSync).mockReturnValueOnce(Buffer.from(output));
}

type PitestRunnerInstance = InstanceType<typeof import('../runners/pitest-runner').PitestRunner>;

/**
 * The current test's fixture directory.
 *
 * `tmpDir` is scoped to the describe block; a top-level helper cannot see it, and
 * threading it through six call sites would recreate the repetition the helper
 * exists to remove.
 */
let activeTmpDir = '';
function currentTmpDir(): string {
  return activeTmpDir;
}

/**
 * Start a run on `runner`, then close the child double once its listeners exist.
 *
 * Six tests performed this by hand and each re-derived the same three steps.
 * Centralising it also pins the `setImmediate` requirement: the shared spawn
 * helper wires its listeners inside a Promise, so a 'close' fired before the
 * microtask queue drains reaches nothing.
 */
async function runAndClose(
  runner: PitestRunnerInstance,
  files: string[],
  fireClose: (code: number | null) => void,
  code: number | null = 0,
): Promise<Awaited<ReturnType<PitestRunnerInstance['run']>>> {
  const promise = runner.run({ files, timeoutMs: 60_000, cwd: currentTmpDir() });
  await new Promise((r) => setImmediate(r));
  fireClose(code);
  return promise;
}

describe('PitestRunner', () => {
  let PitestRunner: typeof import('../runners/pitest-runner').PitestRunner;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `xp-gate-pitest-test-${Date.now()}`);
    activeTmpDir = tmpDir;
    try {
      mkdirSync(tmpDir, { recursive: true });
    } catch (err) {
      // Fail with the directory named: a bare EACCES in beforeEach reads as a
      // broken test rather than a broken environment.
      throw new Error(`cannot create fixture dir ${tmpDir}: ${(err as Error).message}`);
    }
    PitestRunner = (await import('../runners/pitest-runner')).PitestRunner;
  });

  afterEach(() => {
    try { process.kill(process.pid, 0); } catch { /* noop */ }
  });

  describe('name and extensions', () => {
    it('should have name "pitest"', () => {
      const runner = new PitestRunner();
      expect(runner.name).toBe('pitest');
    });

    it('should handle .java, .kt, and .kts extensions', () => {
      const runner = new PitestRunner();
      expect(runner.extensions).toContain('java');
      expect(runner.extensions).toContain('kt');
      expect(runner.extensions).toContain('kts');
      expect(runner.extensions).not.toContain('ts');
      expect(runner.extensions).not.toContain('py');
    });
  });

  describe('isAvailable', () => {
    /**
     * Five cases that differ only in which build file exists and what it says.
     *
     * Table-driven because the five bodies were identical apart from those two
     * values -- the duplication rule was reading them as copy-paste, and it was
     * right: adding a sixth build tool meant copying a seventh block.
     */
    const CASES: Array<{
      name: string;
      tool?: string;
      buildFile?: string;
      expected: boolean;
      expectVersionProbe?: string;
      /** Maven is absent, so the runner must fall through to Gradle. */
      mvnMissing?: boolean;
    }> = [
      { name: 'neither Maven nor Gradle is available', expected: false },
      {
        name: 'Maven is available and pom.xml has pitest-maven',
        tool: 'Apache Maven 3.9.0',
        buildFile: '<project><build><plugins><plugin><groupId>org.pitest</groupId><artifactId>pitest-maven</artifactId></plugin></plugins></build></project>',
        expected: true,
        expectVersionProbe: 'mvn --version',
      },
      {
        name: 'Maven is available but pom.xml lacks the pitest plugin',
        tool: 'Apache Maven 3.9.0',
        buildFile: '<project><build><plugins></plugins></build></project>',
        expected: false,
      },
      {
        name: 'Gradle is available and build.gradle has the pitest plugin',
        tool: 'Gradle 8.5',
        buildFile: 'plugins { id("info.solidsoft.pitest") version "1.15.0" }',
        expected: true,
      },
      {
        name: './gradlew exists and build.gradle.kts has the pitest plugin',
        tool: 'Gradle 8.5',
        buildFile: 'plugins { id("info.solidsoft.gradle.pitest") version "1.15.0" }',
        expected: true,
        mvnMissing: true,
      },
    ];

    for (const testCase of CASES) {
      it(`should return ${testCase.expected} when ${testCase.name}`, async () => {
        const { existsSync } = await import('fs');
        const runner = new PitestRunner();

        if (!testCase.tool) {
          vi.mocked(existsSync).mockReturnValue(false);
          vi.mocked(execSync).mockImplementation(() => {
            throw new Error('ENOENT');
          });
        } else {
          // Maven absent, Gradle present: the first probe throws, the second
          // answers. The runner must fall through rather than give up.
          if (testCase.mvnMissing) {
            vi.mocked(execSync).mockImplementationOnce(() => {
              throw new Error('mvn not found');
            });
          }
          await stubToolVersion(testCase.tool);
          vi.mocked(existsSync).mockReturnValue(true);
        }
        if (testCase.buildFile) {
          await stubBuildFile(testCase.buildFile);
        }

        expect(await runner.isAvailable()).toBe(testCase.expected);
        if (testCase.expectVersionProbe) {
          expect(execSync).toHaveBeenCalledWith(testCase.expectVersionProbe, expect.any(Object));
        }
      });
    }
  });

  describe('run - Maven branch', () => {
    it('should run PITest via Maven and parse JSON output', async () => {
      const { readdirSync } = await import('fs');
      await resetPitestMocks();
      vi.mocked(readdirSync).mockReturnValue(['202506300000'] as unknown as ReturnType<typeof readdirSync>);
      await stubReport([
        ['KILLED', 'com.example.Foo', 'Foo.java'],
        ['KILLED', 'com.example.Foo', 'Foo.java'],
        ['SURVIVED', 'com.example.Foo', 'Foo.java'],
        ['SURVIVED', 'com.example.Bar', 'Bar.java'],
        ['NO_COVERAGE', 'com.example.Baz', 'Baz.java'],
      ]);

      const { fireClose } = stubChild();

      const result = await runAndClose(new PitestRunner(), ['src/main/java/com/example/Foo.java'], fireClose!);

      expect(spawn).toHaveBeenCalledWith('mvn', [
        'test-compile',
        'org.pitest:pitest-maven:mutationCoverage',
        '-DoutputFormats=JSON',
      ], expect.objectContaining({ cwd: tmpDir }));

      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(40);
      expect(result.report!.nrOfMutants).toBe(5);
      expect(result.report!.nrOfKilledMutants).toBe(2);
      expect(result.report!.nrOfSurvivedMutants).toBe(3);
    });
  });

  describe('run - Gradle branch', () => {
    it('should run PITest via Gradle and parse JSON output', async () => {
      const { existsSync, readFileSync } = await import('fs');

      vi.mocked(existsSync).mockReset();
      vi.mocked(readFileSync).mockReset();
      vi.mocked(spawn).mockReset();
      vi.mocked(execSync).mockReset();

      await stubLayout({gradle: true, gradlew: true, mutationsJson: true});

      const { fireClose } = stubChild();

      await stubReport([
        ['KILLED', 'com.example.Foo', 'Foo.kt'],
        ['KILLED', 'com.example.Foo', 'Foo.kt'],
        ['KILLED', 'com.example.Foo', 'Foo.kt'],
        ['SURVIVED', 'com.example.Foo', 'Foo.kt'],
      ]);

      const result = await runAndClose(new PitestRunner(), ['src/main/kotlin/com/example/Foo.kt'], fireClose!);

      // stdin is explicitly ignored by the shared spawn helper: a tool that
      // decides to prompt would otherwise block until the gate times out.
      expect(spawn).toHaveBeenCalledWith(join(tmpDir, 'gradlew'), ['pitest'], {
        cwd: tmpDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(75);
    });

    it('should use gradle (not ./gradlew) when gradlew does not exist', async () => {

      await stubToolVersion('Gradle 8.5');
      await stubLayout({gradle: true, mutationsJson: true});

      const { fireClose } = stubChild();

      await stubReport([
        ['KILLED', 'com.example.Foo', 'Foo.java'],
      ]);

      const result = await runAndClose(new PitestRunner(), ['src/main/java/com/example/Foo.java'], fireClose!);

      expect(spawn).toHaveBeenCalledWith('gradle', ['pitest'], expect.objectContaining({ cwd: tmpDir }));
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(100);
    });
  });

  describe('run - error handling', () => {
    it('should return error when no build tool is available', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const runner = new PitestRunner();
      const result = await runner.run({
        files: ['src/main/java/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('No supported build tool');
    });

    it('should return timedOut=true when child process is killed by timeout', async () => {

      await stubToolVersion('Apache Maven 3.9.0');
      await stubLayout({pom: true});

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(null), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new PitestRunner();
      const result = await runner.run({
        files: ['src/main/java/Foo.java'],
        timeoutMs: 100,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(true);
      expect(result.report).toBeNull();
    });

    it('should return error when spawn fails', async () => {

      await stubToolVersion('Apache Maven 3.9.0');
      await stubLayout({pom: true});

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'error') setTimeout(() => cb(new Error('spawn ENOENT')), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new PitestRunner();
      const result = await runner.run({
        files: ['src/main/java/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBe('spawn ENOENT');
    });

    it('should return null report when mutations.json does not exist', async () => {

      await stubToolVersion('Apache Maven 3.9.0');
      await stubLayout({pom: true});

      const { fireClose } = stubChild();

      const result = await runAndClose(new PitestRunner(), ['src/main/java/Foo.java'], fireClose!);

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('should return error string when Maven exits with non-zero code', async () => {
      const { readdirSync } = await import('fs');

      await stubToolVersion('Apache Maven 3.9.0');
      await stubLayout({pom: true, pitReports: true, mutationsJson: true});
      vi.mocked(readdirSync).mockReturnValue(['202506300000'] as unknown as ReturnType<typeof readdirSync>);
      await stubReport([
        ['KILLED', 'com.example.Foo', 'Foo.java'],
      ]);

      let stderrCalled = false;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
            if (!stderrCalled) {
              stderrCalled = true;
              cb(Buffer.from('Build failed: compilation error'));
            }
          }),
        },
        on: vi.fn((event, cb) => {
          if (event === 'close') cb(1);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new PitestRunner();
      const result = await runner.run({
        files: ['src/main/java/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('Build failed');
    });

    it('should return null report when JSON is unparseable', async () => {
      const { readFileSync } = await import('fs');

      await stubToolVersion('Apache Maven 3.9.0');
      await stubLayout({pom: true, pitReports: true, mutationsJson: true});
      vi.mocked(readFileSync).mockReturnValue('not valid json {{{');

      const { fireClose } = stubChild();

      const result = await runAndClose(new PitestRunner(), ['src/main/java/Foo.java'], fireClose!);

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('should return null report when mutations array is empty', async () => {

      await stubToolVersion('Apache Maven 3.9.0');
      await stubLayout({pom: true, pitReports: true, mutationsJson: true});
      await stubReport([]);

      const { fireClose } = stubChild();

      const result = await runAndClose(new PitestRunner(), ['src/main/java/Foo.java'], fireClose!);

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });
  });

  describe('registration', () => {
    it('should register in runnerRegistry via registerAllRunners', async () => {
      const { runnerRegistry, registerAllRunners } = await import('../runners');
      registerAllRunners();
      const runner = runnerRegistry.get('pitest');
      expect(runner).toBeDefined();
      expect(runner!.name).toBe('pitest');
      expect(runner!.extensions).toContain('java');
    });
  });
});
