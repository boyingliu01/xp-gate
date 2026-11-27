#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  HOME, packageDir, runNpm, xpJson, gitConfig, XP_GATE_SLOW_OP_TIMEOUT_MS,
} from './lib/proc.mjs';
import { discoverSkillRoots, nativeDelphiAgents, agentInstalled } from './lib/agents.mjs';
import { planSkillCopies, summarizeRows } from './lib/skills.mjs';
import { toolReport, cmpVersion } from './lib/tools.mjs';
import { readJson, isDir, isFile } from './lib/util.mjs';
import { delphiSeats, seatModel, distinctModels } from './lib/delphi.mjs';
import { section, table, note } from './lib/report.mjs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const asJson = args.includes('--json');
const checks = [];

function add(name, status, detail) {
  checks.push({ name, status, detail });
}

const pkg = packageDir();
const version = pkg ? readJson(path.join(pkg, 'package.json'))?.version || '' : '';
if (!pkg || !version) {
  add('npm package', 'FAIL', '未找到全局安装的 @boyingliu01/xp-gate');
} else {
  add('npm package', 'PASS', `${version} @ ${pkg}`);
}

if (!quick && version) {
  const latest = String(runNpm(['view', '@boyingliu01/xp-gate', 'version'], { timeout: 60000 }).stdout || '').trim();
  if (!latest) add('registry latest', 'WARN', '无法查询 npm registry（离线？）');
  else if (cmpVersion(version, latest) < 0) add('registry latest', 'FAIL', `已安装 ${version}，latest ${latest}`);
  else add('registry latest', 'PASS', `已安装 ${version} = latest ${latest}`);
}

const cfgDir = path.join(HOME, '.config', 'xp-gate');
const cfg = readJson(path.join(cfgDir, 'xp-gate.json'));
if (!cfg) {
  add('config', 'FAIL', `${path.join(cfgDir, 'xp-gate.json')} 不存在`);
} else if (cfg.mode !== 'global') {
  add('config', 'FAIL', `mode=${cfg.mode || '(空)'}，全局安装后应为 global（hint: xp-gate install --global）`);
} else {
  add('config', 'PASS', `mode=global templateDir=${cfg.templateDir || 'n/a'}`);
}

const hooksPath = gitConfig('core.hooksPath');
if (!hooksPath) {
  add('core.hooksPath', 'FAIL', '未设置；init 未生效');
} else if (!isDir(hooksPath)) {
  add('core.hooksPath', 'FAIL', `${hooksPath} 不存在`);
} else {
  const required = ['pre-commit', 'pre-push', 'post-merge'];
  const missing = required.filter((n) => !isFile(path.join(hooksPath, n)));
  if (missing.length) add('hooks', 'FAIL', `${hooksPath} 缺少 ${missing.join(', ')}`);
  else add('hooks', 'PASS', `${hooksPath} 含 ${required.join('/')}`);
}

/**
 * A doctor check that can only ever fail because an agent is not installed.
 *
 * `doctor-tui.js` requires `~/.config/opencode/tui.json` unconditionally and
 * reports "TUI registration: FAIL / Not registered" when it is absent, without
 * checking whether OpenCode exists. After OpenCode is removed that check is
 * unsatisfiable by design: the only way to pass it is to reinstall the editor
 * the user deleted. Reporting it as a failure would make this audit
 * permanently red for a correct configuration, and quietly PASSing it would
 * hide a real misconfiguration on a machine that DOES use OpenCode -- which is
 * why the branch is gated on the CLI actually being absent.
 */
function isVacuousForMissingAgent(check) {
  return /TUI registration/i.test(String(check.name)) && !agentInstalled('OpenCode');
}

