#!/usr/bin/env node
import path from 'node:path';
import { HOME } from './lib/proc.mjs';
import { makeRunDir, snapshotConfig, collectBaseline, writeBaseline, runsRoot } from './lib/baseline.mjs';
import { section, item, table, note } from './lib/report.mjs';
import { isFile } from './lib/util.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

section('0/6 基线快照');
const runDir = dryRun ? path.join(runsRoot(), 'dry-run') : makeRunDir();
let copied = [];
if (dryRun) {
  note(`dry-run：不写入 ${runDir}`);
} else {
  copied = snapshotConfig(runDir);
}
const baseline = collectBaseline();
if (!dryRun) writeBaseline(runDir, baseline);

const cfgDir = path.join(HOME, '.config', 'xp-gate');
const delphiSnapshot = path.join(runDir, '.delphi-config.json');
if (!isFile(path.join(cfgDir, '.delphi-config.json'))) {
  item('WARN', '当前没有 .delphi-config.json —— 重装后 Delphi 外部三席配置需要重新提供');
} else if (dryRun) {
  item('INFO', '.delphi-config.json 存在，实际执行时会快照到 run 目录');
} else if (isFile(delphiSnapshot)) {
  item('PASS', `快照 .delphi-config.json → ${delphiSnapshot}`);
} else {
  item('FAIL', `快照失败：${delphiSnapshot} 不存在`);
}

if (!dryRun) {
  item('PASS', `baseline.json → ${path.join(runDir, 'baseline.json')}`);
  note(`本次 run 目录: ${runDir}`);
}

section('环境');
console.log(`  node          ${baseline.node}  (${baseline.nodePath})`);
console.log(`  npm           ${baseline.npm || '未探测到'}`);
console.log(`  xp-gate       ${baseline.xpGate.version || '未安装'}  (${baseline.xpGate.packageDir || 'n/a'})`);
console.log(`  mode          ${baseline.config.mode || 'n/a'}`);
console.log(`  templateDir   ${baseline.config.templateDir || 'n/a'}`);
console.log(`  core.hooksPath ${baseline.config.hooksPath || '(未设置)'}`);

section('Delphi');
console.log(`  channels      ${JSON.stringify(baseline.delphi.channels)}`);
console.log(`  pinned        ${baseline.delphi.pinned_models ? Object.keys(baseline.delphi.pinned_models).join(', ') : 'n/a'}`);
console.log(`  native agents ${baseline.nativeAgents.length}`);

section('Agent skill 根');
table(
  ['agent', 'live', 'official', 'reason', 'dir'],
  baseline.agents.map((a) => [a.agent, a.live ? 'yes' : 'no', a.official ? 'yes' : 'no', a.reason || '', a.dir])
);

section('当前 doctor');
if (baseline.doctor?.checks) {
  const fails = baseline.doctor.checks.filter((c) => String(c.status).toUpperCase() === 'FAIL');
  const warns = baseline.doctor.checks.filter((c) => String(c.status).toUpperCase() === 'WARN');
  console.log(`  ok=${baseline.doctor.ok}  issues=${baseline.doctor.issues}  FAIL=${fails.length}  WARN=${warns.length}`);
  for (const c of fails) console.log(`  [FAIL] ${c.name}: ${c.detail}`);
  for (const c of warns) console.log(`  [WARN] ${c.name}: ${c.detail}`);
} else {
  item('WARN', `doctor --json 未返回可解析结果: ${baseline.doctor?.error || 'unknown'}`);
}

section('发布包 skills');
console.log(`  ${baseline.bundledSkills.length} 个: ${baseline.bundledSkills.join(', ') || '(无)'}`);

if (copied.length > 0) {
  section('快照文件');
  for (const name of copied) item('PASS', path.join(runDir, name));
}
