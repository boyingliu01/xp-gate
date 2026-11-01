const fs = require('fs');
const path = require('path');
const os = require('os');

// Cross-platform home directory resolution
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME, '.config', 'xp-gate');

/**
 * The skill names that are actually deployed on this machine.
 *
 * `xp-gate init` / `setup-global` copy skills onto disk but never write
 * `config.installedSkills`, so the config registry is empty on a fully
 * deployed machine. Iterating it made `update-skill --all` print
 * "Updating all skills..." and exit 0 having touched nothing (#682) -- the
 * same defect #635 fixed for `doctor`, with the same fix: ask the filesystem.
 *
 * The explicit registry is still unioned in, so a skill that is merely
 * registered (or was installed on a platform this scan cannot see) keeps
 * working for callers that rely on it.
 *
 * @returns {string[]} de-duplicated skill names, in a stable order
 */
function installedSkillNames() {
  const names = new Set();
  const config = getConfig();
  for (const name of Object.keys(config.installedSkills || {})) names.add(name);

  let platforms = [];
  try {
    platforms = Object.keys(require('./detect-deps.js').PLATFORM_PROFILES);
  } catch {
    // detect-deps unavailable: fall back to the registry only rather than
    // reporting "nothing installed" for a machine that has skills on disk.
    platforms = [];
  }
  const detect = require('./detect-deps.js');
  for (const platform of platforms) {
    let dir;
    try {
      dir = detect.getSkillsDirs(platform)[0];
    } catch {
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // A skill is `<dir>/<name>/SKILL.md` — the shape install-skill writes.
      if (fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))) names.add(entry.name);
    }
  }
  return [...names].sort();
}

function handleCheckMode() {
  console.log('Checking for updates...');
  const config = getConfig();
  const skills = config.installedSkills || {};
  for (const [skillName, info] of Object.entries(skills)) {
    console.log(`  ${skillName}: ${info.version || 'unknown'}`);
  }
  console.log('Update check complete');
  return 0;
}

async function handleAllMode(verbose) {
  const names = installedSkillNames();
  console.log('Updating all skills...');
  // #635/#682: an empty run must say so. Exiting 0 after "Updating all skills..."
  // with no further output reads as success, and was how this stayed broken.
  if (names.length === 0) {
    console.log('No skills installed — nothing to update.');
    return 0;
  }
  let hasErrors = false;
  for (const skillName of names) {
    try {
      await updateSingleSkill(skillName, verbose);
    } catch (err) {
      console.error(`Failed to update ${skillName}: ${err.message}`);
      hasErrors = true;
    }
  }
  return hasErrors ? 1 : 0;
}

function handleSingleMode(name, verbose) {
  if (!name) {
    console.error('Error: Skill name required');
    console.error('Usage: xp-gate update-skill <name> or --all');
    return 1;
  }
  const config = getConfig();
  const skills = config.installedSkills || {};
  if (!skills[name]) {
    console.error(`Error: ${name} is not installed`);
    return 1;
  }
  return updateSingleSkill(name, verbose);
}

async function updateSkill(name, options = {}) {
  const { all = false, check = false, verbose = false } = options;
  if (check) return handleCheckMode();
  if (all) return handleAllMode(verbose);
  return handleSingleMode(name, verbose);
}

async function updateSingleSkill(name, verbose) {
  console.log(`Updating ${name}...`);

  // Everything destructive lives behind installSkill()'s validation: it resolves
  // the platform skills directory, backs the existing copy up, and only then
  // replaces it. Deleting here first (#416) wiped the wrong copy on Qoder and
  // Claude Code, and turned an update of a skill the package no longer carries
  // into an unrecoverable loss.
  const { installSkill } = require('./install-skill.js');
  const result = await installSkill(name, { force: true, verbose });
  
  if (result === 0) {
    console.log(`✓ ${name} updated`);
  }
  
  return result;
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

module.exports = { updateSkill };