const doctor = xpJson(['doctor', '--json'], { timeout: XP_GATE_SLOW_OP_TIMEOUT_MS });
if (!doctor.json?.checks) {
  add('doctor', 'FAIL', `doctor --json 无输出: ${String(doctor.stderr || '').slice(0, 200)}`);
} else {
  const fails = doctor.json.checks
    .filter((c) => String(c.status).toUpperCase() === 'FAIL')
    .filter((c) => !isVacuousForMissingAgent(c));
  const warns = doctor.json.checks.filter((c) => String(c.status).toUpperCase() === 'WARN');
  const dropped = doctor.json.checks
    .filter((c) => String(c.status).toUpperCase() === 'FAIL')
    .filter((c) => isVacuousForMissingAgent(c));
  if (dropped.length) {
    // Named out loud rather than silently dropped: "we ignored a FAIL" must be
    // visible, or the next reader cannot tell a tolerated gap from a clean run.
    add('doctor (not applicable)', 'SKIP', dropped.map((c) => `${c.name}: ${c.detail} — OpenCode 未安装`).join(' | '));
  }
  if (fails.length) add('doctor', 'FAIL', fails.map((c) => `${c.name}: ${c.detail}`).join(' | '));
  else add('doctor', warns.length ? 'WARN' : 'PASS', warns.length ? warns.map((c) => `${c.name}: ${c.detail}`).join(' | ') : `ok=${doctor.json.ok}`);
}

const delphi = readJson(path.join(cfgDir, '.delphi-config.json'));
if (!delphi) {
  add('delphi config', 'FAIL', `${path.join(cfgDir, '.delphi-config.json')} 不存在（purge 后未恢复？）`);
} else {
  const channels = delphi.channels || [];
  // Seats come from profiles[active_profile].experts, which is the shipped
  // shape; a legacy top-level `pinned_models` is still accepted. See
  // lib/delphi.mjs for why reading only `pinned_models` reported "0 席" for a
  // valid config and left every verify run permanently red.
  const seats = delphiSeats(delphi);
  const distinct = distinctModels(seats);
  const where = delphi.active_profile
    ? `profiles.${delphi.active_profile}.experts`
    : 'pinned_models';
  if (!channels.includes('external')) add('delphi channels', 'FAIL', `channels=${JSON.stringify(channels)}，缺少 external`);
  else add('delphi channels', 'PASS', JSON.stringify(channels));
  if (seats.length < 3) add('delphi pinned seats', 'FAIL', `只有 ${seats.length} 席（期望 3 席，取自 ${where}）`);
  else if (distinct.size < 3) add('delphi pinned seats', 'FAIL', `${seats.length} 席但只有 ${distinct.size} 个不同模型`);
  else add('delphi pinned seats', 'PASS', seats.map(([k, v]) => `${k}=${seatModel(v)}`).join(', '));
}

const natives = nativeDelphiAgents();
if (natives.length) add('native delphi agents', 'FAIL', `${natives.length} 个原生 agent 仍在: ${natives.join(', ')}（external-only 下应为 0）`);
else add('native delphi agents', 'PASS', '0');

const allRoots = discoverSkillRoots();
const roots = allRoots.filter((r) => r.live);
const deadRoots = allRoots.filter((r) => !r.live);
if (!pkg) {
  add('skills parity', 'FAIL', '无发布包，无法比对');
} else if (roots.length === 0) {
  add('skills parity', 'FAIL', '没有判定为活的 agent skills 根');
} else {
  const { names, rows } = planSkillCopies(pkg, roots);
  const summary = summarizeRows(rows);
  const bad = [...summary.entries()].filter(([, s]) => s.drift || s.missing);
  // `extra` is not damage: every shipped file matched, the copy simply carries
  // files the package does not ship. ~/xp-gate/skills is a source checkout that
  // legitimately keeps its own __tests__/, and calling that FAIL left verify
  // permanently red on a correct install. Reported so it stays visible.
  const extraneous = rows.filter((r) => r.state === 'extra');
  if (bad.length) {
    add('skills parity', 'FAIL', `${bad.map(([a, s]) => `${a}(drift=${s.drift},missing=${s.missing})`).join('; ')}`);
  } else if (extraneous.length) {
    const detail = extraneous.map((r) => `${r.agent}/${r.name}: ${r.extra.join(', ')}`).join('; ');
    add('skills parity', 'WARN', `${names.length} skills × ${roots.length} agents 内容一致，但副本多了包内没有的文件: ${detail}`);
  } else {
    add('skills parity', 'PASS', `${names.length} skills × ${roots.length} agents 全部一致`);
  }

  const selfMissing = roots.filter((r) => !isFile(path.join(r.dir, 'reinstall-xp-gate', 'SKILL.md')));
  if (selfMissing.length) add('reinstall-xp-gate copy', 'WARN', `以下 agent 未分发: ${selfMissing.map((r) => r.agent).join(', ')}`);
  else add('reinstall-xp-gate copy', 'PASS', `${roots.length} 个 agent 根均已分发`);
}

