const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { HOME_DIR } = require('./shared-paths.js');

const REQUIRED_DEPS = [
  { name: 'superpowers', repo: 'obra/superpowers', minVersion: '1.0.0' },
  { name: 'gstack', repo: 'garrytan/gstack', minVersion: '1.0.0' }
];

/**
 * Platform profiles — each AI agent platform has its own skills directory.
 * All platforms require the same dependencies (superpowers, gstack).
 *
 * @covers Issue #128 Bug 1 — Qoder platform was excluded from dependency checks
 */
const PLATFORM_PROFILES = {
  opencode: {
    skillsDirs: [
      path.join(HOME_DIR, '.config', 'opencode', 'skills'),
      path.join(HOME_DIR, '.config', 'opencode'),
    ],
    requiredDeps: REQUIRED_DEPS,
  },
  'claude-code': {
    skillsDirs: [
      path.join(HOME_DIR, '.claude', 'skills'),
      path.join(HOME_DIR, '.claude'),
    ],
    requiredDeps: REQUIRED_DEPS,
  },
  qoder: {
    skillsDirs: [
      path.join(HOME_DIR, '.qoder', 'skills'),
      path.join(HOME_DIR, '.qoder'),
    ],
    requiredDeps: REQUIRED_DEPS,
  },
};

/**
 * Detect which AI agent platform is currently in use.
 * Checks for platform-specific directories in the user's home.
 * Falls back to 'opencode' if no platform is detected.
 *
 * @returns {'opencode' | 'claude-code' | 'qoder'}
 */
function detectPlatform() {
  // Check for Qoder-specific marker
  if (fs.existsSync(path.join(HOME_DIR, '.qoder', 'skills'))) {
    return 'qoder';
  }
  // Check for Claude Code-specific marker
  if (fs.existsSync(path.join(HOME_DIR, '.claude', 'skills'))) {
    return 'claude-code';
  }
  // Default to opencode (most common, backward compatible)
  return 'opencode';
}

/**
 * Get the skills directories for a given platform.
 * @param {string} platform - 'opencode' | 'claude-code' | 'qoder'
 * @returns {string[]}
 */
function getSkillsDirs(platform) {
  const profile = PLATFORM_PROFILES[platform] || PLATFORM_PROFILES.opencode;
  return profile.skillsDirs;
}

/**
 * Check if bash is available on the system.
 * XP-Gate hooks are bash scripts — Windows users need Git Bash installed.
 * @returns {{ok: boolean, path?: string, message?: string}}
 */
function checkBash() {
  try {
    // Try 'bash' first (works on Linux/macOS and when Git Bash is in PATH)
    const result = execSync('bash --version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const versionMatch = result.match(/version\s+([^\s]+)/);
    return {
      ok: true,
      path: 'bash',
      version: versionMatch ? versionMatch[1] : 'unknown'
    };
  } catch (e) {
    // On Windows with Git Bash, try common locations
    const bashPaths = [
      // Git for Windows
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
      // MSYS2
      'C:\\msys64\\usr\\bin\\bash.exe',
      // Cygwin
      'C:\\cygwin64\\bin\\bash.exe',
    ];

    for (const bashPath of bashPaths) {
      try {
        const result = execSync(`"${bashPath}" --version`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        });
        const versionMatch = result.match(/version\s+([^\s]+)/);
        return {
          ok: true,
          path: bashPath,
          version: versionMatch ? versionMatch[1] : 'unknown'
        };
      } catch {
        // Try next path
      }
    }

    // Windows-specific guidance
    if (process.platform === 'win32') {
      return {
        ok: false,
        message: 'bash not found. Windows users must install [Git for Windows](https://git-scm.com/download/win).\n' +
          '   During installation, ensure "Git Bash Here" is checked — this adds bash.exe to PATH.\n' +
          '   After installation, restart your terminal and run `npm install` again.'
      };
    }

    return {
      ok: false,
      message: 'bash not found. Please install bash and ensure it is in PATH.'
    };
  }
}

