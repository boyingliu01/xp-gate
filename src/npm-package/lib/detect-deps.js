const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(process.env.HOME, '.config', 'opencode', 'skills');
const OPENCODE_DIR = path.join(process.env.HOME, '.config', 'opencode');

const REQUIRED_DEPS = [
  { name: 'superpowers', minVersion: '1.0.0' },
  { name: 'gstack', minVersion: '1.0.0' }
];

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

module.exports = { checkDeps };