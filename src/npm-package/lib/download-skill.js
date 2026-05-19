const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(process.env.HOME, '.config', 'xgate');
const CACHE_DIR = path.join(CONFIG_DIR, 'cache');

async function downloadFromGitHub(repo, pathInRepo, version = 'main') {
  const url = `https://raw.githubusercontent.com/${repo}/${version}/${pathInRepo}`;
  const cacheFile = path.join(CACHE_DIR, `${repo}-${pathInRepo.replace(/\//g, '-')}.md`);
  
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  
  await downloadWithRetry(url, cacheFile);
  
  return cacheFile;
}

async function downloadWithRetry(url, dest, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await downloadFile(url, dest);
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`Retry ${attempt}/${retries}...`);
      await sleep(1000 * attempt);
    }
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    https.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
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

async function downloadTarball(repo, version = 'main') {
  const tarballUrl = `https://api.github.com/repos/${repo}/tarball/${version}`;
  const cacheFile = path.join(CACHE_DIR, `${repo.replace('/', '-')}.tgz`);
  
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  
  await downloadWithRetry(tarballUrl, cacheFile);
  
  return cacheFile;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function verifyChecksum(file, expectedChecksum) {
  const hash = crypto.createHash('sha256');
  const content = fs.readFileSync(file);
  hash.update(content);
  const actualChecksum = hash.digest('hex');
  
  if (actualChecksum !== expectedChecksum) {
    fs.unlinkSync(file);
    throw new Error(`Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
  }
}

module.exports = { downloadFromGitHub, downloadTarball, downloadWithRetry, verifyChecksum };