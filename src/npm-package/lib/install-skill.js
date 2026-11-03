const fs = require('fs');
const path = require('path');
const { checkDeps } = require('./detect-deps.js');
const { rollback } = require('./rollback.js');
const { HOME_DIR, CONFIG_DIR, detectPlatform } = require('./shared-paths.js');
const { copyDirRecursive } = require('./shared-utils');

function getSkillsDir() {
  const platform = detectPlatform();
  if (platform === 'qoder') {
    return path.join(HOME_DIR, '.qoder', 'skills');
  }
  if (platform === 'claude-code') {
    return path.join(HOME_DIR, '.claude', 'skills');
  }
  return path.join(HOME_DIR, '.config', 'opencode', 'skills');
}

/**
 * Every platform skills directory that already holds an installed skill.
 *
 * #725: `detectPlatform()` short-circuits on the first marker it finds (`.qoder`
 * wins outright), so a machine that carries both Qoder and OpenCode only ever
 * had the Qoder copy updated -- the OpenCode copy was frozen at whatever version
 * last wrote it, and nothing reported it. Migration periods make two platforms
 * normal, not exotic: the user switched tools and both trees are still live.
 *
 * Only directories that already contain skills are returned. A platform the user
 * never installed into is left alone rather than seeded by an update, which would
 * be a surprising side effect of `update-skill`.
 *
 * @returns {string[]} home-relative skills directories, de-duplicated
 */
function deployedSkillsDirs() {
  const candidates = [
    path.join(HOME_DIR, '.qoder', 'skills'),
    path.join(HOME_DIR, '.config', 'opencode', 'skills'),
    path.join(HOME_DIR, '.claude', 'skills'),
  ];
  const found = [];
  for (const dir of candidates) {
    if (dirHasInstalledSkill(dir)) found.push(dir);
  }
  // A machine with no deployed skill anywhere still needs one target: fall back
  // to the detected platform so a plain `install-skill` keeps working.
  return found.length > 0 ? found : [getSkillsDir()];
}

/** @returns {boolean} true when `dir` contains at least one `<name>/SKILL.md` */
function dirHasInstalledSkill(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))
  );
}

// The npm package ships the canonical skill content; `files` includes skills/.
const BUNDLED_SKILLS_DIR = path.join(__dirname, '..', 'skills');

/**
 * The version of the CLI that is actually running.
 *
 * This used to read `../../../VERSION` relative to __dirname. Two things were
 * wrong with that (#713): three levels up from `node_modules/@boyingliu01/
 * xp-gate/lib` is `node_modules/`, and the package does not ship VERSION at all
 * (`files` omits it). The catch therefore returned `0.0.0` on every installed
 * machine, so `xp-gate 0.0.0 bundles: ...` -- printed as help when an unknown
 * skill is requested -- read as a corrupt installation rather than as a typo.
 *
 * package.json travels with the package by definition, so it is the only source
 * that is always present and always current.
 *
 * @returns {string} the package version, or 'unknown' if it cannot be read
 */
function getCliVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

