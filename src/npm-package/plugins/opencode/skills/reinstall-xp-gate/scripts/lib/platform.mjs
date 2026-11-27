import os from 'node:os';
import { isFile, stripNul } from './util.mjs';

/**
 * Platform abstraction: where a process actually runs, and what Windows changes
 * about that.
 *
 * Split out of `proc.mjs`, which Gate 4 flagged for owning 20 exports. Three
 * unrelated jobs had grown there -- starting child processes, locating the
 * xp-gate launcher, and abstracting the platform -- and this is the third. It
 * imports nothing that spawns, so it stays a leaf: `spawn.mjs` depends on this,
 * never the reverse.
 */

export const HOME = os.homedir();

/** Windows tool locations that are on PATH only by convention, never by lookup. */
export const WIN_REG = 'C:\\Windows\\System32\\reg.exe';
export const WIN_WHERE = 'C:\\Windows\\System32\\where.exe';

/** PATHEXT entries npm shims can hide behind (`jscpd` -> `jscpd.cmd`). */
const WIN_EXTS = ['.exe', '.cmd', '.bat', '.com'];

/**
 * Run `fn` as if the process were running on `platform`.
 *
 * WHY THIS EXISTS: `process.platform` is frozen at startup, so every Windows
 * branch below (registry PATH, the `where` parser, comspec routing, PATHEXT
 * lookup) was unreachable from Linux and untestable from Windows. The dev box
 * moved to WSL, which would have quietly deleted the only coverage those
 * branches ever had -- the exact way platform code rots.
 *
 * Shadowing the property for the duration of the call keeps the branch decision
 * an argument without changing any call site, and the original descriptor is
 * restored in `finally` so a throwing callback cannot leak a fake platform into
 * the rest of the process.
 */
export function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

/** True for an npm shim that only runs through cmd.exe (`.cmd` / `.bat`). */
export function isWindowsShim(cmdPath) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmdPath);
}

/** The interpreter that runs .cmd shims, honouring an explicit ComSpec. */
export function comspecOf(env) {
  return env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
}

/** `    Path    REG_EXPAND_SZ    C:\a;C:\b` -> `C:\a;C:\b` */
export function parseRegPathLine(stdout) {
  const line = stripNul(stdout || '').split(/\r?\n/).find((l) => /Path\s+REG_/.test(l));
  const m = line && line.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/);
  return m ? m[1].trim() : '';
}

/** Split a `;`-separated registry value and expand its `%VAR%` references. */
export function expandRegistryPath(chunk) {
  return String(chunk || '')
    .split(';')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => seg.replace(/%([^%]+)%/g, (_, name) => process.env[name] || ''));
}

export function firstExisting(base) {
  if (isFile(base)) return base;
  if (process.platform !== 'win32') return '';
  return WIN_EXTS.map((ext) => base + ext).find(isFile) || '';
}

/**
 * Pick the first runnable path out of `where <tool>` output.
 *
 * `where` prints every match on its own CRLF-terminated line, and on Windows the
 * first one is often npm's extensionless shell shim, which spawnSync cannot
 * execute (ENOENT). So each line is resolved through `firstExisting` and the
 * first that resolves wins. `exists` is injectable so the fall-through is
 * testable from Linux.
 */
export function parseWhichOutput(stdout, exists = firstExisting) {
  const lines = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines.map(exists).find(Boolean) || '';
}
