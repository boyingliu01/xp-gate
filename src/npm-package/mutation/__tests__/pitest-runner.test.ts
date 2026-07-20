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

describe('PitestRunner', () => {
  let PitestRunner: typeof import('../runners/pitest-runner').PitestRunner;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `xp-gate-pitest-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
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
    it('should return false when neither Maven nor Gradle is available', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const runner = new PitestRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });

    it('should return true when Maven is available and pom.xml has pitest-maven', async () => {
      const { existsSync, readFileSync } = await import('fs');
      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        '<project><build><plugins><plugin><groupId>org.pitest</groupId><artifactId>pitest-maven</artifactId></plugin></plugins></build></project>',
      );

      const runner = new PitestRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('mvn --version', expect.any(Object));
    });

    it('should return false when Maven is available but pom.xml lacks pitest plugin', async () => {
      const { existsSync, readFileSync } = await import('fs');
      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        '<project><build><plugins></plugins></build></project>',
      );

      const runner = new PitestRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });

    it('should return true when Gradle is available and build.gradle has pitest plugin', async () => {
      const { existsSync, readFileSync } = await import('fs');
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('mvn not found');
        })
        .mockReturnValueOnce(Buffer.from('Gradle 8.5'));
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        'plugins { id("info.solidsoft.pitest") version "1.15.0" }',
      );

      const runner = new PitestRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(true);
    });

    it('should return true when ./gradlew exists with build.gradle.kts containing pitest plugin', async () => {
      const { existsSync, readFileSync } = await import('fs');
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('mvn not found');
        });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        'plugins { id("info.solidsoft.gradle.pitest") version "1.15.0" }',
      );

      const runner = new PitestRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(true);
    });
  });

  describe('run - Maven branch', () => {
    it('should run PITest via Maven and parse JSON output', async () => {
      const { existsSync, readFileSync, readdirSync } = await import('fs');

      vi.mocked(execSync).mockReset();
      vi.mocked(spawn).mockReset();
      vi.mocked(existsSync).mockReset();
      vi.mocked(readFileSync).mockReset();
      vi.mocked(readdirSync).mockReset();

      vi.mocked(execSync).mockImplementation(() => Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.endsWith('pom.xml')) return true;
        if (path.includes('pit-reports')) return true;
        if (path.endsWith('mutations.json')) return true;
        return false;
      });
      vi.mocked(readdirSync).mockReturnValue(['202506300000'] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        mutations: [
          { status: 'KILLED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.java' },
          { status: 'KILLED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.java' },
          { status: 'SURVIVED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.java' },
          { status: 'SURVIVED', mutatedClass: 'com.example.Bar', sourceFile: 'Bar.java' },
          { status: 'NO_COVERAGE', mutatedClass: 'com.example.Baz', sourceFile: 'Baz.java' },
        ],
      }));

      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new PitestRunner();
      const promise = runner.run({
        files: ['src/main/java/com/example/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

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

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return false;
        if (path.includes('build.gradle')) return true;
        if (path.includes('gradlew')) return true;
        if (path.includes('mutations.json')) return true;
        return false;
      });

      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        mutations: [
          { status: 'KILLED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.kt' },
          { status: 'KILLED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.kt' },
          { status: 'KILLED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.kt' },
          { status: 'SURVIVED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.kt' },
        ],
      }));

      const runner = new PitestRunner();
      const promise = runner.run({
        files: ['src/main/kotlin/com/example/Foo.kt'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(join(tmpDir, 'gradlew'), ['pitest'], {
        cwd: tmpDir,
        stdio: 'pipe',
        shell: true,
      });
      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(75);
    });

    it('should use gradle (not ./gradlew) when gradlew does not exist', async () => {
      const { existsSync, readFileSync } = await import('fs');

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Gradle 8.5'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return false;
        if (path.includes('build.gradle')) return true;
        if (path.includes('gradlew')) return false;
        if (path.includes('mutations.json')) return true;
        return false;
      });

      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        mutations: [
          { status: 'KILLED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.java' },
        ],
      }));

      const runner = new PitestRunner();
      const promise = runner.run({
        files: ['src/main/java/com/example/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

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
      const { existsSync } = await import('fs');

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return true;
        return false;
      });

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
      const { existsSync } = await import('fs');

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return true;
        return false;
      });

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
      const { existsSync } = await import('fs');

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return true;
        if (path.includes('pit-reports') && !path.includes('mutations.json')) return true;
        if (path.includes('mutations.json')) return false;
        return false;
      });

      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new PitestRunner();
      const promise = runner.run({
        files: ['src/main/java/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('should return error string when Maven exits with non-zero code', async () => {
      const { existsSync, readFileSync, readdirSync } = await import('fs');

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return true;
        if (path.includes('mutations.json')) return true;
        if (path.includes('pit-reports')) return true;
        return false;
      });
      vi.mocked(readdirSync).mockReturnValue(['202506300000'] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        mutations: [
          { status: 'KILLED', mutatedClass: 'com.example.Foo', sourceFile: 'Foo.java' },
        ],
      }));

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
      const { existsSync, readFileSync } = await import('fs');

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return true;
        if (path.includes('mutations.json')) return true;
        if (path.includes('pit-reports')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('not valid json {{{');

      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new PitestRunner();
      const promise = runner.run({
        files: ['src/main/java/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('should return null report when mutations array is empty', async () => {
      const { existsSync, readFileSync } = await import('fs');

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('Apache Maven 3.9.0'));
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pom.xml')) return true;
        if (path.includes('mutations.json')) return true;
        if (path.includes('pit-reports')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        mutations: [],
      }));

      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new PitestRunner();
      const promise = runner.run({
        files: ['src/main/java/Foo.java'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

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
