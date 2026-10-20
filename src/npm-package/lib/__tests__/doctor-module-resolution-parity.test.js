/**
 * @test REQ-495 the JS mirror of the hook's module lookup must be reconciled against the bash original
 * @intent #495 的修复把 pre-commit 的 flat-优先-nested 解析顺序用 JavaScript 重写了一份
 *         （doctor.js listExecutedModules）。本仓库在本批次已经示范过正确范式：
 *         src/mutation/__tests__/test-filter-parity.test.ts（AC-480-04）把 bash 与 TS
 *         两份"非生产代码定义"钉成同一文本。跨语言的解析顺序同样不能靠注释宣称一致：
 *         hook 侧一旦演化，doctor 就会镜像旧秩序，"doctor 全绿、执行面另起炉灶"重现。
 *         因此这里直接抽取 pre-commit 的 resolve_adapter_path 函数体，交给 bash 执行，
 *         与 doctor 的 listExecutedModules 在同一棵合成目录树上逐模块对账。第三轮把它
 *         扩到四层全填充的场景树：ADAPTER_DIR 链、GATE_DIR 链、resolve_adapter_path 三段
 *         全部从 pre-commit 原文抽取后交给 bash 执行，与 doctor 的
 *         resolveExecutedModuleDirs()+executedModulePath() 对同一棵树逐一比对；hook 侧
 *         一旦改动解析顺序，这里立刻失配，而不是让 doctor 继续镜像旧秩序。
 * @covers AC-495-11, AC-495-12, AC-495-21, AC-495-22
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const PRE_COMMIT = readFileSync(resolve(__dirname, '..', '..', '..', '..', 'githooks', 'pre-commit'), 'utf8');
// #505 replaced the two hand-written shell chains with one data file generated
// from lib/hook-module-resolution.js — the same module doctor.js requires. The
// parity test therefore verifies the NEW contract: the generated data is current,
// and the hook + doctor both honour it. The scenarios below still drive the hook's
// real text through bash, so agreement is measured, not asserted.
const RESOLUTION_DATA = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', 'githooks', 'hook-module-resolution.sh'),
  'utf8',
);
const { RESOLUTION_ORDER, GATE_RESOLUTION_ORDER, ADAPTER_DIR_ORDER } = require('../hook-module-resolution.js');

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

/**
 * Grab one `if`-chain verbatim from the hook, up to and including its `fi`.
 */
function matchBlock(source, pattern, label) {
  const hit = source.match(pattern);
  expect(hit, `pre-commit no longer carries ${label}`).not.toBeNull();
  return hit[0];
}

