import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isFile, stripNul } from './util.mjs';
import {
  comspecOf,
  isWindowsShim,
  WIN_WHERE,
  WIN_REG,
  parseWhichOutput,
  parseRegPathLine,
  expandRegistryPath,
} from './platform.mjs';

/**
 * Starting child processes, and asking them what they are.
 *
 * Split out of `proc.mjs` (Gate 4: 20 exports, maximum 10). Nothing here knows
 * about xp-gate or npm layout; it is the layer that runs a program and reads
 * its output, which is what the `run` family and the version probing need.
 */

/**
 * Budgets for the three kinds of child process this module starts.
 *
 * Named by INTENT, deliberately not by duration. A count of the literals used to
 * show 30s four times, but those four were unrelated decisions -- a node syntax
 * check and `npm root -g` happen to need the same number today while having
 * nothing to do with each other. Grouping them under one `TIMEOUT_30S` would
 * couple two changes that should stay independent.
 */
/** which / where / registry queries: a slow one means the tool is unusable. */
export const PROBE_TIMEOUT_MS = 10000;

/**
 * xp-gate mutations that rewrite the global install: uninstall --purge,
 * `npm uninstall -g`, `update-hooks`, `doctor`. They shell out to the same CLI
 * and are all slow for the same reason, so they share one budget.
 */
export const XP_GATE_SLOW_OP_TIMEOUT_MS = 300000;

let cachedPath = null;

/** Registry keys holding PATH, in append order. */
const REGISTRY_PATH_KEYS = [
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  'HKCU\\Environment',
];

/**
 * Windows GUI 进程和 Git Bash 的 PATH 经常是陈旧的；工具已安装但看不见。
 * 合并注册表 Machine/User PATH，探测工具时用这份。
 *
 * 从 Git Bash 启动时 node 往往不在 Windows PATH 上；npm 生成的 .cmd shim
 * 内部用 `node` 兜底，缺了它就会报 "'node' is not recognized"。所以 node 所在
 * 目录必须排在第一位。
 */
export function effectivePath() {
  if (cachedPath) return cachedPath;
  const parts = [path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)];
  if (process.platform === 'win32') {
    for (const key of REGISTRY_PATH_KEYS) parts.push(...expandRegistryPath(readRegPath(key)));
  }
  cachedPath = [...new Set(parts.filter(Boolean))].join(path.delimiter);
  return cachedPath;
}

export function envWithPath() {
  return { ...process.env, PATH: effectivePath() };
}

/**
 * Shared spawn options. `run` and `runNpm` used to inline the same nine-field
 * object, so adding a field (or fixing maxBuffer) had to be done twice and one
 * copy was always the copy that got forgotten.
 */
function spawnOpts(opts, defaultTimeout) {
  return {
    cwd: opts.cwd,
    timeout: opts.timeout ?? defaultTimeout,
    stdio: opts.stdio,
    encoding: opts.stdio ? undefined : 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: opts.env ?? envWithPath(),
  };
}

export function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, spawnOpts(opts, 120000));
}

/**
 * Windows 上直接 spawn .cmd/.bat 会 EINVAL；经 Git Bash 的 shell 执行 .cmd 又因
 * 反斜杠转义失败（现象：工具明明在，probe 拿不到任何输出）。固定走 cmd.exe。
 */
export function probe(cmdPath, args, opts = {}) {
  if (!isWindowsShim(cmdPath)) return run(cmdPath, args, opts);
  const env = opts.env ?? envWithPath();
  const line = `"${cmdPath}" ${args.map((a) => `"${a}"`).join(' ')}`;
  return spawnSync(comspecOf(env), ['/d', '/s', '/c', `"${line}"`], {
    windowsVerbatimArguments: true,
    timeout: opts.timeout ?? 15000,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env,
  });
}

export function which(tool) {
  if (process.platform === 'win32') {
    const r = run(WIN_WHERE, [tool], { timeout: PROBE_TIMEOUT_MS });
    if (r.status !== 0) return '';
    return parseWhichOutput(r.stdout);
  }
  const r = run('which', [tool], { timeout: PROBE_TIMEOUT_MS });
  return r.status === 0 ? String(r.stdout).trim() : '';
}

/** First non-empty line a tool prints for a version flag. */
function versionLine(resolved) {
  for (const flag of ['--version', '-v', '-V', 'version']) {
    const r = probe(resolved, [flag]);
    const first = stripNul(`${r.stdout || ''}${r.stderr || ''}`)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first) return first;
  }
  return '';
}

export function toolVersion(tool) {
  const resolved = which(tool);
  if (!resolved) return { path: '', version: '' };
  return { path: resolved, version: versionLine(resolved) };
}

/** `npm-cli.js` next to node, or ''. */
export function npmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find(isFile) || '';
}

export function runNpm(args, opts = {}) {
  const cli = npmCli();
  if (!cli) {
    return { status: 127, stdout: '', stderr: 'npm-cli.js not found next to node' };
  }
  return spawnSync(process.execPath, [cli, ...args], spawnOpts(opts, 180000));
}

/** The raw `Path` value of one registry environment key, or ''. */
function readRegPath(key) {
  if (!isFile(WIN_REG)) return '';
  const r = spawnSync(WIN_REG, ['query', key, '/v', 'Path'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  if (r.status !== 0) return '';
  return parseRegPathLine(r.stdout);
}
