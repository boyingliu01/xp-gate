#!/usr/bin/env node
// build-plugin.mjs — Cross-platform Node.js replacement for build-plugin.sh
// Builds a plugin package for a target platform (Claude Code, OpenCode, or dsh).
//
// Usage: node scripts/build-plugin.mjs --platform claude-code|opencode|dsh

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { copySkills } from './copy-skills.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Must stay in sync with skills/ directory (all 8 canonical skills).
// When adding a new skill, append it here AND under skills/.
const EXPECTED_SKILLS = [
  'admin-template-guidelines',
  'delphi-review',
  'improve-codebase-architecture',
  'ralph-loop',
  'sprint-flow',
  'test-driven-development',
  'test-specification-alignment',
  'to-issues',
];

/**
 * Run one of the dsh plugin's own npm scripts, or exit naming that script.
 *
 * `shell: true` is required, not optional. On POSIX npm is an executable, so the
 * plain spawn works; on Windows npm is `npm.cmd`, a batch file that
 * CreateProcess cannot launch directly, so spawnSync returns a null status and
 * the build reported failure with no diagnostic. That failure then read as
 * "tsc failed" while running `npm run build` by hand exited 0 (#624).
 *
 * The plugin's skills/ directory is a build artifact (.gitignore line 150) and
 * the test suite asserts it exists, so a silently-broken build here breaks CI's
 * mutation dry run on a clean checkout.
 */
function runNpmScript(dshDir, script) {
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', cwd: dshDir, shell: true });
  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    console.error(`Error: \`npm run ${script}\` failed in ${dshDir}${detail}`);
    process.exit(1);
  }
}

/**
 * Build the dsh plugin (tsc → lib/ + skills prepack).
 *
 * The dsh plugin compiles TypeScript and populates its gitignored skills/ via
 * its own package.json scripts (mirrors the npm prepack path), rather than the
 * copy-skills approach used by the JSON/bash plugins.
 */
function buildDshPlugin() {
  const dshDir = path.join(REPO_ROOT, 'plugins', 'dsh');
  if (!fs.existsSync(dshDir)) {
    console.error(`Error: Plugin directory not found: ${dshDir}`);
    process.exit(1);
  }
  console.log('Building dsh plugin (npm run build -> lib, then skills prepack)...');
  runNpmScript(dshDir, 'build');
  runNpmScript(dshDir, 'prepare-skills');
  console.log('Build complete: dsh plugin compiled + skills packaged');
  console.log(`Plugin location: ${dshDir}`);
}

/**
 * Exit with `message` on stderr when `problem` is truthy. Centralises the
 * "validate then abort" steps so `buildPlugin` reads as a sequence rather than a
 * ladder of ifs.
 */
function failWhen(problem, message) {
  if (!problem) return;
  console.error(message);
  process.exit(1);
}

/** True when `p` exists and is a directory. */
export function isDirectory(p) {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

/** Reject a missing or unknown platform before touching the filesystem. */
function validatePlatform(platform) {
  failWhen(!platform, 'Usage: build-plugin.mjs --platform claude-code|opencode|dsh');
  failWhen(
    !['claude-code', 'opencode', 'dsh'].includes(platform),
    `Error: --platform must be 'claude-code', 'opencode', or 'dsh' (got: ${platform})`,
  );
}

/** Remove every existing skill directory so the rebuild is idempotent. */
function cleanSkillsTarget(skillsTarget) {
  if (!fs.existsSync(skillsTarget)) return;
  const entries = fs.readdirSync(skillsTarget, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      fs.rmSync(path.join(skillsTarget, entry.name), { recursive: true, force: true });
    }
  }
}

/** Every expected skill whose SKILL.md is absent from the built plugin. */
export function missingSkills(pluginDir) {
  return EXPECTED_SKILLS.filter(
    (skill) => !fs.existsSync(path.join(pluginDir, 'skills', skill, 'SKILL.md')),
  );
}

/**
 * Build a plugin package for a target platform.
 * Copies all skills from the canonical skills/ directory into the plugin's skills/ directory,
 * then verifies that all expected skills are present.
 *
 * @param {string} platform - 'claude-code', 'opencode', or 'dsh'
 */
export function buildPlugin(platform) {
  validatePlatform(platform);

  if (platform === 'dsh') {
    buildDshPlugin();
    return;
  }

  const pluginDir = path.join(REPO_ROOT, 'plugins', platform);
  const skillsSource = path.join(REPO_ROOT, 'skills');

  failWhen(!isDirectory(skillsSource), `Error: Skills directory not found: ${skillsSource}`);
  failWhen(
    !isDirectory(pluginDir),
    `Error: Plugin directory not found: ${pluginDir}\nRun Task 1 first to create directory structure`,
  );

  console.log(`Building ${platform} plugin...`);
  console.log(`Source: ${skillsSource}`);
  console.log(`Target: ${pluginDir}/skills`);

  const skillsTarget = path.join(pluginDir, 'skills');
  cleanSkillsTarget(skillsTarget);

  copySkills(skillsSource, skillsTarget);

  const missing = missingSkills(pluginDir);
  for (const skill of missing) {
    console.error(`Missing: ${skill}/SKILL.md`);
  }
  failWhen(
    missing.length > 0,
    `Error: ${missing.length} skills missing from ${platform} plugin`,
  );

  console.log('');
  console.log(`Build complete: ${EXPECTED_SKILLS.length} skills packaged for ${platform}`);
  console.log(`Plugin location: ${pluginDir}`);
}

// ---------- CLI entry point ----------

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  let platform = '';
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platform':
        platform = args[++i];
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  buildPlugin(platform);
}