/**
 * Check if required dependencies are installed for the given platform.
 * @param {string} [platform='opencode'] - AI agent platform
 * @returns {Promise<{ok: boolean, missing?: string, versionMismatch?: object}>}
 */
async function checkDeps(platform = 'opencode') {
  const skillsDirs = getSkillsDirs(platform);

  for (const dep of REQUIRED_DEPS) {
    let depDir = null;
    for (const baseDir of skillsDirs) {
      const candidate = path.join(baseDir, dep.name);
      if (fs.existsSync(candidate)) {
        depDir = candidate;
        break;
      }
    }

    if (!depDir) {
      return { ok: false, missing: dep.name };
    }

    const version = await getSkillVersion(depDir);
    if (version && compareVersions(version, dep.minVersion) < 0) {
      return {
        ok: false,
        versionMismatch: {
          name: dep.name,
          required: dep.minVersion,
          found: version
        }
      };
    }
  }

  return { ok: true };
}

/**
 * Auto-install missing dependencies by cloning from GitHub.
 * @param {string} [platform='opencode'] - AI agent platform
 * @returns {Promise<{ok: boolean, installed?: string[], errors?: Array<{name: string, message: string}>}>}
 */
async function autoInstallDeps(platform = 'opencode') {
  const skillsDirs = getSkillsDirs(platform);
  const targetDir = skillsDirs[0]; // Install to the primary skills directory

  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      return {
        ok: false,
        errors: [{ name: 'mkdir', message: `Cannot create skills directory: ${e.message}` }]
      };
    }
  }

  const check = await checkDeps(platform);
  if (check.ok) {
    return { ok: true, installed: [] };
  }

  const errors = [];
  const installed = [];

  // Check each dep: missing → install, version mismatch → can't auto-fix
  const depCheck = await checkDeps(platform);
  if (depCheck.ok) {
    return { ok: true, installed: [] };
  }

  // If the issue is version mismatch, auto-install can't help
  if (depCheck.versionMismatch) {
    return {
      ok: false,
      installed: [],
      errors: [{
        name: depCheck.versionMismatch.name,
        message: `version mismatch: need ${depCheck.versionMismatch.required}, found ${depCheck.versionMismatch.found} (auto-install cannot upgrade)`
      }]
    };
  }

  for (const dep of REQUIRED_DEPS) {
    // Re-check if this specific dep is missing
    let exists = false;
    for (const baseDir of skillsDirs) {
      if (fs.existsSync(path.join(baseDir, dep.name))) {
        exists = true;
        break;
      }
    }
    if (exists) continue;

    const destPath = path.join(targetDir, dep.name);
    const repoUrl = `https://github.com/${dep.repo}.git`;

    try {
      console.log(`  ${dep.name}: not found → installing from ${repoUrl} ...`);
      const cp = require('child_process');
      cp.execSync(`git clone --depth 1 "${repoUrl}" "${destPath}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000, // 2 minute timeout
      });
      installed.push(dep.name);
      console.log(`  ${dep.name}: OK`);
    } catch (e) {
      errors.push({ name: dep.name, message: e.message || 'git clone failed' });
      console.warn(`  ${dep.name}: FAILED (${e.message || 'unknown error'})`);
      // Clean up partial clone
      try {
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup failures
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, installed, errors };
  }

  return { ok: true, installed };
}

async function getSkillVersion(skillDir) {
  const pkgFile = path.join(skillDir, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      return pkg.version;
    } catch {}
  }

  const skillFile = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillFile)) {
    const content = fs.readFileSync(skillFile, 'utf8');
    const versionMatch = content.match(/^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?/m);
    if (versionMatch) {
      return versionMatch[1];
    }
  }

  return null;
}

function compareVersions(a, b) {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;
    if (partA > partB) return 1;
    if (partA < partB) return -1;
  }

  return 0;
}

module.exports = {
  checkDeps,
  checkBash,
  autoInstallDeps,
  detectPlatform,
  getSkillsDirs,
  PLATFORM_PROFILES,
  REQUIRED_DEPS,
};
