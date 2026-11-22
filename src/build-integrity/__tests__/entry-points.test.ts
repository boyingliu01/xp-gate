/**
 * Entry-point reachability — the check that stops a manifest from disagreeing
 * with its own tarball.
 *
 * THE DEFECT THESE TESTS PIN
 *
 * Measured 2026-11-22: a project declaring
 *
 *     { "main": "dist/nonexistent.js", "files": ["dist"] }
 *
 * whose dist/ held only `tsconfig.tsbuildinfo` passed gate 9's pack check. The
 * check only required "at least one file that is not package.json", so the
 * tsbuildinfo satisfied it, and the gate printed `Overall: PASS` for a tarball
 * containing no JavaScript. Every require() of that published package would have
 * thrown MODULE_NOT_FOUND.
 *
 * The cases below are deliberately asymmetric: several of them assert that a
 * manifest is NOT reported, because a reachability check that over-fires would
 * block every correct package. The false-block cases outnumber the false-negative
 * cases for that reason.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { missingEntryPoints, unreachableEntryPointsMessage, readManifest } from '../entry-points.js';

describe('missingEntryPoints', () => {
  it('reports a main entry the package does not contain', () => {
    // The exact shape of the measured defect: the only shipped file is a build
    // artefact, so "something was packed" is true while the entry is absent.
    const present = new Set(['dist/tsconfig.tsbuildinfo', 'package.json']);
    expect(missingEntryPoints({ main: 'dist/nonexistent.js' }, present)).toEqual(['dist/nonexistent.js']);
  });

  it('does not report a main entry that is present', () => {
    const present = new Set(['dist/index.js', 'package.json']);
    expect(missingEntryPoints({ main: 'dist/index.js' }, present)).toEqual([]);
  });

  it('accepts an extensionless entry resolved through its .js file', () => {
    // npm resolves "dist/index" to dist/index.js. Reporting it would be a false
    // block on an ordinary manifest.
    expect(missingEntryPoints({ main: 'dist/index' }, new Set(['dist/index.js']))).toEqual([]);
  });

  it('accepts a directory entry resolved through index.js', () => {
    expect(missingEntryPoints({ main: 'dist' }, new Set(['dist/index.js']))).toEqual([]);
  });

  it('accepts a "./"-prefixed entry', () => {
    // exports leaves are conventionally written with "./" while main is not; both
    // spellings have to work.
    expect(missingEntryPoints({ exports: './dist/a.js' }, new Set(['dist/a.js']))).toEqual([]);
  });

  it('treats a bare specifier as a dependency, not a tarball path', () => {
    // "main": "some-dependency" is legal npm and resolves inside node_modules.
    expect(missingEntryPoints({ main: 'some-dependency' }, new Set(['package.json']))).toEqual([]);
  });

  it('reports a missing conditional-export leaf', () => {
    const manifest = { exports: { '.': { require: './dist/a.js', types: './dist/a.d.ts' } } };
    expect(missingEntryPoints(manifest, new Set(['dist/a.js']))).toEqual(['./dist/a.d.ts']);
  });

  it('reports every missing entry rather than only the first', () => {
    const manifest = { main: 'dist/a.js', types: 'dist/a.d.ts' };
    expect(missingEntryPoints(manifest, new Set(['package.json']))).toHaveLength(2);
  });

  it('checks module and types as well as main', () => {
    expect(missingEntryPoints({ module: 'dist/esm/m.js' }, new Set(['dist/cjs/m.js']))).toEqual([
      'dist/esm/m.js',
    ]);
  });

  it('is silent for a manifest with no entry-point fields', () => {
    expect(missingEntryPoints({ name: 'p', version: '1.0.0' }, new Set(['package.json']))).toEqual([]);
  });

  it('ignores an empty exports object', () => {
    // A package that publishes data only declares no entry points; that is not a
    // defect and must not be reported as one.
    expect(missingEntryPoints({ exports: {} }, new Set(['package.json']))).toEqual([]);
  });
});

describe('unreachableEntryPointsMessage', () => {
  it('names the count and each path so the operator can find it', () => {
    const msg = unreachableEntryPointsMessage({ main: 'dist/missing.js' }, [{ path: 'package.json' }]);
    expect(msg).toContain('1 entry point(s)');
    expect(msg).toContain('dist/missing.js');
  });

  it('returns null when every entry is shipped', () => {
    expect(unreachableEntryPointsMessage({ main: 'dist/i.js' }, [{ path: 'dist/i.js' }])).toBeNull();
  });
});

describe('readManifest', () => {
  it('returns the parsed manifest', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-manifest-'));
    try {
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ main: 'dist/a.js' }));
      expect(await readManifest(dir)).toEqual({ main: 'dist/a.js' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null when there is no package.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-nomanifest-'));
    try {
      expect(await readManifest(dir)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null for an unparseable manifest instead of throwing', async () => {
    // A broken package.json is a different gate's problem; the pack check must not
    // crash on it.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-badmanifest-'));
    try {
      await fs.writeFile(path.join(dir, 'package.json'), '{ not json');
      expect(await readManifest(dir)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
