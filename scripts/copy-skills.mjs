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
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // NOT an empty list. Returning [] made an unreadable subtree INVISIBLE to the checksum
    // pass, which then compared the remaining files and reported success -- a subtree
    // nobody could read "passing" by absence (review FC-01).
    //
    // The sentinel mirrors `sha256File`'s `'unreadable'`: a path that cannot be hashed
    // must make the comparison FAIL, not disappear from it. Two functions in one file
    // disagreeing about what an unreadable path means is how this survived review.
    results.push(path.join(dir, '.unreadable-directory'));
    return results;
  }
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
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    // An unreadable file cannot MATCH anything, so return a constant that never equals a
    // real digest -- reporting it as valid would hide a file the copy never delivered.
    return 'unreadable';
  }
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
/** Copy one skill directory wholesale. Returns false when it is not a skill. */
function copyOneSkill(entry, sourceDir, destDir) {
  if (!entry.isDirectory()) return false;
  const skillDir = path.join(sourceDir, entry.name);
  if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) return false;

  const destSkillDir = path.join(destDir, entry.name);
  // Remove existing directory if present (idempotent)
  if (fs.existsSync(destSkillDir)) {
    fs.rmSync(destSkillDir, { recursive: true, force: true });
  }
  // Copy entire skill directory (preserves references/, templates/, etc.)
  fs.cpSync(skillDir, destSkillDir, { recursive: true });
  console.log(`Copied: ${entry.name}`);
  return true;
}

/**
 * SHA-256 comparison for one skill. Returns the number of files that are
 * missing or differ; a skill without a SKILL.md or without a destination is
 * not a verify candidate and counts as zero errors.
 */
function verifyOneSkill(entry, sourceDir, destDir) {
  if (!isVerifiableSkill(entry, sourceDir, destDir)) return 0;
  const skillDir = path.join(sourceDir, entry.name);
  const destSkillDir = path.join(destDir, entry.name);
  let errors = 0;
  for (const srcFile of walkFiles(skillDir)) {
    errors += verifyFilePair(entry.name, skillDir, destSkillDir, srcFile);
  }
  return errors;
}

/**
 * Whether this entry is a skill that was actually copied.
 *
 * A directory without `SKILL.md` is not a skill, and a destination that does not exist
 * means the copy skipped it -- neither is a checksum error.
 */
function isVerifiableSkill(entry, sourceDir, destDir) {
  if (!entry.isDirectory()) return false;
  const skillDir = path.join(sourceDir, entry.name);
  return fs.existsSync(path.join(skillDir, 'SKILL.md'))
    && fs.existsSync(path.join(destDir, entry.name));
}

/**
 * Compare one file against its copy.
 *
 * MISSING and MISMATCH are reported separately: the first means the copy was skipped, the
 * second that it was corrupted, and an operator chasing one should not have to guess which.
 *
 * @returns 1 when the copy is wrong, 0 when it matches
 */
function verifyFilePair(skillName, skillDir, destSkillDir, srcFile) {
  const relPath = path.relative(skillDir, srcFile);
  const destFile = path.join(destSkillDir, relPath);
  if (!fs.existsSync(destFile)) {
    console.error(`[verify] ERROR: ${skillName}/${relPath} — missing in destination`);
    return 1;
  }
  if (sha256File(srcFile) === sha256File(destFile)) return 0;
  console.error(`[verify] ERROR: ${skillName}/${relPath} — SHA-256 mismatch`);
  return 1;
}

export function copySkills(sourceDir, destDir, verify = false) {
  assertSourceDirectory(sourceDir);

  let entries;
  try {
    fs.mkdirSync(destDir, { recursive: true });
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (err) {
    // Nothing was copied, so reporting a count of 0 would read as "no skills to copy".
    console.error(`Error: cannot prepare ${destDir} <- ${sourceDir}: ${String(err)}`);
    process.exit(1);
  }
  const count = copyEntries(entries, sourceDir, destDir);
  console.log(`Total skills copied: ${count}`);

  // --verify: post-copy integrity check via SHA-256 comparison
  if (verify) verifyCopiedSkills(entries, sourceDir, destDir, count);
  return count;
}

/**
 * Fail before touching anything if the source is not a directory.
 *
 * Checked FIRST: creating the destination and then discovering there is nothing to copy
 * would leave an empty skills directory behind, which reads as "no skills" downstream.
 */
function assertSourceDirectory(sourceDir) {
  try {
    if (fs.existsSync(sourceDir) && fs.statSync(sourceDir).isDirectory()) return;
  } catch {
    // A path that cannot even be stat'ed is not a usable source either.
  }
  console.error(`Error: Source directory not found: ${sourceDir}`);
  process.exit(1);
}

/** Copy each entry, returning how many were written. */
function copyEntries(entries, sourceDir, destDir) {
  let count = 0;
  for (const entry of entries) {
    if (copyOneSkill(entry, sourceDir, destDir)) count++;
  }
  return count;
}

/**
 * Compare every copied skill's SHA-256 against its source, exiting non-zero on a mismatch.
 *
 * The messages start with `[verify]` so a reader can tell the post-copy check apart from
 * the copy progress, which is the whole reason the flag exists.
 */
function verifyCopiedSkills(entries, sourceDir, destDir, count) {
  console.log('');
  console.log('[verify] Checking SHA-256 integrity of copied skills...');
  let errors = 0;
  for (const entry of entries) errors += verifyOneSkill(entry, sourceDir, destDir);

  if (errors === 0) {
    console.log(`[verify] OK: all ${count} skill(s) verified (SHA-256 match)`);
    return;
  }
  console.error(`[verify] FAIL: ${errors} checksum error(s) found`);
  process.exit(1);
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
