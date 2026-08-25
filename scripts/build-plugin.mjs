#!/usr/bin/env node
// build-plugin.mjs — Cross-platform Node.js replacement for build-plugin.sh
// Builds a plugin package for a target platform (Claude Code or OpenCode).
//
// Usage: node scripts/build-plugin.mjs --platform claude-code|opencode

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { copySkills } from './copy-skills.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Must stay in sync with skills/ directory (all 8 canonical skills).
// When adding a new skill, append it here AND under skills/.
const EXPECTED_SKILLS = [
  'admin-template-guidelines',
  'clipboard-vision',
  'delphi-review',
  'improve-codebase-architecture',
  'ralph-loop',
  'sprint-flow',
  'test-driven-development',
  'test-specification-alignment',
  'to-issues',
];

/**
 * Build a plugin package for a target platform.
 * Copies all skills from the canonical skills/ directory into the plugin's skills/ directory,
 * then verifies that all expected skills are present.
 *
 * @param {string} platform - 'claude-code' or 'opencode'
 */
export function buildPlugin(platform) {
  if (!platform) {
    console.error('Usage: build-plugin.mjs --platform claude-code|opencode');
    process.exit(1);
  }

  if (!['claude-code', 'opencode'].includes(platform)) {
    console.error(`Error: --platform must be 'claude-code' or 'opencode' (got: ${platform})`);
    process.exit(1);
  }

  const pluginDir = path.join(REPO_ROOT, 'plugins', platform);
  const skillsSource = path.join(REPO_ROOT, 'skills');

  if (!fs.existsSync(skillsSource) || !fs.statSync(skillsSource).isDirectory()) {
    console.error(`Error: Skills directory not found: ${skillsSource}`);
    process.exit(1);
  }

  if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
    console.error(`Error: Plugin directory not found: ${pluginDir}`);
    console.error('Run Task 1 first to create directory structure');
    process.exit(1);
  }

  console.log(`Building ${platform} plugin...`);
  console.log(`Source: ${skillsSource}`);
  console.log(`Target: ${pluginDir}/skills`);

  // Clean existing skills before rebuild (idempotent)
  const skillsTarget = path.join(pluginDir, 'skills');
  if (fs.existsSync(skillsTarget)) {
    const entries = fs.readdirSync(skillsTarget, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        fs.rmSync(path.join(skillsTarget, entry.name), { recursive: true, force: true });
      }
    }
  }

  // Copy all skills
  copySkills(skillsSource, skillsTarget);

  // Verify all expected skills are present
  let missing = 0;
  for (const skill of EXPECTED_SKILLS) {
    const skillMd = path.join(pluginDir, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      console.error(`Missing: ${skill}/SKILL.md`);
      missing++;
    }
  }

  if (missing > 0) {
    console.error(`Error: ${missing} skills missing from ${platform} plugin`);
    process.exit(1);
  }

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
