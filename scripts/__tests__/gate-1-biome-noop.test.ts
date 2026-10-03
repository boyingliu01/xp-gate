/**
 * @test REQ-458 Gate 1 (Biome) must not block a commit with no lintable files
 * @intent Guard the zero-files-processed path so docs-only commits are possible
 * @covers AC-458-01 (docs-only commit is not blocked)
 * @covers AC-458-02 (a real Biome violation still blocks)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const PRE_COMMIT = join(REPO_ROOT, 'githooks', 'pre-commit');

/** Find the bash to use for running an extracted hook fragment. */
function bashPath(): string | null {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    '/bin/bash',
    '/usr/bin/bash',
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-c', 'true'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

interface Case {
  status: number;
  output: string;
}

/** Temp dirs created by runBiomeBranch, removed once the file finishes. */
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; a leftover temp dir must not fail the suite.
    }
  }
});

/**
 * Run the real Biome branch of Gate 1 with a stubbed `npx`, so the assertion
 * tracks the shipped control flow instead of a copy of it.
 */
function runBiomeBranch(testCase: Case): { status: number; stdout: string } {
  const bash = bashPath();
  const dir = mkdtempSync(join(tmpdir(), 'xp-gate-biome-'));
  tempDirs.push(dir);
  const bin = join(dir, 'bin');
  const project = join(dir, 'proj');
  mkdirSync(bin, { recursive: true });
  mkdirSync(project, { recursive: true });

  writeFileSync(join(project, 'biome.json'), '{"linter":{"enabled":false}}\n');
  // The stub must live in the directory that gets prepended to PATH below --
  // writing it anywhere else silently lets the real npx run and the assertions
  // pass or fail for the wrong reason.
  writeFileSync(join(bin, 'npx'), npxStub);
  writeFileSync(join(dir, 'biome-output.txt'), `${testCase.output}\n`);
  const callsFile = join(dir, STUB_CALLS_FILE);

  // Extract only the Biome branch; `exit 1` inside it must end the script, so
  // this is run as a file rather than sourced.
  const hook = execFileSync('node', ['-e', SED_SCRIPT, PRE_COMMIT], { encoding: 'utf8' });
  writeFileSync(join(dir, 'gate1-biome.sh'), hook);

  // The stub must be executable. Doing this through the same bash we run the
  // hook with keeps the two consistent on every platform (Windows Git Bash
  // honours the mode bit too, and silently falls through to the real npx --
  // or to nothing -- when it is missing).
  const stubPath = join(bin, 'npx');
  try {
    execFileSync(bash as string, ['-c', 'chmod +x "$1"', 'chmod', toBashPath(stubPath)], {
      stdio: 'ignore',
    });
  } catch {
    // Best effort; the assertion below fails loudly if the stub never ran.
  }

  try {
    const stdout = execFileSync(bash as string, [join(dir, 'gate1-biome.sh')], {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
        BIOME_STUB_STATUS: String(testCase.status),
        BIOME_STUB_OUTPUT: join(dir, 'biome-output.txt'),
        BIOME_STUB_CALLS: callsFile,
      },
    });
    assertStubRan(callsFile, stdout);
    return { status: 0, stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    const stdout = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    assertStubRan(callsFile, stdout);
    return { status: err.status ?? 1, stdout };
  }
}

/**
 * Fail loudly if the npx stub never ran, so a green test cannot be vacuous.
 * Without this, a broken PATH would let the real npx execute and the assertions
 * would be measuring the wrong thing entirely.
 */
function assertStubRan(callsFile: string, stdout: string): void {
  let calls = '';
  try {
    calls = readFileSync(callsFile, 'utf8').trim();
  } catch {
    // Missing file means the stub never wrote anything -- handled below.
  }
  if (!calls.includes('biome check')) {
    throw new Error(
      `the npx stub never executed, so this run proves nothing ` +
        `(calls=${JSON.stringify(calls)}):\n${stdout.slice(0, 400)}`,
    );
  }
}

/** Convert a Windows absolute path to the /d/... form Git Bash understands. */
function toBashPath(p: string): string {
  const m = /^([A-Za-z]):\\(.*)$/.exec(p);
  return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p;
}

/**
 * The stub records each invocation to a file rather than stdout: on the success
 * path the hook does not capture `npx` output at all, so a stdout marker cannot
 * prove the stub ran there.
 */
const STUB_CALLS_FILE = 'stub-calls.txt';

const npxStub = `#!/usr/bin/env bash
echo "$*" >> "$BIOME_STUB_CALLS"
if [ "$1" = "biome" ] && [ "$2" = "check" ]; then
  cat "$BIOME_STUB_OUTPUT"
  exit "$BIOME_STUB_STATUS"
fi
exit 0
`;

/** Print the Biome branch of the hook (from its marker comment to the next `fi`). */
const SED_SCRIPT = `
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8").split(/\\r?\\n/);
const start = src.findIndex(l => l.includes("Biome lint/format check"));
let out = [];
for (let i = start; i < src.length; i++) {
  out.push(src[i]);
  if (/^    fi$/.test(src[i])) break;
}
process.stdout.write(out.join("\\n") + "\\n");
`;

const bash = bashPath();
const describeIfBash = bash ? describe : describe.skip;

describeIfBash('Gate 1 Biome zero-files handling (#458)', () => {
  it('does not block a docs-only commit when Biome processes zero files', () => {
    const result = runBiomeBranch({
      status: 1,
      output: [
        'Checked 0 files in 2ms. No fixes applied.',
        'internalError/io ━━━━━━━━━━━━━━━━━━━━',
        '× No files were processed in the specified paths.',
      ].join('\n'),
    });

    expect(result.stdout).not.toContain('BLOCKED');
    expect(result.stdout).toContain('PASSED');
    expect(result.status).toBe(0);
  });

  it('still blocks a real Biome violation', () => {
    const result = runBiomeBranch({
      status: 1,
      output: 'src/index.ts:1:1 lint/style/useConst ━━━━\n× This let is never reassigned.',
    });

    expect(result.stdout).toContain('BLOCKED');
    expect(result.status).toBe(1);
  });

  it('still blocks a Biome parse error', () => {
    const result = runBiomeBranch({
      status: 1,
      output: 'src/broken.ts:3:1 parse ━━━━\n× Expected a semicolon.',
    });

    expect(result.stdout).toContain('BLOCKED');
    expect(result.status).toBe(1);
  });

  it('passes when Biome succeeds normally', () => {
    const result = runBiomeBranch({
      status: 0,
      output: 'Checked 3 files in 12ms. No fixes applied.',
    });

    expect(result.stdout).toContain('PASSED');
    expect(result.status).toBe(0);
  });
});
