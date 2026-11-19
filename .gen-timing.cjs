const fs = require('fs');
const MAXP = 7200000;
const lines = fs.readFileSync('.xp-gate/audit.jsonl', 'utf8').split('\n').filter(Boolean);
const by = {};
let excl = 0, tot = 0;
for (const l of lines) {
  let j; try { j = JSON.parse(l); } catch (e) { continue; }
  const g = j.gate_id || j.gateId;
  const d = j.duration_ms ?? j.durationMs;
  if (!g || typeof d !== 'number') continue;
  tot++;
  if (j.duration_anomaly === true || d < 0 || d > MAXP) { excl++; continue; }
  (by[g] = by[g] || []).push(d);
}
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))];
};
const rows = Object.entries(by).map(([g, a]) => ({
  g, n: a.length,
  p50: pct(a, .5), p90: pct(a, .9), p99: pct(a, .99), max: Math.max(...a),
}));
const total = rows.reduce((s, r) => s + r.p90, 0);
rows.sort((a, b) => b.p90 - a.p90);

let md = '# 门禁耗时基线\n\n';
md += '数据源 `.xp-gate/audit.jsonl`，带耗时的记录 ' + tot + ' 条。\n\n';
md += '已排除 **' + excl + '** 条异常（' + ((excl / tot) * 100).toFixed(1) + '%）：`duration_anomaly: true` 或耗时 > 2 小时。\n';
md += '这些是 `sanitize_start` 修复前产生的 epoch 型垃圾值（最晚一条 2026-10-19，11 月之后为零），\n';
md += '与 `src/npm-package/lib/gate-audit.ts` 的排除规则一致。**不排除会把 gate-1/gate-11 的 p90 算成 56 年。**\n\n';
md += '## 按 p90 排序\n\n';
md += '| 门禁 | 样本量 | p50 | p90 | p99 | max | p90 占比 |\n';
md += '|---|---|---|---|---|---|---|\n';
for (const r of rows) {
  const flag = r.n < 30 ? ' ⚠️' : '';
  md += '| ' + r.g + ' | ' + r.n + flag + ' | ' + r.p50 + ' | ' + r.p90 + ' | ' + r.p99 + ' | ' + r.max + ' | ' + ((r.p90 / total) * 100).toFixed(1) + '% |\n';
}
md += '\n⚠️ = 样本量 < 30，占比不可靠（样本少的门禁在 p90 占比里会被放大）。\n\n';

md += '## 当前实测（2026-11-20，单次）\n\n';
md += '| 门禁 | 实测 | 说明 |\n|---|---|---|\n';
md += '| gate-10 SAST | **4.8s** | 历史 p90 168s，规则集缓存生效后降 35 倍 |\n';

fs.writeFileSync('.timing.md', md);
console.log(md);
