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

// The npm package ships the canonical skill content; `files` includes skills/.
const BUNDLED_SKILLS_DIR = path.join(__dirname, '..', 'skills');

function getCliVersion() {
  try {
    const versionFile = path.join(__dirname, '..', '..', '..', 'VERSION');
    return fs.readFileSync(versionFile, 'utf8').trim();
  } catch {
    return '0.0.0';
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

  const targetDir = path.join(getSkillsDir(), name);
  const dupError = checkDuplicateInstall(targetDir, force);
  if (dupError) {
    console.error(dupError);
    return 1;
  }

  const installId = `${name}-${Date.now()}`;
  const backupDir = path.join(CONFIG_DIR, 'backup', installId);
  backupExisting(targetDir, installId, backupDir);

  try {
    const result = await performInstall(name, targetDir, verbose);
    if (result !== 0) return result;
    return 0;
  } catch (err) {
    console.error(`Error: Install failed - ${err.message}`);
    await rollback(installId);
    return 1;
  }
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