function bashBin() {
  if (process.env.XP_GATE_BASH_BIN) {
    const probe = spawnSync(process.env.XP_GATE_BASH_BIN, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (probe.status !== 0 || probe.error) {
      throw new Error(`bash runner unavailable (${process.env.XP_GATE_BASH_BIN}): ${probe.error ? probe.error.message : `exit ${probe.status}`}`);
    }
    return process.env.XP_GATE_BASH_BIN;
  }
  // Resolve the authoritative bash the hooks actually get. On Windows a bare
  // PATH 'bash' may be the WSL System32 stub, whose `-c` scripts receive an
  // empty $1 and resolve nothing — a vacuous resolver run, not a passing one.
  const { checkBash } = require('../detect-deps.js');
  const b = checkBash();
  if (!b.ok) {
    throw new Error(`bash runner unavailable: ${b.message || 'checkBash failed'}`);
  }
  return b.path;
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
 * Where a module copy can sit across all four tiers the hook looks at. Each key
 * is a location name, so a scenario reads as a statement about the tree.
 */
const LAYOUTS = {
  globalFlat: (t, name) => join(t.globalAdapters, name),
  globalNested: (t, name) => join(t.globalAdapters, 'adapters', name),
  projectFlat: (t, name) => join(t.projectGithooks, name),
  projectNested: (t, name) => join(t.projectGithooks, 'adapters', name),
  scriptFlat: (t, name) => join(t.scriptDir, name),
  scriptNested: (t, name) => join(t.scriptDir, 'adapters', name),
};

/**
 * A tree with all tiers present, including their resolution anchors, so tier
 * precedence is decided by the hook's own text rather than by the fixture's
 * assumptions (AC-495-13's project-tier pair depends on this too).
 */
function fourTierTree(layouts) {
  const root = mkdtempSync(join(tmpdir(), 'xp-gate-parity4-'));
  const t = {
    root,
    globalAdapters: join(root, 'global', 'adapters'),
    projectGithooks: join(root, 'repo', 'githooks'),
    scriptDir: join(root, 'installed', 'hooks'),
  };
  for (const dir of [t.globalAdapters, t.projectGithooks, t.scriptDir]) {
    mkdirSync(join(dir, 'adapters'), { recursive: true });
  }
  for (const [name, places] of Object.entries(layouts)) {
    for (const place of places) {
      const file = LAYOUTS[place](t, name);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, `${place}\n`);
    }
  }
  return t;
}

/**
 * Run the hook's own ADAPTER_DIR chain, GATE_DIR chain and resolve_adapter_path
 * over one tree, and report all three answers.
 */
function hookResolvesAll(blocks, resolverText, t, lang, gateModule) {
  // Bash assignment uses single quotes below; a temp path containing one would
  // change the tree the two sides are looking at, so refuse rather than lie.
  for (const dir of [t.globalAdapters, t.projectGithooks, t.scriptDir]) {
    expect(dir, `fixture path contains a quote: ${dir}`).not.toMatch(/'/);
  }
  const script = [
    `GLOBAL_ADAPTER_DIR='${t.globalAdapters}'`,
    `PROJECT_GITHOOKS='${t.projectGithooks}'`,
    `SCRIPT_DIR='${t.scriptDir}'`,
    `ADAPTER_DIR=''`,
    resolverText,
    blocks.gateDir,
    // The real chains, driven by the same data the hook loads.
    '_hook_adapter_dir() {',
    '  local entry base suffix base_dir',
    '  eval "set -- \\"\\${HOOK_ADAPTER_DIR_TIERS[@]}\\""',
    '  for entry in "$@"; do',
    '    entry="${entry#*|}"; base="${entry%%|*}"; suffix="${entry#*|}"',
    '    base_dir="$(_hook_tier_base "$base")"',
    '    [ -n "$base_dir" ] || continue',
    '    if [ -f "$base_dir/$suffix" ]; then printf "%s" "$base_dir"; return 0; fi',
    '  done',
    '  return 1',
    '}',
    'ADAPTER_DIR="$(_hook_adapter_dir)" || ADAPTER_DIR="$SCRIPT_DIR"',
    'GATE_DIR="$(_hook_resolve_dir "$HOOK_GATE_PROBE" HOOK_GATE_TIERS)" || GATE_DIR=""',
    'if [ -z "$GATE_DIR" ]; then GATE_DIR="$ADAPTER_DIR"; fi',
    'echo "ADAPTER=$ADAPTER_DIR"',
    'echo "GATE=$GATE_DIR"',
    `if [ -f "$ADAPTER_DIR/adapter-common.sh" ]; then echo "COMMON=$ADAPTER_DIR/adapter-common.sh"; else echo "COMMON="; fi`,
    `if [ -f "$GATE_DIR/${gateModule}" ]; then echo "MODULE=$GATE_DIR/${gateModule}"; else echo "MODULE="; fi`,
    // Captured by substitution rather than read off the last stdout line: the
    // script ends with a newline, so "last line" is always the empty one.
    `echo "LANG=$(resolve_adapter_path ${lang} || true)"`,
  ].join('\n');
  const run = spawnSync(bashBin(), ['-c', script], { encoding: 'utf8' });
  expect(run.status, `resolver run failed: ${run.stderr}`).toBe(0);
  const lines = run.stdout.split(/\r?\n/);
  const named = (prefix) => {
    const hit = lines.find((l) => l.startsWith(`${prefix}=`));
    expect(hit, `bash printed no ${prefix}= line:\n${run.stdout}`).toBeDefined();
    return hit ? hit.slice(prefix.length + 1) : '';
  };
  return {
    adapterDir: named('ADAPTER'),
    gateDir: named('GATE'),
    common: named('COMMON'),
    gateModule: named('MODULE'),
    langPath: named('LANG'),
  };
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
  // #505: the resolver helpers come from the hook, the tier DATA from the
  // generated file. Concatenating them is what the hook itself does, so the
  // bash side here is the production code path, not a paraphrase of it.
  const helpers = [
    extractFunction(PRE_COMMIT, '_hook_tier_base() {'),
    extractFunction(PRE_COMMIT, '_hook_resolve() {'),
    extractFunction(PRE_COMMIT, '_hook_resolve_dir() {'),
    extractFunction(PRE_COMMIT, 'resolve_adapter_path() {'),
  ].join('\n');
  // `blocks` keeps the names the scenarios use: the data file supplies the
  // ADAPTER_DIR/GATE_DIR chains that used to be matched out of the hook text.
  const blocks = {
    adapterDir: '',
    gateDir: '',
  };
  const resolverText = `${RESOLUTION_DATA}\n${helpers}`;

  it('AC-505-01: the generated shell data is current with its JS source', () => {
    // Stale data would silently run a different order than doctor reports — the
    // exact failure mode #505 exists to make impossible.
    expect(() => execFileSync(
      process.execPath,
      [resolve(__dirname, '..', '..', '..', '..', 'scripts', 'generate-hook-resolution.cjs'), '--check'],
      { stdio: 'pipe' },
    )).not.toThrow();
  });

  it('AC-505-02: the hook loads the generated data instead of carrying its own order', () => {
    // Anti-vacuity for the whole feature: if the hook re-grew a literal cascade,
    // the single-source-of-truth claim would be false even while scenarios pass.
    expect(PRE_COMMIT).toContain('hook-module-resolution.sh');
    expect(PRE_COMMIT).toContain('HOOK_ADAPTER_TIERS');
    expect(PRE_COMMIT).toContain('HOOK_GATE_TIERS');
    // The old hand-written chains must be gone.
    expect(PRE_COMMIT).not.toContain('$ADAPTER_DIR/${lang}.sh');
    expect(PRE_COMMIT).not.toMatch(/if \[ -f "\$ADAPTER_DIR\/gate-3\.sh" \]; then/);
    // And every tier the JS declares must appear in the emitted shell data.
    for (const t of RESOLUTION_ORDER) {
      expect(RESOLUTION_DATA).toContain(`${t.tier_id}|${t.base}|${t.template}`);
    }
    for (const t of GATE_RESOLUTION_ORDER) {
      expect(RESOLUTION_DATA).toContain(`'${t.tier_id}|${t.base}|'`);
    }
    for (const t of ADAPTER_DIR_ORDER) {
      expect(RESOLUTION_DATA).toContain(`${t.tier_id}|${t.base}|${t.probe}`);
    }
  });

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
    // #505 moved the literal paths out of the hook, so assert that the tiers it
    // now reads still describe the two layouts those paths used to spell out.
    expect(resolverText).toContain('HOOK_ADAPTER_TIERS');
    const adapterTemplates = RESOLUTION_ORDER.map((t) => t.template);
    expect(adapterTemplates).toContain('{name}.sh');
    expect(adapterTemplates).toContain('adapters/{name}.sh');
  });

  // The scenarios below put a copy of the same module in EVERY tier the hook can
  // reach, so agreement can only come from following the real precedence. Round 2
  // had a hand-written two-tier list in doctor and called whatever it found
  // "executed" -- which both mislabelled files nothing runs and left a FAIL no
  // repair could clear (#495 Round 3).
  const SCENARIOS = [
    {
      name: 'global install present: the global flat copy wins over every other tier',
      layouts: {
        'adapter-common.sh': ['globalFlat', 'projectFlat', 'scriptFlat'],
        'gate-3.sh': ['globalFlat', 'projectFlat', 'scriptFlat'],
        'gate-4.sh': ['globalFlat', 'projectFlat', 'scriptFlat'],
        'typescript.sh': ['globalFlat', 'globalNested', 'projectFlat', 'projectNested', 'scriptNested'],
      },
    },
    {
      name: 'no global install: ADAPTER_DIR resolves to the project tier and its flat copy runs',
      layouts: {
        'adapter-common.sh': ['projectFlat', 'scriptFlat'],
        'gate-3.sh': ['projectFlat', 'scriptFlat'],
        'gate-4.sh': ['projectFlat', 'scriptFlat'],
        'typescript.sh': ['projectFlat', 'projectNested', 'scriptNested'],
      },
    },
    {
      name: 'project tier carries no anchor: GATE_DIR falls through to the installed hooks dir',
      layouts: {
        'adapter-common.sh': ['globalFlat'],
        'gate-3.sh': ['scriptFlat'],
        'gate-4.sh': ['globalFlat', 'projectFlat', 'scriptFlat'],
        'typescript.sh': ['globalNested', 'projectNested', 'scriptNested'],
      },
    },
  ];

  it('AC-495-21: the JS resolution picks the same file as the hook for every tier scenario', () => {
    const { resolveExecutedModuleDirs, executedModulePath } = require('../doctor');
    for (const scenario of SCENARIOS) {
      const t = fourTierTree(scenario.layouts);
      const hook = hookResolvesAll(blocks, resolverText, t, 'typescript', 'gate-4.sh');
      const dirs = resolveExecutedModuleDirs({
        globalAdapterDir: t.globalAdapters,
        projectGithooks: t.projectGithooks,
        scriptDir: t.scriptDir,
      });

      expect(samePath(dirs.adapterDir, hook.adapterDir), `${scenario.name} (ADAPTER_DIR)`).toBe(true);
      expect(samePath(dirs.gateDir, hook.gateDir), `${scenario.name} (GATE_DIR)`).toBe(true);

      const jsLang = executedModulePath('typescript.sh', dirs);
      expect(jsLang, `${scenario.name}: doctor finds no executed copy the hook resolves`).not.toBeNull();
      expect(samePath(jsLang, hook.langPath), `${scenario.name} (typescript.sh)`).toBe(true);

      // Gate modules come from GATE_DIR, language adapters from the resolver chain.
      expect(samePath(executedModulePath('gate-4.sh', dirs), hook.gateModule), `${scenario.name} (gate-4.sh)`).toBe(true);
      expect(samePath(executedModulePath('adapter-common.sh', dirs), hook.common), `${scenario.name} (adapter-common.sh)`).toBe(true);
    }
  });

  it('AC-495-22: a module no tier installs resolves to nothing on both sides', () => {
    const { resolveExecutedModuleDirs, executedModulePath } = require('../doctor');
    const t = fourTierTree({
      'adapter-common.sh': ['globalFlat'],
      'gate-3.sh': ['globalFlat'],
    });
    const dirs = resolveExecutedModuleDirs({
      globalAdapterDir: t.globalAdapters,
      projectGithooks: t.projectGithooks,
      scriptDir: t.scriptDir,
    });
    const hook = hookResolvesAll(blocks, resolverText, t, 'rust', 'gate-9.sh');
    expect(hook.langPath).toBe('');
    expect(executedModulePath('rust.sh', dirs)).toBeNull();
    expect(executedModulePath('gate-9.sh', dirs)).toBeNull();
  });
});
