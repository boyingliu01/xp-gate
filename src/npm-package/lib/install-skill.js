const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const { checkDeps } = require('./detect-deps.js');
const { downloadFromGitHub } = require('./download-skill.js');
const { rollback } = require('./rollback.js');

// Cross-platform home directory resolution
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME, '.config', 'xp-gate');
const SKILLS_DIR = path.join(HOME, '.config', 'opencode', 'skills');

const SKILLS_REGISTRY = {
  'sprint-flow': { repo: 'boyingliu01/xp-gate', path: 'skills/sprint-flow' },
  'delphi-review': { repo: 'boyingliu01/xp-gate', path: 'skills/delphi-review' },
  'test-spec': { repo: 'boyingliu01/xp-gate', path: 'skills/test-spec' },
  'ralph-loop': { repo: 'boyingliu01/xp-gate', path: 'skills/ralph-loop' }
};

async function installSkill(name, options = {}) {
  const { offline = false, verbose = false, force = false } = options;
  
  const depCheck = await checkDeps();
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
  
  const skillInfo = SKILLS_REGISTRY[name];
  if (!skillInfo) {
    console.error(`Error: Unknown skill: ${name}`);
    console.error('Available skills: ' + Object.keys(SKILLS_REGISTRY).join(', '));
    return 1;
  }
  
  const targetDir = path.join(SKILLS_DIR, name);
  if (fs.existsSync(targetDir) && !force) {
    console.error(`Error: ${name} is already installed`);
    console.error('Use --force to overwrite');
    return 1;
  }
  
  const installId = `${name}-${Date.now()}`;
  const backupDir = path.join(CONFIG_DIR, 'backup', installId);
  
  if (fs.existsSync(targetDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    copyDirRecursive(targetDir, backupDir);
  }
  
  try {
    console.log(`Installing ${name}...`);
    
    const skillUrl = `https://raw.githubusercontent.com/${skillInfo.repo}/main/${skillInfo.path}/SKILL.md`;
    const targetFile = path.join(targetDir, 'SKILL.md');
    
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    
    let downloaded = false;
    if (!offline) {
      try {
        await downloadFile(skillUrl, targetFile, verbose);
        downloaded = true;
      } catch (err) {
        if (verbose) console.warn(`Download failed: ${err.message}`);
      }
    }
    
    if (!downloaded) {
      if (offline) {
        console.error(`Error: --offline specified but ${name} not in cache`);
        return 2;
      }
      console.error(`Error: Failed to download ${name}`);
      console.error('Check network connection');
      return 1;
    }
    
    ensureConfigDir();
    updateConfig({
      installedSkills: {
        ...(getConfig().installedSkills || {}),
        [name]: { version: '1.0.0', installedAt: new Date().toISOString() }
      }
    });
    
    if (verbose) console.log(`Installed to ${targetDir}`);
    console.log(`✓ ${name} installed`);
    
    return 0;
  } catch (err) {
    console.error(`Error: Install failed - ${err.message}`);
    await rollback(installId);
    return 1;
  }
}

async function downloadFile(url, dest, verbose) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    const protocol = url.startsWith('https') ? https : http;
    
    if (verbose) console.log(`Downloading ${url}...`);
    
    protocol.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        file.close();
        fs.unlinkSync(dest);
        downloadFile(redirectUrl, dest, verbose).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
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