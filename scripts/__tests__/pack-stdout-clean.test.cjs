#!/usr/bin/env node
/**
 * @test REQ-723
 * @intent `npm pack --json` 的 stdout 必须是一段能被 JSON.parse 直接吃下的文本。
 *         `prepare` 钩子会跑 scripts/sync-version.cjs，而它原本用 console.log
 *         把 12 行诊断混进 stdout，真正的 JSON 被挤到第 13 行才出现——任何
 *         `npm pack --json | jq` 都以 "Invalid numeric literal" 失败。
 *
 *         这不是假设：0.32.2 就因为这个原因漏发过 dsh 插件，而当时加的守卫
 *         AC-DSH-019 只扫 src/npm-package/scripts/ 一个目录，管不到根上的
 *         prepare 钩子。于是「已经记下教训」和「根因被修掉」变成了两件事。
 *
 *         本测试不去跑真实的 npm pack（那要几十秒且依赖网络/缓存），而是直接
 *         检查被 prepare 触发的脚本有没有往 stdout 写东西——那是污染的唯一起点。
 * @covers AC-723-01 AC-723-02 AC-723-03
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** 剥掉注释，免得注释里提到 console.log 就算违规。 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 收集所有会在 npm pack / npm install 时被触发的脚本入口。 */
function packTimeScripts() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const entries = [];

  // 根 package.json 的 prepare/prepack/postpack 都会在 pack 前后跑
  for (const hook of ['prepare', 'prepack', 'postpack']) {
    const cmd = rootPkg.scripts && rootPkg.scripts[hook];
    if (!cmd) continue;
    // 取出命令里引用的脚本文件（形如 node <path> 或 bash <path>）
    for (const m of cmd.matchAll(/(?:node|bash|sh)\s+([\w./-]+\.(?:cjs|js|mjs|sh))/g)) {
      entries.push({ hook, rel: m[1] });
    }
  }

  // src/npm-package 的 prepack 链（sync-package-content.js 等）
  const pkgPath = path.join(REPO_ROOT, 'src', 'npm-package', 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const hook of ['prepare', 'prepack', 'postpack']) {
      const cmd = pkg.scripts && pkg.scripts[hook];
      if (!cmd) continue;
      for (const m of cmd.matchAll(/(?:node|bash|sh)\s+([\w./-]+\.(?:cjs|js|mjs|sh))/g)) {
        // 相对 src/npm-package/ 解析
        entries.push({ hook: `src/npm-package:${hook}`, rel: path.join('src', 'npm-package', m[1]) });
      }
    }
  }

  return entries;
}

test('AC-723-01: every pack-time script resolves to a real file', () => {
  const entries = packTimeScripts();
  assert.ok(entries.length > 0, 'no pack-time scripts discovered — the guard would pass vacuously');
  for (const { hook, rel } of entries) {
    const abs = path.join(REPO_ROOT, rel);
    assert.ok(
      fs.existsSync(abs),
      `${hook} references ${rel}, which does not exist — the guard would be looking at nothing`,
    );
  }
});

test('AC-723-02: pack-time scripts never write to stdout', () => {
  const offenders = [];
  for (const { hook, rel } of packTimeScripts()) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const code = codeOnly(fs.readFileSync(abs, 'utf8'));
    // console.log / process.stdout.write 都会污染 --json 的机器可读通道
    if (/console\.log\s*\(/.test(code)) {
      offenders.push(`${rel} (${hook}): console.log`);
    }
    if (/process\.stdout\.write\s*\(/.test(code)) {
      offenders.push(`${rel} (${hook}): process.stdout.write`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'these run during `npm pack` and would corrupt `npm pack --json`; log to stderr instead',
  );
});

test('AC-723-03: sync-version still reports progress, just on stderr', () => {
  // 修污染不能把输出整个删掉——人还需要看到它同步了什么。
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'sync-version.cjs'), 'utf8');
  const code = codeOnly(src);
  assert.ok(
    /console\.(error|warn)\s*\(/.test(code),
    'sync-version.cjs must keep reporting via console.error/console.warn',
  );
  // 且这些汇报仍在：至少有一处 [sync-version] 前缀写往 stderr
  assert.match(
    src,
    /console\.(error|warn)\s*\(\s*`\[sync-version\]/,
    'the [sync-version] progress lines must survive, moved to stderr',
  );
});
