import path from 'node:path';
import { HOME } from './proc.mjs';
import { isDir } from './util.mjs';

/**
 * Turning a skills directory into a human label, and back into the agent's home.
 *
 * Split out of `agents.mjs` (Gate 4: 11 exports, maximum 10). These are pure
 * path questions -- no probing, no spawning, nothing that needs the liveness
 * machinery -- so they can be reasoned about on their own.
 */

/**
 * Agent labels for every config directory this skill knows about.
 *
 * These are DIRECTORY names, so they are matched case-insensitively against a
 * path relative to HOME. Adding an agent here is what makes it report as
 * "Trae CN" instead of "trae cn".
 */
const KNOWN_LABELS = {
  '.agents': 'Generic agents',
  '.claude': 'Claude Code',
  '.cline': 'Cline',
  '.codebuddy': 'CodeBuddy',
  '.codex': 'Codex',
  '.config/opencode': 'OpenCode',
  '.dsh': 'DSH',
  '.dws': 'DWS',
  '.pi/agent': 'Pi',
  '.qoder': 'Qoder',
  '.qoder-cn': 'Qoder CN',
  '.trae': 'Trae',
  '.trae-cn': 'Trae CN',
  '.trae-aicc': 'Trae AICC',
  '.workbuddy': 'WorkBuddy',
  doubaowork: 'Doubao Work',
};

/** xp-gate 的 installer 本身认识的平台；其余 agent 由本脚本直接复制。 */
export const OFFICIAL_ROOTS = new Set([
  '.qoder/skills',
  '.claude/skills',
  '.config/opencode/skills',
  '.dsh/skills',
]);


/** Path relative to HOME with forward slashes, which is what the tables use. */
export function relToHome(abs) {
  return path.relative(HOME, abs).split(path.sep).join('/');
}

export function labelFor(skillRoot) {
  const base = relToHome(skillRoot).replace(/\/skills$/, '');
  return KNOWN_LABELS[base.toLowerCase()] || base.replace(/^\./, '').replace(/[/-]+/g, ' ');
}

export function isOfficialSkillRoot(skillRoot) {
  return OFFICIAL_ROOTS.has(relToHome(skillRoot));
}

export function agentHomeFor(skillRoot) {
  const parts = path.relative(HOME, skillRoot).split(path.sep);
  return parts[0] === '.config' && parts.length > 2
    ? path.join(HOME, parts[0], parts[1])
    : path.join(HOME, parts[0]);
}
