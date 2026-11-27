#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from './lib/proc.mjs';
import { discoverSkillRoots, nativeDelphiAgents } from './lib/agents.mjs';
import { defaultSource, syncSelf } from './lib/selfsync.mjs';
import { isDir } from './lib/util.mjs';
import { sweepLegacySelfCopy } from './lib/residue.mjs';
import { section, table, note } from './lib/report.mjs';

const selfDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeAll = args.includes('--include-all');
const source = defaultSource(selfDir);
const canonicalRoot = path.join(HOME, '.local', 'share', 'xp-gate', 'skills');

const allRoots = discoverSkillRoots();
const roots = (includeAll ? allRoots : allRoots.filter((r) => r.live)).map((r) => ({ ...r }));
if (!roots.some((r) => path.resolve(r.dir) === path.resolve(canonicalRoot))) {
  roots.push({ agent: 'canonical (installer)', dir: canonicalRoot, official: false, live: true });
}
const dead = allRoots.filter((r) => !r.live);

section(`分发 reinstall-xp-gate${dryRun ? '（dry-run）' : ''}`);
console.log(`  源: ${source}`);
if (!isDir(source)) {
  console.error(`  源目录不存在: ${source}`);
  process.exit(1);
}

const results = syncSelf({ source, roots, dryRun });
table(
  ['agent', 'live', 'state', 'dir'],
  results.map((r) => {
    const hit = allRoots.find((x) => x.dir === r.dir);
    return [r.agent, hit ? (hit.live ? 'yes' : 'no') : '-', r.state, r.dir];
  })
);

const pending = results.filter((r) => r.state !== 'ok' && r.state !== 'source');
if (dryRun) {
  note(`dry-run：${pending.length} 个副本待写入，未改盘。`);
} else {
  note(`已写入 ${pending.length} 个副本；内容与源一致的副本未被触碰。`);
  // The skill was renamed in 2.0.0. A copy under the old name is not in the
  // package any more, so nothing will ever update it again -- left alone it
  // stays in every agent root forever, still looking like a live skill. Swept
  // here, on every root including live ones, because pruneDeadRoots only ever
  // sees agents judged dead.
  const swept = roots.filter((r) => sweepLegacySelfCopy(r.dir) > 0).map((r) => r.agent);
  if (swept.length) note(`已清理旧名副本（xp-gate-reinstall）: ${swept.join(', ')}`);
}

if (dead.length) {
  section('已跳过（配置残留，agent 不在了）');
  table(['agent', 'reason', 'dir'], dead.map((r) => [r.agent, r.reason, r.dir]));
  note('确认仍是活的但被误判时，加 --include-all 强制分发。');
}

const natives = nativeDelphiAgents();
if (natives.length > 0) {
  note(`注意：检测到 ${natives.length} 个 Qoder 原生 Delphi agent（external-only 下应为 0），重装后由 verify 复核。`);
}
