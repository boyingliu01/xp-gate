import path from 'node:path';
import { isDir } from './util.mjs';
import { run, runNpm } from './spawn.mjs';
import { HOME } from './platform.mjs';

/**
 * Locating the installed xp-gate, and invoking it.
 *
 * Split out of `proc.mjs` (Gate 4: 20 exports, maximum 10). This is the part
 * that knows xp-gate's package layout, which has nothing to do with running
 * child processes in general nor with platform differences.
 */

const XP_GATE_SCOPE = '@boyingliu01';
const XP_GATE_PKG = 'xp-gate';

let cachedPkgDir;

export function resetPackageDir() {
  cachedPkgDir = undefined;
}

/** Every place a global `@boyingliu01/xp-gate` install can live, in precedence order. */
function packageCandidates() {
  const roots = [];
  const globalRoot = runNpm(['root', '-g'], { timeout: 30000 });
  if (globalRoot.status === 0) roots.push(String(globalRoot.stdout).trim());
  roots.push(path.join(HOME, 'AppData', 'Roaming', 'npm', 'node_modules'));
  return roots.filter(Boolean).map((base) => path.join(base, XP_GATE_SCOPE, XP_GATE_PKG));
}

export function packageDir() {
  if (cachedPkgDir !== undefined) return cachedPkgDir;
  const override = process.env.XP_GATE_PACKAGE_DIR;
  if (override && isDir(override)) {
    cachedPkgDir = override;
    return cachedPkgDir;
  }
  cachedPkgDir = packageCandidates().find(isDir) || '';
  return cachedPkgDir;
}

export function xp(args, opts = {}) {
  const pkg = packageDir();
  if (pkg) {
    return run(process.execPath, [path.join(pkg, 'bin', 'xp-gate.js'), ...args], opts);
  }
  const bin = process.platform === 'win32' ? 'xp-gate.cmd' : 'xp-gate';
  return run(bin, args, { ...opts, shell: process.platform === 'win32' });
}

export function xpJson(args, opts = {}) {
  const r = xp(args, { timeout: opts.timeout ?? 240000 });
  let json = null;
  try {
    json = JSON.parse(String(r.stdout || ''));
  } catch {
    json = null;
  }
  return { ...r, json };
}

export function gitConfig(key) {
  const r = run('git', ['config', '--global', key], { timeout: 15000 });
  return r.status === 0 ? String(r.stdout).trim() : '';
}
