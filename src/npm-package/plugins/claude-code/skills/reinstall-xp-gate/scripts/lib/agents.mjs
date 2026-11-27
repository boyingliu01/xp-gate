import fs from 'node:fs';
import path from 'node:path';
import { HOME, which } from './proc.mjs';
import { isDir } from './util.mjs';
import { relToHome, agentHomeFor, labelFor, isOfficialSkillRoot } from './agent-paths.mjs';

/** 桌面/IDE 安装目录：存在即说明 agent 还在用（配置目录卸载后常残留）。 */
const APP_PROBES = {
  Qoder: ['AppData/Local/Programs/Qoder', 'AppData/Local/Qoder'],
  'Qoder CN': ['AppData/Local/Qoder CN'],
  Trae: ['AppData/Local/Programs/Trae'],
  'Trae CN': ['AppData/Local/Programs/Trae CN', 'AppData/Local/Programs/TRAE SOLO CN'],
  WorkBuddy: ['AppData/Local/WorkBuddy', 'AppData/Local/@genieworkbuddy-desktop-updater'],
  CodeBuddy: ['AppData/Local/CodeBuddyExtension'],
  'Doubao Work': ['AppData/Local/DoubaoWork'],
};

/** CLI 类 agent：能从合并后的 PATH 解析到可执行文件才算还活着。 */
const CLI_PROBES = {
  'Claude Code': 'claude',
  Codex: 'codex',
  OpenCode: 'opencode',
  Cline: 'cline',
  CodeBuddy: 'codebuddy',
  DSH: 'dsh',
  DWS: 'dws',
  Pi: 'pi',
};

/** 多 agent 共用的技能仓库，不是某个 agent 的配置目录。 */
const SHARED_ROOTS = new Set(['.agents/skills']);
const cliCache = new Map();

const BACKUP_RE = /(^|[\\/])[^\\/]*(backup|bak|old|archive|snapshot|migration)[^\\/]*([\\/]|$)/i;
const SKIP_RE = /(^|[\\/])(node_modules|\.git|\.pnpm|skills-marketplace|connectors)([\\/]|$)/i;

/** Qoder's own Delphi agent files: `delphi-<seat>.md` in an `agents/` directory. */
const DELPHI_AGENT_RE = /^delphi-.*\.md$/i;

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * 三级判活的证据之一：桌面/IDE 安装目录存在即说明 agent 还在用。
 * @returns {string} 命中的绝对路径，未命中返回空串
 */
function appEvidence(agent) {
  const relApp = (APP_PROBES[agent] || []).map((rel) => path.join(HOME, rel)).find(isDir);
  return relApp || '';
}

/**
 * 证据之二：CLI 能从合并后的 PATH 解析到。结果进缓存，因为 discoverSkillRoots
 * 会对同一批 agent 反复调用，每次都 spawn 一次 where.exe 很慢。
 * @returns {string} 可执行文件路径，未命中返回空串
 */
function cliEvidence(agent) {
  const cli = CLI_PROBES[agent];
  if (!cli) return '';
  if (!cliCache.has(cli)) cliCache.set(cli, which(cli));
  return cliCache.get(cli);
}

/**
 * Whether an agent's CLI resolves on PATH right now.
 *
 * Needed because xp-gate's doctor hard-requires artefacts for agents that may
 * simply not be installed: `doctor-tui.js` reports
 * `TUI registration: FAIL / Not registered` whenever
 * `~/.config/opencode/tui.json` is missing, without ever asking whether
 * OpenCode exists. On a machine that has removed OpenCode the check is
 * unsatisfiable by design -- the only way to "fix" it would be to reinstall the
 * editor the user just deleted. Callers use this to report "not applicable"
 * instead of inventing a failure.
 *
 * @returns {boolean} true when the CLI resolves
 */
export function agentInstalled(agent) {
  return Boolean(cliEvidence(agent));
}

/**
 * 证据之三：agent 配置目录近 N 天有写入。DSH 这类二进制不在 PATH 上的情况
 * 只能靠它兜底。
 * @returns {number} 距今天数；目录不可读时返回 Infinity
 */
export function idleDays(skillRoot) {
  return daysSinceWrite(agentHomeFor(skillRoot));
}

/** Days since `dir` was last written, or Infinity when it cannot be read. */
function daysSinceWrite(dir) {
  let mtime = 0;
  try {
    mtime = fs.statSync(dir).mtimeMs;
  } catch {
    /* 目录不可读按残留处理 */
  }
  return mtime ? Math.max(0, Math.floor((Date.now() - mtime) / 86400000)) : Infinity;
}

/** Format an idle-day count for the report; Infinity is not a number a human can read. */
function describeIdle(days) {
  return Number.isFinite(days) ? `${days}d` : 'unknown';
}

/**
 * 目录存在 ≠ agent 还在用：卸载后配置目录与 skills/ 会长期残留。
 * 判活按「桌面安装目录 > CLI 可解析 > 配置目录近 N 天有写入」三级证据依次
 * 短路，三级都不成立才判为残留。
 */
