const fs = require('fs');
const path = require('path');
const os = require('os');

// Cross-platform home directory resolution
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME, '.config', 'xp-gate');

/**
 * The skill names this package ships.
 *
 * `skills/` is the bundle contract: a skill the installed package does not carry
 * is not ours to touch. Resolved lazily so a caller that stubs out the package
 * layout still gets a sensible empty set instead of a throw at require() time.
 *
 * @returns {Set<string>} bundled skill directory names
 */
function bundledSkillNames() {
  const dir = path.join(__dirname, '..', 'skills');
  try {
    return new Set(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))
        )
        .map((entry) => entry.name)
    );
  } catch {
    return new Set();
  }
}

/**
 * The skill names that are actually deployed on this machine.
 *
 * `xp-gate init` / `setup-global` copy skills onto disk but never write
 * `config.installedSkills`, so the config registry is empty on a fully
 * deployed machine. Iterating it made `update-skill --all` print
 * "Updating all skills..." and exit 0 having touched nothing (#682) -- the
 * same defect #635 fixed for `doctor`, with the same fix: ask the filesystem.
 *
 * Enumerating the filesystem alone is too wide, though (#713). A skill
 * directory is a shared namespace -- every skill tool uses the same
 * `<dir>/<name>/SKILL.md` layout -- so on a machine that also carries other
 * bundles, `--all` walked all of them, printed `Error: Unknown skill: <name>`
 * for each, and advised `npm install -g xp-gate@latest` to obtain a skill this
 * package does not and will never ship. Scanned names are therefore filtered
 * against the bundle: the candidate set is the intersection, not the union.
 *
 * The explicit registry is still unioned in, so a skill that is merely
 * registered (or was installed on a platform this scan cannot see) keeps
 * working for callers that rely on it -- but only when the package really
 * carries it, for the same reason as above.
 *
 * @returns {string[]} de-duplicated skill names, in a stable order
 */
function installedSkillNames() {
  const bundled = bundledSkillNames();
  const names = new Set();

  // Registry first: a skill can be registered on a platform this scan cannot see.
  for (const name of Object.keys(getConfig().installedSkills || {})) {
    if (bundled.has(name)) names.add(name);
  }

  for (const name of bundledNamesOnDisk(bundled)) names.add(name);
  return [...names].sort();
}

/**
 * Bundled skill names that are actually deployed on this machine.
 *
 * Split out of installedSkillNames() because the per-platform probing is three
 * nested try/catch levels deep on its own: reading a directory that may not
 * exist, on a platform whose detection may itself throw. Flattening it into a
 * named loop keeps each failure mode visible instead of piling onto one
 * function's complexity budget.
 *
 * Every unreadable location is skipped silently -- an absent platform is the
 * normal case on any given machine, not an error worth reporting mid-update.
 *
 * @param {Set<string>} bundled names the package ships; anything else is not ours
 * @returns {string[]} deployed-and-bundled skill names
 */
function bundledNamesOnDisk(bundled) {
  const found = [];
  let detect;
  let platforms;
  try {
    detect = require('./detect-deps.js');
    platforms = Object.keys(detect.PLATFORM_PROFILES);
  } catch {
    // detect-deps unavailable: the registry half of installedSkillNames() still
    // applies, so returning nothing here does not report "no skills installed".
    return found;
  }

  for (const platform of platforms) {
    for (const entry of readSkillsDirEntries(detect, platform)) {
      if (!entry.isDirectory || !bundled.has(entry.name)) continue;
      if (fs.existsSync(path.join(entry.dir, entry.name, 'SKILL.md'))) found.push(entry.name);
    }
  }
  return found;
}

/**
 * Read one platform's skills directory as plain records, so callers get the
 * directory back without depending on dirent internals.
 * @returns {Array<{name: string, isDirectory: boolean, dir: string}>} empty when unreadable
 */
function readSkillsDirEntries(detect, platform) {
  let dir;
  try {
    dir = detect.getSkillsDirs(platform)[0];
  } catch {
    return [];
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), dir }));
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