if (deadRoots.length) {
  add('inactive agent roots', 'WARN', `${deadRoots.length} 个配置目录已判残留（未计入验收）: ${deadRoots.map((r) => `${r.agent}(${r.reason})`).join(', ')}`);
} else {
  add('inactive agent roots', 'PASS', '无残留配置目录');
}

const opencodeRoot = roots.find((r) => r.dir === path.join(HOME, '.config', 'opencode', 'skills'));
const opencodePkg = path.join(HOME, '.config', 'opencode', 'node_modules', '@boyingliu01', 'opencode-plugin', 'package.json');
if (isFile(opencodePkg)) {
  const v = readJson(opencodePkg)?.version || '';
  add('opencode plugin', v === version ? 'PASS' : 'FAIL', `plugin ${v || '?'} vs cli ${version}`);
} else if (opencodeRoot) {
  add('opencode plugin', 'WARN', `未安装 ${opencodePkg}（该 agent 的插件能力不可用）`);
} else {
  add('opencode plugin', 'SKIP', '未检测到 OpenCode');
}

const dshBase = path.join(HOME, '.dsh', 'profiles');
const dshHits = [];
if (isDir(dshBase)) {
  for (const entry of fs.readdirSync(dshBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dshBase, entry.name, 'node_modules', '@boyingliu01', 'dsh-plugin-xp-gate', 'package.json');
    if (isFile(file)) dshHits.push({ profile: entry.name, version: readJson(file)?.version || '' });
  }
}
if (!dshHits.length) add('dsh plugin', 'SKIP', '未检测到 DSH profile 插件');
else {
  const bad = dshHits.filter((h) => h.version !== version);
  add('dsh plugin', bad.length ? 'FAIL' : 'PASS', dshHits.map((h) => `${h.profile}=${h.version}`).join(', ') + ` vs cli ${version}`);
}

if (quick) {
  add('gate tools', 'SKIP', '--quick 跳过');
} else {
  const rows = await toolReport();
  const missing = rows.filter((r) => r.status === 'missing');
  const outdated = rows.filter((r) => r.status === 'outdated');
  const unverified = rows.filter((r) => r.status === 'unverified');
  if (missing.length) add('gate tools', 'FAIL', `缺失: ${missing.map((r) => r.name).join(', ')}`);
  else if (outdated.length) add('gate tools', 'WARN', `落后: ${outdated.map((r) => `${r.name} ${r.version}->${r.latest}`).join(', ')}`);
  else add('gate tools', 'PASS', rows.map((r) => `${r.name} ${r.version || '?'}`).join(', '));
  if (unverified.length && !missing.length && !outdated.length) note(`无法判定最新版: ${unverified.map((r) => r.name).join(', ')}`);
}

const uninstallBackup = path.join(cfgDir, '.uninstall-backup');
if (isDir(uninstallBackup)) {
  const count = fs.readdirSync(uninstallBackup).length;
  add('uninstall residue', 'FAIL', `${uninstallBackup} 仍有 ${count} 份历史快照`);
} else {
  add('uninstall residue', 'PASS', '无 .uninstall-backup');
}
const skillBackup = path.join(cfgDir, 'backup');
if (isDir(skillBackup)) {
  add('skill backup dir', 'WARN', `${skillBackup} 存在（install-skill 覆盖备份，可人工清理）`);
} else {
  add('skill backup dir', 'PASS', '无覆盖备份残留');
}

if (asJson) {
  console.log(JSON.stringify({ ok: !checks.some((c) => c.status === 'FAIL'), checks }, null, 2));
} else {
  section('验收结果');
  table(['status', 'check', 'detail'], checks.map((c) => [c.status, c.name, c.detail]));
  const fails = checks.filter((c) => c.status === 'FAIL').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  console.log(`\n  FAIL=${fails} WARN=${warns} PASS=${checks.filter((c) => c.status === 'PASS').length} SKIP=${checks.filter((c) => c.status === 'SKIP').length}`);
  if (fails === 0) console.log('  结论：静态验收通过；真实提交与 delphi-review 冒烟仍需人工各跑一次。');
  else console.log('  结论：存在 FAIL，按上面 detail 修复后重跑 verify。');
}

process.exit(checks.some((c) => c.status === 'FAIL') ? 1 : 0);
