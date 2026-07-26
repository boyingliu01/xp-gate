/**
 * TUI registration and installed-skills diagnostics for doctor.
 * Extracted from doctor.js to keep file size under the large-file threshold.
 */
const fs = require('fs');
const path = require('path');
const { HOME_DIR, detectPlatform } = require('./shared-paths.js');

// npm package source dir (template hooks/adapters)
const PKG_DIR = path.dirname(__dirname);

/**
 * TUI registration path and expected plugin entry.
 */
const TUI_JSON_PATH = path.join(HOME_DIR, '.config', 'opencode', 'tui.json');
const TUI_PLUGIN_ENTRY = '@boyingliu01/opencode-plugin/tui';

/**
 * Read and parse tui.json, returning { data, error }.
 * data = parsed object on success, null on file missing, undefined on corrupt.
 */
function readTuiJson() {
  if (!fs.existsSync(TUI_JSON_PATH)) return { data: null, error: null };
  try {
    const raw = fs.readFileSync(TUI_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    return { data, error: null };
  } catch (e) {
    return { data: undefined, error: `Corrupt JSON: ${e.message}` };
  }
}

/**
 * Check 9: TUI auto-registration in ~/.config/opencode/tui.json.
 * @returns {number} issue count
 */
function diagnoseTuiRegistration(checks) {
  const { data, error } = readTuiJson();

  if (error) {
    checks.push({ name: 'TUI registration', status: 'FAIL', detail: error });
    return 1;
  }

  if (data === null) {
    checks.push({ name: 'TUI registration', status: 'FAIL', detail: 'Not registered' });
    return 1;
  }

  const plugins = Array.isArray(data.plugin) ? data.plugin : [];
  if (plugins.includes(TUI_PLUGIN_ENTRY)) {
    checks.push({ name: 'TUI registration', status: 'PASS', detail: `${TUI_PLUGIN_ENTRY} registered` });
    return 0;
  }

  checks.push({ name: 'TUI registration', status: 'FAIL', detail: 'Not registered' });
  return 1;
}

/**
 * Extract version from SKILL.md YAML frontmatter (between first --- and second ---).
 * Returns version string or undefined if no version field found.
 * @param {string} content - SKILL.md file content
 * @returns {string|undefined}
 */
function extractSkillVersion(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return undefined;
  const frontmatter = match[1];
  const versionMatch = frontmatter.match(/version:\s*(\S+)/);
  return versionMatch ? versionMatch[1] : undefined;
}

/**
 * Compare two semver strings. Returns:
 *   -1 if a < b, 0 if a == b, 1 if a > b, undefined if either is not valid semver.
 * @param {string} a
 * @param {string} b
 * @returns {number|undefined}
 */
function compareSemver(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  if (aParts.some(n => isNaN(n)) || bParts.some(n => isNaN(n))) return undefined;
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const na = aParts[i] || 0;
    const nb = bParts[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Check 9: Installed skills vs package-bundled skills (#332).
 * Uses semver version comparison on SKILL.md frontmatter when available;
 * falls back to byte-for-byte content comparison for skills without version field.
 * @param {object} config
 * @param {Array} checks
 * @returns {number} issue count
 */
function diagnoseInstalledSkills(config, checks) {
  const installedSkills = config.installedSkills || {};
  const skillNames = Object.keys(installedSkills);
  if (skillNames.length === 0) {
    checks.push({ name: 'Installed skills', status: 'SKIP', detail: 'No skills installed' });
    return 0;
  }

  const bundledSkillsDir = path.join(PKG_DIR, 'skills');
  if (!fs.existsSync(bundledSkillsDir)) {
    checks.push({ name: 'Installed skills', status: 'SKIP', detail: 'Package skills dir not found' });
    return 0;
  }

  const platform = detectPlatform();
  let userSkillsDir;
  if (platform === 'qoder') {
    userSkillsDir = path.join(HOME_DIR, '.qoder', 'skills');
  } else if (platform === 'claude-code') {
    userSkillsDir = path.join(HOME_DIR, '.claude', 'skills');
  } else {
    userSkillsDir = path.join(HOME_DIR, '.config', 'opencode', 'skills');
  }

  let issues = 0;
  for (const name of skillNames) {
    const bundledSkillMd = path.join(bundledSkillsDir, name, 'SKILL.md');
    const userSkillMd = path.join(userSkillsDir, name, 'SKILL.md');

    if (!fs.existsSync(bundledSkillMd)) continue;
    if (!fs.existsSync(userSkillMd)) {
      checks.push({ name: `Skill: ${name}`, status: 'FAIL', detail: 'Installed SKILL.md missing' });
      issues++;
      continue;
    }

    const bundledContent = fs.readFileSync(bundledSkillMd, 'utf8');
    const userContent = fs.readFileSync(userSkillMd, 'utf8');

    // Try semver comparison if both SKILL.md files have version frontmatter
    const bundledVersion = extractSkillVersion(bundledContent);
    const userVersion = extractSkillVersion(userContent);

    if (bundledVersion !== undefined && userVersion !== undefined) {
      const cmp = compareSemver(userVersion, bundledVersion);
      if (cmp === undefined) {
        // Version strings not valid semver — fall back to byte comparison
        if (bundledContent !== userContent) {
          checks.push({
            name: `Skill: ${name}`,
            status: 'WARN',
            detail: `Outdated — run xp-gate update-skill --all (installed: ${userVersion}, bundled: ${bundledVersion})`,
          });
          issues++;
        } else {
          checks.push({ name: `Skill: ${name}`, status: 'PASS', detail: 'Up to date' });
        }
      } else if (cmp < 0) {
        checks.push({
          name: `Skill: ${name}`,
          status: 'WARN',
          detail: `Outdated — run xp-gate update-skill --all (installed: ${userVersion}, bundled: ${bundledVersion})`,
        });
        issues++;
      } else {
        // cmp >= 0: installed version is same or newer than bundled
        checks.push({ name: `Skill: ${name}`, status: 'PASS', detail: 'Up to date' });
      }
    } else {
      // No version in at least one file — fall back to byte-for-byte comparison
      if (bundledContent !== userContent) {
        checks.push({
          name: `Skill: ${name}`,
          status: 'WARN',
          detail: 'Outdated — run xp-gate update-skill --all',
        });
        issues++;
      } else {
        checks.push({ name: `Skill: ${name}`, status: 'PASS', detail: 'Up to date' });
      }
    }
  }

  return issues;
}

/**
 * Fix TUI registration: ensure @boyingliu01/opencode-plugin/tui is in tui.json.
 * Uses atomic write (tmp + renameSync) for JSON safety.
 * On corrupt JSON: backup to .corrupt-{timestamp}.bak then rebuild.
 * Idempotent: skips if already registered.
 * @returns {boolean} Whether a fix was applied
 */
function fixTuiRegistration() {
  const { data, error } = readTuiJson();

  // Corrupt JSON: backup old file, rebuild from scratch
  if (error && data === undefined) {
    const ts = Date.now();
    const backupPath = `${TUI_JSON_PATH}.corrupt-${ts}.bak`;
    try {
      fs.copyFileSync(TUI_JSON_PATH, backupPath);
      console.log(`  ⚠ TUI config corrupted — backed up to ${backupPath}`);
    } catch { /* non-critical */ }
    // Rebuild fresh
    const dir = path.dirname(TUI_JSON_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const newConfig = { plugin: [TUI_PLUGIN_ENTRY] };
    const tmpPath = `${TUI_JSON_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2));
    fs.renameSync(tmpPath, TUI_JSON_PATH);
    console.log(`  ✓ Registered ${TUI_PLUGIN_ENTRY} in TUI (rebuilt after corrupt backup)`);
    return true;
  }

  // File doesn't exist: create it
  if (data === null) {
    const dir = path.dirname(TUI_JSON_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const newConfig = { plugin: [TUI_PLUGIN_ENTRY] };
    const tmpPath = `${TUI_JSON_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2));
    fs.renameSync(tmpPath, TUI_JSON_PATH);
    console.log(`  ✓ Created TUI config with ${TUI_PLUGIN_ENTRY}`);
    return true;
  }

  // File exists, check if plugin already registered (idempotent)
  const plugins = Array.isArray(data.plugin) ? data.plugin : [];
  if (plugins.includes(TUI_PLUGIN_ENTRY)) return false;

  // Append plugin entry
  data.plugin = plugins.concat([TUI_PLUGIN_ENTRY]);
  const tmpPath = `${TUI_JSON_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, TUI_JSON_PATH);
  console.log(`  ✓ Added ${TUI_PLUGIN_ENTRY} to TUI config`);
  return true;
}

/**
 * Wrapper for init.js: ensure TUI is registered without console output.
 * Returns true if the plugin is already registered or was just added.
 */
function ensureTuiRegistration() {
  const { data } = readTuiJson();
  if (data === null || data === undefined) {
    fixTuiRegistration();
    return;
  }
  const plugins = Array.isArray(data.plugin) ? data.plugin : [];
  if (!plugins.includes(TUI_PLUGIN_ENTRY)) {
    fixTuiRegistration();
  }
}

module.exports = {
  TUI_JSON_PATH,
  TUI_PLUGIN_ENTRY,
  readTuiJson,
  diagnoseTuiRegistration,
  diagnoseInstalledSkills,
  fixTuiRegistration,
  ensureTuiRegistration,
  extractSkillVersion,
  compareSemver,
};
