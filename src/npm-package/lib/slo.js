/**
 * @test REQ-609 SLO 指标必须区分"达标"与"没有数据"
 * @intent 指南 §15 要求首构 ≥90%、终构 ≥98%、首测 ≥85%、Flaky ≤0.5%、
 *         CI 无效触发 ≤20%、文件丢失 = 0。
 *
 *         这个模块的**全部价值**在于三态判定，而不是六行数字：
 *
 *           PASS   有数据，且在目标内
 *           MISS   有数据，但在目标外          <- 唯一需要行动的
 *           UNKNOWN 数据不足，无从判断         <- 不是通过，也不是失败
 *
 *         为什么 UNKNOWN 必须独立存在：把"没有数据"折叠进 PASS 就是 #554 那一类
 *         缺陷（门禁没跑却报通过）；折叠进 MISS 则会让每一个新仓库一开始就六项
 *         全红，于是所有人都学会忽略这个面板——面板一旦被忽略，它就和不存在一样。
 *
 *         "文件丢失 = 0"尤其危险：它的目标值是 0，而没有数据时最自然的算法
 *         恰好也产出 0。所以这一项的 UNKNOWN 判定必须先于数值比较，而不是
 *         比较完之后再补一句注释。
 *
 *         每个 SLO 都带 `source`：没有指明数据来源的指标无法被核实，
 *         也就无法被信任。
 */
'use strict';

/** 六项 SLO 及其目标。方向决定比较运算符，避免手写每个分支。 */
const SLO_DEFINITIONS = [
  {
    id: 'first_build_pass',
    label: 'First-build pass rate',
    target: 90,
    unit: '%',
    direction: 'min',
    source: '.xp-gate/audit.jsonl + pre-commit reports',
    describe: 'first attempt of each gate run passes without a retry',
  },
  {
    id: 'final_build_pass',
    label: 'Final-build pass rate',
    target: 98,
    unit: '%',
    direction: 'min',
    source: '.xp-gate/audit.jsonl (last attempt per gate per commit)',
    describe: 'the attempt that actually lands passes',
  },
  {
    id: 'first_test_pass',
    label: 'First-test pass rate',
    target: 85,
    unit: '%',
    direction: 'min',
    source: '.xp-gate/audit.jsonl (Gate 5 first attempt)',
    describe: 'test suite passes on its first run in a commit',
  },
  {
    id: 'flaky_rate',
    label: 'Flaky rate',
    target: 0.5,
    unit: '%',
    direction: 'max',
    source: '.xp-gate/audit.jsonl re-run records',
    describe: 'a test that failed then passed on re-run without a code change',
  },
  {
    id: 'ci_wasted_trigger',
    label: 'CI wasted trigger rate',
    target: 20,
    unit: '%',
    direction: 'max',
    source: '.github workflow runs vs gate journal',
    describe: 'a CI run triggered by a commit that the gates had already rejected',
  },
  {
    id: 'file_loss',
    label: 'File loss events',
    target: 0,
    unit: '',
    direction: 'max',
    source: 'vitest-worktree-guard + git status snapshots',
    describe: 'tracked files disappearing during a run',
  },
];

const STATES = { PASS: 'PASS', MISS: 'MISS', UNKNOWN: 'UNKNOWN' };

/**
 * Evaluate one SLO sample.
 *
 * `value === null` / `undefined` means "no measurement", which is a different
 * claim from `value === 0`. Keeping them distinct is the whole point of this module.
 */
function evaluateSlo(id, value, opts = {}) {
  const def = SLO_DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown SLO id: ${id}`);

  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      ...def,
      value: null,
      state: STATES.UNKNOWN,
      reason: opts.reason || 'no measurement available in the reporting window',
    };
  }

  // File loss is the trap: its target is 0, and a naive max-direction comparison
  // (`0 <= 0`) reports PASS for a window that observed nothing. Requiring an
  // explicit sample count makes "we looked and saw none" different from "we did
  // not look".
  const samples = opts.samples;
  if (def.id === 'file_loss' && (samples === undefined || samples === null || samples <= 0)) {
    return {
      ...def,
      value: null,
      state: STATES.UNKNOWN,
      reason: 'no guard runs in the window -- absence of guards is not absence of loss',
    };
  }

  const pass = def.direction === 'min' ? value >= def.target : value <= def.target;
  return {
    ...def,
    value,
    sampleCount: samples,
    state: pass ? STATES.PASS : STATES.MISS,
    reason: pass ? '' : `${value}${def.unit} vs target ${def.direction === 'min' ? '>=' : '<='} ${def.target}${def.unit}`,
  };
}

/** Evaluate a whole batch of measurements (`{ id: value | {value,samples} }`). */
function evaluateAll(measurements = {}) {
  return SLO_DEFINITIONS.map((def) => {
    const raw = measurements[def.id];
    if (raw && typeof raw === 'object') return evaluateSlo(def.id, raw.value, raw);
    return evaluateSlo(def.id, raw);
  });
}

/** Count rows per state -- what a dashboard badge and a retro line both need. */
function summariseStates(rows) {
  const out = { PASS: 0, MISS: 0, UNKNOWN: 0, total: rows.length };
  for (const r of rows) out[r.state] += 1;
  return out;
}

module.exports = {
  SLO_DEFINITIONS,
  STATES,
  evaluateSlo,
  evaluateAll,
  summariseStates,
};