// The table used to be a second, hand-maintained list of installable skills that
// could only ever lag behind the bundle. The bundle is the contract now: a skill
// the installed package does not carry is not installable, and must be answered
// by updating the package rather than by pulling a mismatched copy off GitHub.
function bundledSkills() {
  if (!fs.existsSync(BUNDLED_SKILLS_DIR)) return [];
  return fs
    .readdirSync(BUNDLED_SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(BUNDLED_SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

async function installSkill(name, options = {}) {
  const { verbose = false, force = false } = options;

  const platform = detectPlatform();
  const depCheck = await checkDeps(platform);
  if (!depCheck.ok) {
    if (depCheck.missing) {
      console.error(`Error: ${depCheck.missing} is required but not installed`);
      console.error('Please install superpowers and gstack first');
      console.error('See: https://github.com/boyingliu01/superpowers');
      return 1;
    }
    if (depCheck.versionMismatch) {
      console.error(`Error: ${depCheck.versionMismatch.name} version too old`);
      console.error(`Need: ${depCheck.versionMismatch.required}, Found: ${depCheck.versionMismatch.found}`);
      return 1;
    }
  }

  // Checked before any destructive step, because backupExisting() rmSyncs the
  // target directory: a skill this package does not carry must never be
  // installed by wiping what the user already has.
  const available = bundledSkills();
  if (!available.includes(name)) {
    console.error(`Error: Unknown skill: ${name}`);
    console.error(
      `xp-gate ${getCliVersion()} bundles: ${available.join(', ')}. ` +
      'Update the package (npm install -g @boyingliu01/xp-gate@latest) if you need ' + name + '.'
    );
    return 1;
  }

  // #725: update EVERY platform that already carries this skill, not just the
  // one `detectPlatform()` picks. A machine with both Qoder and OpenCode used to
  // get one silently-frozen copy. Each target is installed independently so a
  // failure on one platform does not abort the others -- a half-updated machine
  // that reports success is exactly the bug being fixed.
  //
  // deployedSkillsDirs() already falls back to the detected platform when nothing
  // is deployed anywhere, so it never returns an empty list.
  const finalTargets = deployedSkillsDirs().map((dir) => path.join(dir, name));

  let lastError = 0;
  for (const targetDir of finalTargets) {
    const dupError = checkDuplicateInstall(targetDir, force);
    if (dupError) {
      console.error(dupError);
      lastError = 1;
      continue;
    }

    // The platform segment keeps concurrent per-platform backups distinct; a bare
    // `Date.now()` collided when both platforms were written in the same tick.
    const platformTag = path.basename(path.dirname(targetDir));
    const installId = `${name}-${Date.now()}-${platformTag}`;
    const backupDir = path.join(CONFIG_DIR, 'backup', installId);
    backupExisting(targetDir, installId, backupDir);

    try {
      if (verbose && finalTargets.length > 1) console.log(`Target: ${targetDir}`);
      const result = await performInstall(name, targetDir, verbose);
      if (result !== 0) lastError = result;
    } catch (err) {
      console.error(`Error: Install failed - ${err.message}`);
      await rollback(installId);
      lastError = 1;
    }
  }

  return lastError;
}

function checkDuplicateInstall(targetDir, force) {
  if (fs.existsSync(targetDir) && !force) {
    return `Error: ${path.basename(targetDir)} is already installed\nUse --force to overwrite`;
  }
  return null;
}

function backupExisting(targetDir, installId, backupDir) {
  if (fs.existsSync(targetDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    copyDirRecursive(targetDir, backupDir);
    // CRITICAL: remove original BEFORE fresh install so old reference/ files don't leak through
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

async function performInstall(name, targetDir, verbose) {
  console.log(`Installing ${name}...`);

  // The package ships skills/<name>/ with its references/, templates/ and
  // scripts/, and that copy is what doctor compares against. A single SKILL.md
  // downloaded from `main` used to be the whole install, so 8 of 13 skills
  // landed without the files their own SKILL.md tells the agent to read,
  // update-skill wiped complete directories down to that one file, and the
  // installed content drifted from the CLI version (#416).
  copyDirRecursive(path.join(BUNDLED_SKILLS_DIR, name), targetDir);

  ensureConfigDir();

  // Read actual CLI version from VERSION file
  const version = getCliVersion();

  updateConfig({
    installedSkills: {
      ...(getConfig().installedSkills || {}),
      [name]: { version, installedAt: new Date().toISOString() }
    }
  });

  if (verbose) console.log(`Installed to ${targetDir}`);
  console.log(`✓ ${name} installed`);
  return 0;
}

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function getConfig() {
  const configFile = path.join(CONFIG_DIR, 'xp-gate.json');
  if (fs.existsSync(configFile)) {
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch {}
  }
  return {};
}

function updateConfig(updates) {
  const configFile = path.join(CONFIG_DIR, 'xp-gate.json');
  const config = getConfig();
  Object.assign(config, updates);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

module.exports = { installSkill };