export function probeLiveness(entry, liveDays = 30, homeFor = agentHomeFor) {
  const evidence = [
    () => (SHARED_ROOTS.has(relToHome(entry.dir)) ? 'shared skill store' : ''),
    () => wrap('app', appEvidence(entry.agent)),
    () => wrap('cli', cliEvidence(entry.agent)),
    () => recency(entry.dir, liveDays, homeFor),
  ];
  for (const probe of evidence) {
    const reason = probe();
    if (reason) return { live: true, reason };
  }
  return { live: false, reason: `no app/cli, idle ${describeIdle(idleDays(entry.dir))}` };
}

/** Prefix a non-empty evidence path, or return '' so the next probe runs. */
function wrap(kind, value) {
  return value ? `${kind}: ${value}` : '';
}

/**
 * Names xp-gate itself writes into an agent home.
 *
 * `tui.json` is the plugin registration, `skills` is where this skill and the
 * published bundle land. Anything else in the directory was put there by the
 * agent or its user.
 */
const SELF_WRITTEN = new Set(['tui.json', 'skills']);

/**
 * True when an agent home contains only files this toolchain wrote.
 *
 * Issue #4: recency reads the home's mtime, and creating tui.json or skills/
 * refreshes it. An uninstalled OpenCode then looks active forever, because the
 * evidence of use is the checker's own writes. A home holding nothing else is
 * residue, not a sign the user came back.
 */
export function selfWrittenHome(dir) {
  const names = safeReaddir(dir).map((entry) => entry.name);
  return names.length > 0 && names.every((name) => SELF_WRITTEN.has(name));
}

/** Third evidence tier: the config dir was written recently enough to count as live. */
function recency(dir, liveDays, homeFor = agentHomeFor) {
  const home = homeFor(dir);
  if (selfWrittenHome(home)) return '';
  const days = daysSinceWrite(home);
  return days <= liveDays ? `active ${days}d ago` : '';
}

function isDirEntry(entry) {
  return entry.isDirectory() || entry.isSymbolicLink();
}

/**
 * 扫描规则只依赖「<root>/<name>/SKILL.md」这个通用约定：
 *  - ~/<dir>/skills
 *  - ~/<dir>/agent/skills
 *  - ~/.config/<dir>/skills
 * 新 agent 不需要改代码；备份目录与 marketplace/connectors 自动排除。
 */
export function discoverSkillRoots({ liveDays = 30 } = {}) {
  const found = new Map();
  for (const dir of candidateRoots()) {
    const described = describeRoot(dir, liveDays);
    if (described) found.set(described.abs, described.root);
  }
  return [...found.values()].sort((a, b) => a.agent.localeCompare(b.agent, 'en'));
}

/** Every `skills/` directory the three documented patterns can produce. */
function candidateRoots() {
  const bases = safeReaddir(HOME).filter(isDirEntry).map((e) => path.join(HOME, e.name));
  const configDir = path.join(HOME, '.config');
  const configs = safeReaddir(configDir).filter(isDirEntry).map((e) => path.join(configDir, e.name, 'skills'));
  return [
    ...bases.flatMap((base) => [path.join(base, 'skills'), path.join(base, 'agent', 'skills')]),
    ...configs,
  ];
}

/**
 * Decide whether one candidate path is a skill root, and whether it is live.
 * Returns null for paths the filters exclude (backups, marketplaces, non-dirs).
 * @returns {{abs:string, root:object}|null}
 */
/**
 * 空目录也算：新装的 agent 常常先建好 skills/ 但还没有内容，恰恰是最需要分发的地方。
 * 路径本身已由三条固定模式产生，不会误扫用户数据目录。
 */
function looksLikeSkillRoot(dir) {
  return isDir(dir);
}

function describeRoot(dir, liveDays) {
  const abs = path.resolve(dir);
  if (BACKUP_RE.test(abs) || SKIP_RE.test(abs) || !looksLikeSkillRoot(abs)) return null;
  const entry = { agent: labelFor(abs), dir: abs, official: isOfficialSkillRoot(abs) };
  return { abs, root: { ...entry, ...probeLiveness(entry, liveDays) } };
}

/** Qoder 原生 Delphi agent（external-only 下应为 0）。 */
export function nativeDelphiAgents() {
  return delphiAgentDirs().flatMap((dir) => safeReaddir(dir)
    .filter((e) => e.isFile() && DELPHI_AGENT_RE.test(e.name))
    .map((e) => path.join(dir, e.name)));
}

/**
 * The `delphi-*.md` files Qoder deploys itself. `install` writes these when the
 * config asks for native Delphi seats; the external-only profile must have none.
 */
function delphiAgentDirs() {
  return ['.qoder', '.qoder-cn'].map((base) => path.join(HOME, base, 'agents'));
}

/** 每个 agent 可能存在的本地 hooks 模板目录。 */
export function hookTemplateDirs(roots) {
  const dirs = new Set([
    ...roots.map((root) => path.join(path.dirname(root.dir), 'git-hooks-template')),
    path.join(HOME, '.qoder', 'git-hooks-template'),
    path.join(HOME, '.config', 'opencode', 'git-hooks-template'),
  ]);
  return [...dirs].filter(isDir);
}

// Labels, official roots and the HOME-relative path helpers live in
// `agent-paths.mjs`; re-exported so `agents.mjs` stays one import for a caller
// asking about agents.
export {
  OFFICIAL_ROOTS, relToHome, labelFor, isOfficialSkillRoot, agentHomeFor,
} from './agent-paths.mjs';
