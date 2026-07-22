#!/usr/bin/env node
// sync-version.cjs — 单源真理：从 VERSION 文件同步版本号到所有 package.json
//
// VERSION 文件是唯一版本源头（格式：MAJOR.MINOR.PATCH.MICRO）
// 根 package.json 使用完整的 MAJOR.MINOR.PATCH.MICRO
// src/npm-package/package.json 使用 MAJOR.MINOR.PATCH（npm semver）
//
// 使用方式：
//   修改 VERSION 后，运行此脚本自动同步
//   或作为 prepare/postinstall hook 自动执行
//
// 跨平台：纯 Node.js 实现，无需 bash/sed/find 等 Unix 工具

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT_DIR, 'VERSION');

// ---------- 读取并校验 VERSION ----------

if (!fs.existsSync(VERSION_FILE)) {
  console.error(`[sync-version] ERROR: VERSION file not found at ${VERSION_FILE}`);
  process.exit(1);
}

const FULL_VERSION = fs.readFileSync(VERSION_FILE, 'utf8').replace(/[\r\n\s]/g, '');

if (!/^\d+\.\d+\.\d+\.\d+$/.test(FULL_VERSION)) {
  console.error(`[sync-version] ERROR: VERSION '${FULL_VERSION}' does not match MAJOR.MINOR.PATCH.MICRO`);
  process.exit(1);
}

// npm semver 格式：去掉第4位
const NPM_VERSION = FULL_VERSION.replace(/\.\d+$/, '');

// ---------- 通用函数 ----------

/**
 * 更新 JSON 文件中的顶层 "version" 字段
 * @param {string} filePath - JSON 文件绝对路径
 * @param {string} newVersion - 新版本号
 */
function syncJsonVersion(filePath, newVersion) {
  const content = fs.readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(content);
  pkg.version = newVersion;
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * 递归查找目录下所有匹配文件名的文件（排除 node_modules 和 .git）
 * @param {string} dir - 起始目录
 * @param {string} fileName - 目标文件名
 * @returns {string[]} 匹配文件的绝对路径数组
 */
function findFiles(dir, fileName) {
  const results = [];
  const skipDirs = new Set(['node_modules', '.git', '.stryker-tmp']);

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // 权限不足等错误静默跳过
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.name === fileName) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * 安全执行 git 命令，失败时返回 fallback
 * @param {string} cmd - git 命令
 * @param {string} fallback - 失败时的默认值
 * @returns {string}
 */
function gitCmd(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return fallback;
  }
}

// ---------- JSON 版本号同步 ----------

const syncTargets = [
  { file: path.join(ROOT_DIR, 'package.json'), version: FULL_VERSION, label: 'root package.json' },
  { file: path.join(ROOT_DIR, 'src', 'npm-package', 'package.json'), version: NPM_VERSION, label: 'src/npm-package/package.json' },
  { file: path.join(ROOT_DIR, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), version: NPM_VERSION, label: 'plugins/claude-code/.claude-plugin/plugin.json' },
  { file: path.join(ROOT_DIR, 'plugins', 'opencode', 'package.json'), version: NPM_VERSION, label: 'plugins/opencode/package.json' },
  { file: path.join(ROOT_DIR, 'plugins', 'qoder', 'plugin.json'), version: NPM_VERSION, label: 'plugins/qoder/plugin.json' },
  // npm-package mirror copies (for Mirror Parity CI check)
  { file: path.join(ROOT_DIR, 'src', 'npm-package', 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), version: NPM_VERSION, label: 'src/npm-package/plugins/claude-code/.claude-plugin/plugin.json' },
  { file: path.join(ROOT_DIR, 'src', 'npm-package', 'plugins', 'opencode', 'package.json'), version: NPM_VERSION, label: 'src/npm-package/plugins/opencode/package.json' },
  { file: path.join(ROOT_DIR, 'src', 'npm-package', 'plugins', 'qoder', 'plugin.json'), version: NPM_VERSION, label: 'src/npm-package/plugins/qoder/plugin.json' },
];

for (const target of syncTargets) {
  if (fs.existsSync(target.file)) {
    syncJsonVersion(target.file, target.version);
    console.log(`[sync-version] ${target.label} -> ${target.version}`);
  }
}

// ---------- AGENTS.md 头部更新 ----------

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const headSha = gitCmd(['rev-parse', '--short', 'HEAD'], 'unknown');
const branch = gitCmd(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');

const agentsFiles = findFiles(ROOT_DIR, 'AGENTS.md');
let agentsCount = 0;

const replacements = [
  { pattern: /^\*\*Generated:\*\*.*$/m, value: `**Generated:** ${today}` },
  { pattern: /^\*\*Commit:\*\*.*$/m, value: `**Commit:** ${headSha}` },
  { pattern: /^\*\*Branch:\*\*.*$/m, value: `**Branch:** ${branch}` },
  { pattern: /^\*\*Version:\*\*.*$/m, value: `**Version:** ${FULL_VERSION}` },
];

for (const agentsFile of agentsFiles) {
  let content = fs.readFileSync(agentsFile, 'utf8');
  let changed = false;

  for (const { pattern, value } of replacements) {
    if (pattern.test(content)) {
      content = content.replace(pattern, value);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(agentsFile, content);
    agentsCount++;
  }
}

console.log(`[sync-version] AGENTS.md headers refreshed: ${agentsCount} files (date=${today} commit=${headSha} branch=${branch} version=${FULL_VERSION})`);
console.log(`[sync-version] OK — all package.json version fields synced from VERSION (${FULL_VERSION})`);
