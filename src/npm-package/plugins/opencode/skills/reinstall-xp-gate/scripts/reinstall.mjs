#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  HOME, packageDir, resetPackageDir, runNpm, xp, gitConfig, XP_GATE_SLOW_OP_TIMEOUT_MS,
} from './lib/proc.mjs';
import { discoverSkillRoots, hookTemplateDirs, nativeDelphiAgents } from './lib/agents.mjs';
import {
  bundledSkills, planSkillCopies, applySkillCopies, summarizeRows, skillsBackupRoot,
} from './lib/skills.mjs';
import {
  makeRunDir, snapshotConfig, collectBaseline, writeBaseline,
} from './lib/baseline.mjs';
import { toolReport, upgradeTool } from './lib/tools.mjs';
import { defaultSource, syncSelf } from './lib/selfsync.mjs';
import {
  backupThenRemove, hasXpGateMarker, scanSkillResidue, pruneDeadRoots,
} from './lib/residue.mjs';
import { hashTree, isDir, isFile, rmrf } from './lib/util.mjs';
import { section, item, table, note } from './lib/report.mjs';

const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const upgradeTools = args.includes('--upgrade-tools');
const cleanProjectHooks = args.includes('--clean-project-hooks');
const skipVerify = args.includes('--no-verify');
const dryRun = !apply;
const tag = dryRun ? '[dry]' : '[apply]';
const PKG = '@boyingliu01/xp-gate';

/** A full re-verification runs every check in turn: its own, longer budget. */
const VERIFY_TIMEOUT_MS = 600000;

function log(text) {
  console.log(`${tag} ${text}`);
}

function tail(result, max = 400) {
  const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return text.length > max ? `...${text.slice(-max)}` : text;
}

function abort(why) {
  console.error(`\n${tag} 中止：${why}`);
  process.exit(1);
}

/** Hooks xp-gate installs into a repo; only these are candidates for cleanup. */
const PROJECT_HOOK_NAMES = ['pre-commit', 'pre-push', 'post-merge', 'post-checkout', 'prepare-commit-msg'];

/** xp-gate hooks in THIS repo's .git/hooks (a bare xp-gate marker is the proof). */
function scanProjectHooks() {
  const hooksDir = path.join(process.cwd(), '.git', 'hooks');
  if (!isDir(hooksDir)) return [];
  return PROJECT_HOOK_NAMES.map((name) => path.join(hooksDir, name)).filter(isXpGateHook);
}

