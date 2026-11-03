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

/**
 * The version of the CLI that is running, for comparing against what is on disk.
 *
 * Same source as install-skill.js reads (#713): the installed package.json, not
 * the repo-root VERSION file, which the published tarball does not ship.
 *
 * @returns {string} semver, or 'unknown' when the package metadata is unreadable
 */
function getCliVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Compare a 4-part release stamp against a 3-part npm semver.
 *
 * A trailing `.0` is the only difference between the two schemes, so trimming it
 * is enough -- this is deliberately not a full semver comparison, which would
 * imply support for pre-release ordering that neither source produces.
 *
 * @returns {boolean} true when both name the same release
 */
function sameVersion(a, b) {
  const norm = (v) => String(v).replace(/.0+$/, '');
  return norm(a) === norm(b);
}

/**
 * Whether a deployed copy is byte-identical to the bundle this CLI ships.
 *
 * Most skills carry no AGENTS.md, so their only version marker is `unknown`. That
 * is not evidence of staleness -- treating it as such flagged every skill on a
 * healthy machine. Content comparison answers the question the version stamp was
 * standing in for, and answers it for those skills too.
 *
 * Only SKILL.md is compared: it is the file every skill has, and it is the one
 * `update-skill` rewrites. Anything else a user added locally must not make their
 * copy look outdated.
 *
 * @param {string} skillName
 * @param {{dir: string}} entry a deployed copy
 * @returns {boolean} true when the copy already matches the bundle
 */
function copyMatchesBundle(skillName, entry) {
  const bundled = path.join(__dirname, '..', 'skills', skillName, 'SKILL.md');
  const installed = path.join(entry.dir, 'SKILL.md');
  try {
    return fs.readFileSync(installed, 'utf8') === fs.readFileSync(bundled, 'utf8');
  } catch {
    // Unreadable either way: fall back to the version stamp's verdict rather than
    // asserting a match we could not verify.
    return false;
  }
}

function handleCheckMode() {
  console.log('Checking for updates...');
  const config = getConfig();
  const skills = config.installedSkills || {};

  // #725: this used to print config.installedSkills[name].version and call it a
  // day. That value is what the last install WROTE DOWN, not what is on disk, so
  // a copy left behind by a single-platform update reported the new version while
  // its files still said the old one. Reporting the registry as if it were the
  // installation is how a stale skill looked healthy.
  const bundledVersion = getCliVersion();
  let stale = 0;

  for (const [skillName, info] of Object.entries(skills)) {
    const registry = info.version || 'unknown';
    const onDisk = deployedSkillVersions(skillName);
    if (onDisk.length === 0) {
      console.log(`  ${skillName}: ${registry} (registry only - no copy found on disk)`);
      continue;
    }
    // AGENTS.md stamps the 4-part release version (0.35.24.0) while package.json
    // carries the 3-part npm semver (0.35.24). Comparing them raw marked every
    // copy on a healthy machine as behind -- a false alarm is as useless as no
    // check at all, so normalize before comparing.
    // A copy is behind when its version stamp says so. Only a copy with NO stamp
    // falls back to content comparison -- a known-old stamp must not be excused by
    // an identical SKILL.md, which is exactly the delphi-review case: the two
    // platform copies differ only in the generated AGENTS.md header.
    const behind = onDisk.filter((entry) => (entry.version === 'unknown'
      ? !copyMatchesBundle(skillName, entry)
      : !sameVersion(entry.version, bundledVersion)));
    if (behind.length > 0) {
      stale += behind.length;
      for (const entry of behind) {
        console.log(`  ${skillName} [${entry.platform}]: ${entry.version} -> ${bundledVersion} available`);
      }
    } else {
      console.log(`  ${skillName}: ${bundledVersion} (up to date on ${onDisk.length} platform(s))`);
    }
  }

  console.log(stale > 0 ? `Update check complete — ${stale} copy(ies) behind.` : 'Update check complete');
  return 0;
}

/**
 * Versions actually written into each platform's copy of \`skillName\`.
 *
 * Reads the \`**Version:**\` stamp from the generated AGENTS.md, which is the only
 * per-copy version marker an installed skill carries. A copy without one (older
 * layouts, or a hand-written skill) reports \`unknown\` rather than being skipped --
 * silently omitting it would hide exactly the stale copy this check exists for.
 *
 * @param {string} skillName
 * @returns {Array<{platform: string, version: string, dir: string}>} one entry per deployed copy
 */
function deployedSkillVersions(skillName) {
  let detect;
  try {
    detect = require('./detect-deps.js');
  } catch {
    return [];
  }
  const found = [];
  for (const platform of Object.keys(detect.PLATFORM_PROFILES)) {
    for (const entry of readSkillsDirEntries(detect, platform)) {
      if (!entry.isDirectory || entry.name !== skillName) continue;
      const agentsFile = path.join(entry.dir, entry.name, 'AGENTS.md');
      let version = 'unknown';
      try {
        const match = fs.readFileSync(agentsFile, 'utf8').match(/^\*\*Version:\*\*\s*(\S+)/m);
        if (match) version = match[1];
      } catch {
        // No AGENTS.md: still count the copy, with an unknown stamp.
      }
      found.push({ platform, version, dir: path.join(entry.dir, entry.name) });
    }
  }
  return found;
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