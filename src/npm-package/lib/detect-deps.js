const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SKILLS_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'opencode', 'skills');
const OPENCODE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'opencode');

const REQUIRED_DEPS = [
  { name: 'superpowers', minVersion: '1.0.0' },
  { name: 'gstack', minVersion: '1.0.0' }
];

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

async function checkDeps() {
  for (const dep of REQUIRED_DEPS) {
    const possiblePaths = [
      path.join(SKILLS_DIR, dep.name),
      path.join(OPENCODE_DIR, dep.name)
    ];
    
    let depDir = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        depDir = p;
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

module.exports = { checkDeps, checkBash };