function isXpGateHook(file) {
  if (!isFile(file)) return false;
  try {
    return /xp-gate/i.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

section('0/6 基线快照');
let runDir = '';
if (apply) {
  runDir = makeRunDir();
  const copied = snapshotConfig(runDir);
  const baseline = collectBaseline();
  writeBaseline(runDir, baseline);
  log(`run 目录: ${runDir}`);
  log(`快照: ${copied.join(', ') || '(无配置文件)'}`);
  if (!copied.includes('.delphi-config.json')) {
    item('WARN', '没有 .delphi-config.json 快照 —— purge 后 Delphi 外部三席配置会丢失');
  }
} else {
  const baseline = collectBaseline();
  log(`当前 xp-gate ${baseline.xpGate.version || '(未安装)'} @ ${baseline.xpGate.packageDir || 'n/a'}`);
  log(`mode=${baseline.config.mode || 'n/a'} hooksPath=${baseline.config.hooksPath || '(未设置)'}`);
  log(`bundled skills=${baseline.bundledSkills.length} agents=${baseline.agents.length} nativeAgents=${baseline.nativeAgents.length}`);
}

const oldPkgDir = packageDir();
const oldNames = bundledSkills(oldPkgDir);
const oldHashes = new Map(oldNames.map((n) => [n, hashTree(path.join(oldPkgDir, 'skills', n))]));
const rootsBefore = discoverSkillRoots();
const residue = scanSkillResidue(rootsBefore, oldHashes);
const templateDirs = hookTemplateDirs(rootsBefore).filter(hasXpGateMarker);
const projectHooks = scanProjectHooks();

section('1/6 卸载旧版 + 清理残留');
log(`计划: xp-gate uninstall --global --purge --force`);
if (oldPkgDir) {
  log(`旧包: ${oldPkgDir} (${oldNames.length} 个 skills)`);
  log(`skill 残留: ${residue.identical.length} 个与旧包逐字节一致（可删），${residue.modified.length} 个已改动（保留并备份）`);
  for (const r of residue.modified) note(`${r.agent}: ${r.dir} 内容与旧包不同，保留`);
  log(`git-hooks-template 残留: ${templateDirs.length} 个`);
  for (const dir of templateDirs) note(dir);
  const natives = nativeDelphiAgents();
  log(`Qoder 原生 Delphi agent: ${natives.length} 个`);
  for (const file of natives) note(file);
  log(`项目内 xp-gate 钩子: ${projectHooks.length} 个${cleanProjectHooks ? '（--clean-project-hooks 将删除）' : '（默认保留，需 --clean-project-hooks）'}`);
  for (const file of projectHooks) note(file);
} else {
  log('未安装 xp-gate，按全新安装处理');
}

if (apply) {
  const un = xp(['uninstall', '--global', '--purge', '--force'], { timeout: XP_GATE_SLOW_OP_TIMEOUT_MS });
  log(`uninstall 退出码 ${un.status}`);
  if (un.status !== 0) {
    item('WARN', `uninstall 非 0 退出：${tail(un, 600)}`);
    if (!/uninstall|not installed|no .* config/i.test(tail(un, 2000))) {
      log('继续执行清理（卸载失败可能留下未清理项，verify 会复核）');
    }
  }

  for (const r of residue.identical) {
    backupThenRemove(r.dir, runDir, path.join('skills', `${r.agent}-${r.name}`));
  }
  log(`已删除并备份 skill 残留 ${residue.identical.length} 个`);

  for (const dir of templateDirs) {
    if (!isDir(dir)) continue;
    backupThenRemove(dir, runDir, path.join('templates', path.basename(path.dirname(dir)), 'git-hooks-template'));
  }

  for (const file of nativeDelphiAgents()) {
    backupThenRemove(file, runDir, path.join('qoder-agents', path.basename(file)), true);
  }

  if (cleanProjectHooks) {
    for (const file of projectHooks) {
      backupThenRemove(file, runDir, path.join('project-hooks', path.basename(file)), true);
    }
    log(`已删除项目钩子 ${projectHooks.length} 个`);
  }

  // purge 之后这两处应已消失；仍在说明卸载有缺口，先备份再删。
  const cfgDir = path.join(HOME, '.config', 'xp-gate');
  if (isDir(cfgDir)) {
    if (isFile(path.join(cfgDir, 'xp-gate.json'))) {
      backupThenRemove(cfgDir, runDir, 'leftover-config-dir');
      log(`清理 purge 未删除的 ${cfgDir}`);
    } else {
      item('WARN', `${cfgDir} 仍存在且无 xp-gate.json 标记，未删除，请人工确认`);
    }
  }
  const legacyDir = path.join(HOME, '.xp-gate');
  if (isDir(legacyDir)) {
    backupThenRemove(legacyDir, runDir, 'leftover-xp-gate-dir');
    log(`清理 purge 未删除的 ${legacyDir}`);
  }

  const unNpm = runNpm(['uninstall', '-g', PKG], { stdio: 'inherit', timeout: XP_GATE_SLOW_OP_TIMEOUT_MS });
  log(`npm uninstall -g 退出码 ${unNpm.status}`);
  resetPackageDir();
  if (oldPkgDir && isDir(oldPkgDir)) {
    rmrf(oldPkgDir);
    log(`npm 未删净，手动移除 ${oldPkgDir}`);
  }
}

section('2/6 安装最新版');
log(`npm install -g ${PKG}@latest`);
if (apply) {
  const snapDelphi = path.join(runDir, '.delphi-config.json');
  if (isFile(snapDelphi)) {
    const dest = path.join(HOME, '.config', 'xp-gate', '.delphi-config.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(snapDelphi, dest);
    log(`先恢复 ${dest}（init 依赖其中的 channels 决定是否部署原生 agent）`);
  }

  const latest = String(runNpm(['view', PKG, 'version'], { timeout: 60000 }).stdout || '').trim();
  if (latest) log(`registry latest = ${latest}`);

  const inst = runNpm(['install', '-g', `${PKG}@latest`], { stdio: 'inherit', timeout: 900000 });
  log(`npm install 退出码 ${inst.status}`);
  if (inst.status !== 0) abort('npm 安装最新版失败，旧版已被卸载；.delphi-config.json 在 ' + path.join(runDir, '.delphi-config.json'));
  resetPackageDir();

  const pkg = packageDir();
  const version = pkg ? JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version : '(未知)';
  log(`已安装 ${version} @ ${pkg}`);
  if (latest && version !== latest) item('WARN', `安装版本 ${version} 与 registry latest ${latest} 不一致`);

  const init = xp(['install', '--global'], { timeout: 900000 });
  log(`xp-gate install --global 退出码 ${init.status}（该命令恒返回 0，正确性由 verify 判定）`);
  if (init.status !== 0) log(tail(init, 800));

  const hooks = xp(['update-hooks', '--global'], { timeout: XP_GATE_SLOW_OP_TIMEOUT_MS });
  log(`xp-gate update-hooks --global 退出码 ${hooks.status}`);
  if (hooks.status !== 0) log(tail(hooks, 600));
}

section('3/6 依赖工具');
const toolRows = await toolReport();
table(
  ['tool', 'kind', 'installed', 'latest', 'status'],
  toolRows.map((r) => [r.name, r.kind, r.present ? r.version || '?' : '(missing)', r.latest || '?', r.status])
);
const outdated = toolRows.filter((r) => r.status === 'outdated');
const missing = toolRows.filter((r) => r.status === 'missing');
const unverified = toolRows.filter((r) => r.status === 'unverified');
if (missing.length) item('FAIL', `缺失 ${missing.length} 个: ${missing.map((r) => r.name).join(', ')}（运行 xp-gate install-tools 或手工安装）`);
if (unverified.length) item('WARN', `无法判定最新版 ${unverified.length} 个（网络或元数据不可达）`);
if (outdated.length && !upgradeTools) item('WARN', `${outdated.length} 个落后；加 --upgrade-tools 升级`);
if (apply && upgradeTools) {
  for (const row of outdated) {
    log(`升级 ${row.name} ${row.version} → ${row.latest}`);
    const code = upgradeTool(row);
    log(`  ${row.name} 退出码 ${code}`);
  }
}

section('4/6 分发 skills');
if (apply) {
  const pkg = packageDir();
  const allRoots = discoverSkillRoots();
  const roots = allRoots.filter((r) => r.live);
  const deadRoots = allRoots.filter((r) => !r.live);
  const { names } = planSkillCopies(pkg, roots);
  for (const name of names) {
    const r = xp(['install-skill', name, '--force'], { timeout: 240000 });
    log(`install-skill ${name} → 退出码 ${r.status}${r.status === 0 ? '' : ` (${tail(r, 200)})`}`);
  }

  const plan = planSkillCopies(pkg, roots);
  const pending = plan.rows.filter((row) => row.state !== 'ok');
  const touched = applySkillCopies(pending, { backupRoot: skillsBackupRoot(), dryRun: false });
  const summary = summarizeRows(planSkillCopies(pkg, roots).rows);
  table(['agent', 'total', 'ok', 'drift', 'missing'], [...summary.entries()].map(([a, s]) => [a, s.total, s.ok, s.drift, s.missing]));
  log(`直接补齐 ${touched.length} 个副本（漂移副本已备份到 ${skillsBackupRoot()}）`);

  const pruned = pruneDeadRoots(pkg, deadRoots);
  if (deadRoots.length) {
    log(`已跳过 ${deadRoots.length} 个残留配置目录，并清掉 ${pruned} 个被 CLI 误写入的副本`);
    for (const r of deadRoots) note(`${r.agent}: ${r.reason}`);
  }

  const selfRes = syncSelf({ source: defaultSource(skillRoot), roots, dryRun: false });
  log(`reinstall-xp-gate 同步: ${selfRes.filter((r) => r.state === 'new' || r.state === 'update').length} 个副本更新`);
} else {
  const pkg = packageDir();
  const allRoots = discoverSkillRoots();
  const roots = allRoots.filter((r) => r.live);
  const { rows } = planSkillCopies(pkg, roots);
  const summary = summarizeRows(rows);
  table(['agent', 'total', 'ok', 'drift', 'missing'], [...summary.entries()].map(([a, s]) => [a, s.total, s.ok, s.drift, s.missing]));
  const deadRoots = allRoots.filter((r) => !r.live);
  if (deadRoots.length) {
    note('以下残留目录不会分发，实际执行时还会清掉其中被 install-skill 误写入的副本：');
    for (const r of deadRoots) note(`${r.agent}: ${r.reason} (${r.dir})`);
  }
  log('dry-run 未执行 install-skill / 直拷');
}

section('5/6 插件与钩子（静态检查）');
console.log(`  core.hooksPath: ${gitConfig('core.hooksPath') || '(未设置)'}`);
for (const [label, file] of [
  ['OpenCode plugin', path.join(HOME, '.config', 'opencode', 'node_modules', '@boyingliu01', 'opencode-plugin', 'package.json')],
  ['DSH plugin', path.join(HOME, '.dsh', 'profiles', 'web', 'node_modules', '@boyingliu01', 'dsh-plugin-xp-gate', 'package.json')],
]) {
  if (!isFile(file)) {
    console.log(`  ${label}: 未安装`);
    continue;
  }
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    console.log(`  ${label}: ${v} (${file})`);
  } catch {
    console.log(`  ${label}: package.json 不可解析 (${file})`);
  }
}

section('6/6 验收');
if (skipVerify) {
  log('已跳过 verify（--no-verify）');
} else if (apply) {
  const verify = path.join(skillRoot, 'scripts', 'verify.mjs');
  const r = spawnSync(process.execPath, [verify], { stdio: 'inherit', timeout: VERIFY_TIMEOUT_MS });
  log(`verify 退出码 ${r.status}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
} else {
  log(`dry-run：实际执行后会运行 node "${path.join(skillRoot, 'scripts', 'verify.mjs')}"`);
}

if (!apply) {
  console.log('\n当前为 dry-run。确认无误后加 --apply 执行；加 --upgrade-tools 同时升级依赖工具。');
}
