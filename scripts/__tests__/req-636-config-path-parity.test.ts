/**
 * Parity between the two definitions of "machine-wide Delphi config path".
 *
 * @test REQ-636
 * @intent Prove the Gate MW validator and the DSH plugin resolve the SAME
 *         machine-wide `.delphi-config.json`, so a review cannot be bound
 *         against seats from a different file than the one the reviewer used.
 *
 * WHY THIS EXISTS (2026-10-27 review, technical seat CRITICAL):
 *   #636 added a machine-wide fallback in two places — `defaultGlobalConfigPath()`
 *   in `plugins/dsh/src/delphi-config.ts` (ESM/TypeScript) and `globalConfigPath()`
 *   in `githooks/lib/validate-code-walkthrough.cjs` (CJS, shipped as a hook). They
 *   cannot share an import: the hook is plain CJS copied into `.git/hooks`, the
 *   plugin is ESM built to `lib/`. Restating the rule was the only option, and a
 *   restated rule drifts.
 *
 *   The failure mode is silent and severe: if the plugin starts honouring a
 *   different XDG_CONFIG_HOME than the gate, the gate validates the seats from
 *   file A while the reviewer ran on the seats from file B. Every seat check
 *   still PASSES — it just passes against the wrong file, which is the exact
 *   class of defect #574 was written to catch.
 *
 *   So this test does not restate the path either. It imports the plugin's
 *   definition and compares it against the gate's, over the env shapes that
 *   actually differ in practice.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { defaultGlobalConfigPath } from '../../plugins/dsh/src/delphi-config.js';

const require_ = createRequire(import.meta.url);

/** Load the gate's CJS path helper without executing its CLI main(). */
function loadGatePathHelper(): (env?: NodeJS.ProcessEnv) => string {
  const file = resolve(process.cwd(), 'githooks/lib/validate-code-walkthrough.cjs');
  let source: string;
  try {
    source = require_('node:fs').readFileSync(file, 'utf8');
  } catch (error) {
    // Without this the suite fails with a bare ENOENT that says nothing about
    // what the test was trying to prove.
    throw new Error(
      `cannot read the Gate MW validator at ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // The file ends with a bare `main();`, which parses argv and calls
  // process.exit on a usage error. Neutralise exactly that call and expose the
  // helper instead, so importing it here cannot terminate the test runner.
  const neutralised = source.replace(/\nmain\(\);\s*$/, '\n');
  if (neutralised === source) {
    throw new Error('could not neutralise the CLI entry in validate-code-walkthrough.cjs');
  }
  const Module = require_('node:module');
  const m = new Module('gate-path-probe');
  m.filename = file;
  m.paths = Module._nodeModulePaths(resolve(process.cwd(), 'githooks/lib'));
  m._compile(`${neutralised}\nmodule.exports.__globalConfigPath = globalConfigPath;\n`, file);
  return m.exports.__globalConfigPath;
}

describe('REQ-636: machine-wide config path parity (gate <-> DSH plugin)', () => {
  const gatePath = loadGatePathHelper();

  const cases: Array<[string, NodeJS.ProcessEnv]> = [
    ['XDG_CONFIG_HOME set', { XDG_CONFIG_HOME: '/custom/xdg' } as NodeJS.ProcessEnv],
    ['XDG_CONFIG_HOME empty string', { XDG_CONFIG_HOME: '' } as NodeJS.ProcessEnv],
    ['XDG_CONFIG_HOME unset', {} as NodeJS.ProcessEnv],
  ];

  for (const [label, env] of cases) {
    it(`resolves the same file when ${label}`, () => {
      expect(gatePath(env)).toBe(defaultGlobalConfigPath(env));
    });
  }

  it('both point at <base>/xp-gate/.delphi-config.json', () => {
    const resolvedPath = gatePath({ XDG_CONFIG_HOME: '/custom/xdg' } as NodeJS.ProcessEnv);
    expect(resolvedPath).toBe(join('/custom/xdg', 'xp-gate', '.delphi-config.json'));
  });

  it('both fall back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const resolvedPath = gatePath({} as NodeJS.ProcessEnv);
    expect(resolvedPath).toBe(join(homedir(), '.config', 'xp-gate', '.delphi-config.json'));
  });
});
