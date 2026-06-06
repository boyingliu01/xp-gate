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
function runGitClone(repoUrl, destPath) {
  const cp = require('child_process');
  const result = cp.spawnSync(
    'git',
    ['clone', '--depth', '1', repoUrl, destPath],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, shell: false }
  );
  if (result.status === 0) return;
  const stderr = String(result.stderr ?? '').trim();
  throw new Error(stderr || `git clone exited with status ${result.status}`);
}

function ensureTargetDir(targetDir) {
  if (fs.existsSync(targetDir)) return null;
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    return null;
  } catch (e) {
    return { name: 'mkdir', message: `Cannot create skills directory: ${e.message}` };
  }
}

function versionMismatchError(versionMismatch) {
  return {
    name: versionMismatch.name,
    message: `version mismatch: need ${versionMismatch.required}, found ${versionMismatch.found} (auto-install cannot upgrade)`,
  };
}

function depExistsIn(skillsDirs, depName) {
  for (const baseDir of skillsDirs) {
    if (fs.existsSync(path.join(baseDir, depName))) return true;
  }
  return false;
}

function safeRemove(destPath) {
  try {
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
  } catch {
    // best-effort cleanup of partial clone
  }
}

function installOneDep(dep, targetDir) {
  const destPath = path.join(targetDir, dep.name);
  const repoUrl = `https://github.com/${dep.repo}.git`;
  try {
    console.log(`  ${dep.name}: not found → installing from ${repoUrl} ...`);
    runGitClone(repoUrl, destPath);
    console.log(`  ${dep.name}: OK`);
    return { ok: true };
  } catch (e) {
    const message = e.message || 'git clone failed';
    console.warn(`  ${dep.name}: FAILED (${message})`);
    safeRemove(destPath);
    return { ok: false, error: { name: dep.name, message } };
  }
}

async function autoInstallDeps(platform = 'opencode') {
  const skillsDirs = getSkillsDirs(platform);
  const targetDir = skillsDirs[0];

  const mkdirErr = ensureTargetDir(targetDir);
  if (mkdirErr) return { ok: false, errors: [mkdirErr] };

  const depCheck = await checkDeps(platform);
  if (depCheck.ok) return { ok: true, installed: [] };
  if (depCheck.versionMismatch) {
    return { ok: false, installed: [], errors: [versionMismatchError(depCheck.versionMismatch)] };
  }

  const errors = [];
  const installed = [];
  for (const dep of REQUIRED_DEPS) {
    if (depExistsIn(skillsDirs, dep.name)) continue;
    const result = installOneDep(dep, targetDir);
    if (result.ok) installed.push(dep.name);
    else errors.push(result.error);
  }

  if (errors.length > 0) return { ok: false, installed, errors };
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
