const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const { checkDeps } = require('./detect-deps.js');
const { downloadFromGitHub } = require('./download-skill.js');
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

function getCliVersion() {
  try {
    const versionFile = path.join(__dirname, '..', '..', '..', 'VERSION');
    return fs.readFileSync(versionFile, 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}

const SKILLS_REGISTRY = {
  'sprint-flow': { repo: 'boyingliu01/xp-gate', path: 'skills/sprint-flow' },
  'delphi-review': { repo: 'boyingliu01/xp-gate', path: 'skills/delphi-review' },
  'test-spec': { repo: 'boyingliu01/xp-gate', path: 'skills/test-spec' },
  'ralph-loop': { repo: 'boyingliu01/xp-gate', path: 'skills/ralph-loop' }
};

async function installSkill(name, options = {}) {
  const { offline = false, verbose = false, force = false } = options;

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

  const skillInfo = validateSkillRegistry(name);
  if (!skillInfo) return 1;

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
    const result = await performInstall(skillInfo, name, targetDir, offline, verbose);
    if (result !== 0) return result;
    return 0;
  } catch (err) {
    console.error(`Error: Install failed - ${err.message}`);
    await rollback(installId);
    return 1;
  }
}

function validateSkillRegistry(name) {
  const skillInfo = SKILLS_REGISTRY[name];
  if (!skillInfo) {
    console.error(`Error: Unknown skill: ${name}`);
    console.error('Available skills: ' + Object.keys(SKILLS_REGISTRY).join(', '));
    return null;
  }
  return skillInfo;
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

async function performInstall(skillInfo, name, targetDir, offline, verbose) {
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
