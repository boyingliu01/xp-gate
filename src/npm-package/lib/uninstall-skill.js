const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.env.HOME, '.config', 'xp-gate');
const CACHE_DIR = path.join(CONFIG_DIR, 'cache');
const SKILLS_DIR = path.join(process.env.HOME, '.config', 'opencode', 'skills');

async function uninstallSkill(name, options = {}) {
  const { force = false } = options;
  
  if (!name) {
    console.error('Error: Skill name required');
    console.error('Usage: xp-gate uninstall-skill <name> [--force]');
    return 1;
  }
  
  const targetDir = path.join(SKILLS_DIR, name);
  
  if (!fs.existsSync(targetDir)) {
    console.error(`Error: ${name} is not installed`);
    return 1;
  }
  
  if (!force) {
    console.log(`Uninstall ${name}? This will remove ${targetDir}`);
    console.log('Use --force to skip confirmation');
    return 0;
  }
  
  console.log(`Removing ${name}...`);
  
  fs.rmSync(targetDir, { recursive: true });
  
  const cacheFile = path.join(CACHE_DIR, `${name}.tgz`);
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
  }
  
  const config = getConfig();
  if (config.installedSkills) {
    delete config.installedSkills[name];
    saveConfig(config);
  }
  
  console.log(`✓ ${name} uninstalled`);
  
  return 0;
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

function saveConfig(config) {
  const configFile = path.join(CONFIG_DIR, 'xp-gate.json');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

module.exports = { uninstallSkill };