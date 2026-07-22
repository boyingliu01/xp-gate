#!/usr/bin/env node
// copy-skills.mjs — Cross-platform Node.js replacement for copy-skills.sh
// Copies entire skill directories from source to plugin destination.
// With --verify, validates every copied file by SHA-256 comparison.
//
// Usage: node scripts/copy-skills.mjs --source <skills_dir> --dest <target_dir> [--verify]

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

/**
 * Recursively walk a directory and return all file paths.
 * @param {string} dir - Directory to walk
 * @returns {string[]} Array of absolute file paths
 */
function walkFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath - Absolute file path
 * @returns {string} Hex digest
 */
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Copy skill directories from source to destination.
 * Each subdirectory containing SKILL.md is copied in full (preserves references/, templates/, etc.).
 *
 * @param {string} sourceDir - Source skills directory
 * @param {string} destDir - Destination directory
 * @param {boolean} verify - Whether to verify SHA-256 after copy
 * @returns {number} Number of skills copied
 */
export function copySkills(sourceDir, destDir, verify = false) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.error(`Error: Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  fs.mkdirSync(destDir, { recursive: true });

  let count = 0;
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(sourceDir, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');

    if (fs.existsSync(skillMd)) {
      const destSkillDir = path.join(destDir, entry.name);
      // Remove existing directory if present (idempotent)
      if (fs.existsSync(destSkillDir)) {
        fs.rmSync(destSkillDir, { recursive: true, force: true });
      }
      // Copy entire skill directory (preserves references/, templates/, etc.)
      fs.cpSync(skillDir, destSkillDir, { recursive: true });
      console.log(`Copied: ${entry.name}`);
      count++;
    }
  }

  console.log(`Total skills copied: ${count}`);

  // --verify: post-copy integrity check via SHA-256 comparison
  if (verify) {
    console.log('');
    console.log('[verify] Checking SHA-256 integrity of copied skills...');
    let errors = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(sourceDir, entry.name);
      const skillMd = path.join(skillDir, 'SKILL.md');
      const destSkillDir = path.join(destDir, entry.name);

      if (!fs.existsSync(skillMd) || !fs.existsSync(destSkillDir)) continue;

      const srcFiles = walkFiles(skillDir);
      for (const srcFile of srcFiles) {
        const relPath = path.relative(skillDir, srcFile);
        const destFile = path.join(destSkillDir, relPath);

        if (!fs.existsSync(destFile)) {
          console.error(`[verify] ERROR: ${entry.name}/${relPath} — missing in destination`);
          errors++;
          continue;
        }

        const srcHash = sha256File(srcFile);
        const destHash = sha256File(destFile);

        if (srcHash !== destHash) {
          console.error(`[verify] ERROR: ${entry.name}/${relPath} — SHA-256 mismatch`);
          errors++;
        }
      }
    }

    if (errors === 0) {
      console.log(`[verify] OK: all ${count} skill(s) verified (SHA-256 match)`);
    } else {
      console.error(`[verify] FAIL: ${errors} checksum error(s) found`);
      process.exit(1);
    }
  }

  return count;
}

// ---------- CLI entry point ----------

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  let sourceDir = '';
  let destDir = '';
  let verify = false;

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
        sourceDir = args[++i];
        break;
      case '--dest':
        destDir = args[++i];
        break;
      case '--verify':
        verify = true;
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!sourceDir || !destDir) {
    console.error('Usage: copy-skills.mjs --source <skills_dir> --dest <target_dir> [--verify]');
    process.exit(1);
  }

  copySkills(sourceDir, destDir, verify);
}
