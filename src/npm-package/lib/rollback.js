const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.env.HOME, '.config', 'xgate');
const BACKUP_DIR = path.join(CONFIG_DIR, 'backup');

async function rollback(installId) {
  const backupDir = path.join(BACKUP_DIR, installId);
  
  if (!fs.existsSync(backupDir)) {
    return;
  }
  
  console.log('Rolling back...');
  
  const entries = fs.readdirSync(backupDir);
  for (const entry of entries) {
    const src = path.join(backupDir, entry);
    const dest = path.join(process.env.HOME, '.config', 'opencode', 'skills', entry);
    
    if (fs.existsSync(src)) {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true });
      }
      fs.renameSync(src, dest);
    }
  }
  
  fs.rmSync(backupDir, { recursive: true });
  
  console.log('Rollback complete');
}

async function createBackup(installId, skillName) {
  const backupDir = path.join(BACKUP_DIR, installId);
  const targetDir = path.join(process.env.HOME, '.config', 'opencode', 'skills', skillName);
  
  if (!fs.existsSync(targetDir)) {
    return null;
  }
  
  fs.mkdirSync(backupDir, { recursive: true });
  
  copyDirRecursive(targetDir, backupDir);
  
  return backupDir;
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

function cleanupBackup(installId) {
  const backupDir = path.join(BACKUP_DIR, installId);
  
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true });
  }
}

module.exports = { rollback, createBackup, cleanupBackup };