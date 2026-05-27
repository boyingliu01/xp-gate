const fs = require('fs');
const path = require('path');
const os = require('os');

// Cross-platform home directory resolution
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME, '.config', 'xp-gate');
const SKILLS_DIR = path.join(HOME, '.config', 'opencode', 'skills');

async function updateSkill(name, options = {}) {
  const { all = false, check = false, verbose = false } = options;
  
  if (check) {
    console.log('Checking for updates...');
    const config = getConfig();
    const skills = config.installedSkills || {};
    
    for (const [skillName, info] of Object.entries(skills)) {
      console.log(`  ${skillName}: ${info.version || 'unknown'}`);
    }
    console.log('Update check complete');
    return 0;
  }
  
  if (all) {
    const config = getConfig();
    const skills = config.installedSkills || {};
    
    console.log('Updating all skills...');
    let hasErrors = false;
    
    for (const skillName of Object.keys(skills)) {
      try {
        await updateSingleSkill(skillName, verbose);
      } catch (err) {
        console.error(`Failed to update ${skillName}: ${err.message}`);
        hasErrors = true;
      }
    }
    
    return hasErrors ? 1 : 0;
  }
  
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

async function updateSingleSkill(name, verbose) {
  console.log(`Updating ${name}...`);
  
  const targetDir = path.join(SKILLS_DIR, name);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true });
  }
  
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