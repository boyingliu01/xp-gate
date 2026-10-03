/**
 * @test REQ-458 Gate 1 (Biome) must not block a commit with no lintable files
 * @intent Guard the zero-files-processed path so docs-only commits are possible
 * @covers AC-458-01 (docs-only commit is not blocked)
 * @covers AC-458-02 (a real Biome violation still blocks)
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

/**
 * Run the real Biome branch of Gate 1 with a stubbed `npx`, so the assertion
 * tracks the shipped control flow instead of a copy of it.
 */
function runBiomeBranch(testCase: Case): { status: number; stdout: string } {
  const bash = bashPath();
  const dir = mkdtempSync(join(tmpdir(), 'xp-gate-biome-'));
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

  // Extract only the Biome branch; `exit 1` inside it must end the script, so
  // this is run as a file rather than sourced.
  const hook = execFileSync('node', ['-e', SED_SCRIPT, PRE_COMMIT], { encoding: 'utf8' });
  writeFileSync(join(dir, 'gate1-biome.sh'), hook);

  try {
    execFileSync('chmod', ['+x', join(dir, 'npx')], { stdio: 'ignore' });
  } catch {
    // Windows has no chmod; the stub is invoked through bash, which is enough.
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
      },
    });
    return { status: 0, stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const npxStub = `#!/usr/bin/env bash
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
