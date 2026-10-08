/**
 * @test REQ-495 the JS mirror of the hook's module lookup must be reconciled against the bash original
 * @intent #495 的修复把 pre-commit 的 flat-优先-nested 解析顺序用 JavaScript 重写了一份
 *         （doctor.js listExecutedModules）。本仓库在本批次已经示范过正确范式：
 *         src/mutation/__tests__/test-filter-parity.test.ts（AC-480-04）把 bash 与 TS
 *         两份"非生产代码定义"钉成同一文本。跨语言的解析顺序同样不能靠注释宣称一致：
 *         hook 侧一旦演化，doctor 就会镜像旧秩序，"doctor 全绿、执行面另起炉灶"重现。
 *         因此这里直接抽取 pre-commit 的 resolve_adapter_path 函数体，交给 bash 执行，
 *         与 doctor 的 listExecutedModules 在同一棵合成目录树上逐模块对账。
 * @covers AC-495-11, AC-495-12
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const PRE_COMMIT = readFileSync(resolve(__dirname, '..', '..', '..', '..', 'githooks', 'pre-commit'), 'utf8');

/**
 * Extract one bash function's full text, brace-balanced from the declaration.
 */
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  expect(start, `pre-commit no longer declares ${signature}`).toBeGreaterThan(-1);
  let depth = 0;
  let index = source.indexOf('{', start);
  const bodyStart = index;
  for (; index < source.length; index++) {
    const ch = source[index];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces in ${signature}`);
}

function bashBin() {
  const candidate = process.env.XP_GATE_BASH_BIN || 'bash';
  const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' });
  // A missing runner must fail loudly, never read as a passing guard.
  if (probe.status !== 0 || probe.error) {
    throw new Error(`bash runner unavailable (${candidate}): ${probe.error ? probe.error.message : `exit ${probe.status}`}`);
  }
  return candidate;
}

/**
 * Compare a path the bash resolver printed with one Node built. Bash emits the
 * separators it was handed and mixes them (`$ADAPTER_DIR/adapters/x.sh`), so the
 * comparison is on a single separator view, not on either side's spelling.
 */
function samePath(a, b) {
  const normalize = (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/');
  return normalize(a) === normalize(b);
}

/**
 * Build an ADAPTER_DIR holding the requested flat and nested modules.
 */
function adapterTree(spec) {
  const root = mkdtempSync(join(tmpdir(), 'xp-gate-parity-'));
  const adapterDir = join(root, 'adapters');
  mkdirSync(join(adapterDir, 'adapters'), { recursive: true });
  // Empty PROJECT_GITHOOKS / SCRIPT_DIR tiers so only tiers 1-2 can answer.
  mkdirSync(join(root, 'project'), { recursive: true });
  mkdirSync(join(root, 'script'), { recursive: true });
  for (const [name, sides] of Object.entries(spec)) {
    if (sides.flat) writeFileSync(join(adapterDir, name), 'flat\n');
    if (sides.nested) writeFileSync(join(adapterDir, 'adapters', name), 'nested\n');
  }
  return { root, adapterDir };
}

/**
 * Ask the hook's own resolver which file executes for one language.
 */
function hookResolves(fnText, tree, lang) {
  const script = [
    `ADAPTER_DIR='${tree.adapterDir}'`,
    `PROJECT_GITHOOKS='${join(tree.root, 'project')}'`,
    `SCRIPT_DIR='${join(tree.root, 'script')}'`,
    fnText,
    `resolve_adapter_path ${lang}`,
  ].join('\n');
  const run = spawnSync(bashBin(), ['-c', script], { encoding: 'utf8' });
  expect(run.status, `resolver run failed: ${run.stderr}`).toBe(0);
  return run.stdout.trim();
}

describe('doctor module resolution parity with pre-commit (#495)', () => {
  const resolverText = extractFunction(PRE_COMMIT, 'resolve_adapter_path() {');

  it('AC-495-11: flat and nested present -> both languages pick the flat copy', () => {
    const { listExecutedModules } = require('../doctor');
    const tree = adapterTree({ 'typescript.sh': { flat: true, nested: true } });

    const hookChoice = hookResolves(resolverText, tree, 'typescript');
    expect(samePath(hookChoice, join(tree.adapterDir, 'typescript.sh'))).toBe(true);

    const doctorChoice = listExecutedModules(tree.adapterDir).find((m) => m.name === 'typescript.sh');
    expect(doctorChoice).toBeDefined();
    expect(samePath(doctorChoice.file, hookChoice)).toBe(true);
  });

  it('AC-495-12: every module the hook can resolve in the executed dir is in doctor\'s surface, and agrees on each path', () => {
    const { listExecutedModules } = require('../doctor');
    const tree = adapterTree({
      'typescript.sh': { nested: true },
      'python.sh': { flat: true, nested: true },
      'gate-4.sh': { flat: true },
      'go.sh': { nested: true },
    });

    const doctorModules = listExecutedModules(tree.adapterDir);
    const doctorByName = new Map(doctorModules.map((m) => [m.name, m.file]));

    // Same set of module names, no extras, no omissions.
    expect([...doctorByName.keys()].sort()).toEqual(['gate-4.sh', 'go.sh', 'python.sh', 'typescript.sh']);

    for (const lang of ['typescript', 'python', 'go']) {
      const hookChoice = hookResolves(resolverText, tree, lang);
      expect(existsSync(hookChoice), `hook resolved a missing file: ${hookChoice}`).toBe(true);
      expect(doctorByName.has(`${lang}.sh`), `doctor does not see ${lang}.sh at all`).toBe(true);
      expect(
        samePath(doctorByName.get(`${lang}.sh`), hookChoice),
        `doctor disagrees with the hook for ${lang}.sh`,
      ).toBe(true);
    }

    // Anti-vacuity: the guard executed the hook's real text, not a paraphrase.
    expect(resolverText).toMatch(/\$ADAPTER_DIR\/\$\{lang\}\.sh/);
    expect(resolverText).toMatch(/\$ADAPTER_DIR\/adapters\/\$\{lang\}\.sh/);
  });
});
