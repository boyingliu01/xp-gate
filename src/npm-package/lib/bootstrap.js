const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GATE_CLI_TOOLS, checkCliTool, getToolInstallCmd } = require('./detect-deps.js');

const PKG_DIR = path.dirname(__dirname);
const SCRIPTS_DIR = path.join(PKG_DIR, '..', '..', 'scripts');

function findInstallScript(scriptRelPath) {
  if (!scriptRelPath) return null;
  const candidate = path.join(SCRIPTS_DIR, path.basename(scriptRelPath));
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

function runCmd(cmd, description) {
  console.log(`\n  → ${description}`);
  console.log(`    $ ${cmd}`);
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
    });
    if (result.trim()) {
      const lines = result.trim().split('\n');
      for (const line of lines.slice(0, 5)) {
        console.log(`      ${line}`);
      }
      if (lines.length > 5) console.log(`      ... (${lines.length - 5} more lines)`);
    }
    console.log(`  ✓ ${description} — done`);
    return true;
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : e.message;
    if (stderr) {
      const lines = stderr.split('\n').slice(0, 3);
      for (const line of lines) console.log(`      ${line}`);
    }
    console.log(`  ✗ ${description} — failed (see above)`);
    return false;
  }
}

function getMissingTools() {
  const platform = process.platform;
  const missing = [];

  for (const entry of GATE_CLI_TOOLS) {
    const { available } = checkCliTool(entry.tool);
    if (!available) {
      missing.push({
        ...entry,
        installCmd: getToolInstallCmd(entry, platform),
        scriptPath: findInstallScript(entry.optScript),
      });
    }
  }

  return missing;
}

function installViaScript(missingTool) {
  const scriptPath = missingTool.scriptPath;
  if (!scriptPath) return false;
  return runCmd(`bash "${scriptPath}"`, `Install ${missingTool.tool} (via ${path.basename(scriptPath)})`);
}

function installViaInline(missingTool) {
  return runCmd(missingTool.installCmd, `Install ${missingTool.tool}`);
}

function verifyAfterInstall(toolName) {
  const { available, version } = checkCliTool(toolName);
  if (available) {
    console.log(`  ✓ Verified: ${toolName} ${version || 'installed'}`);
    return true;
  }
  console.log(`  ⚠ ${toolName} may not be in PATH yet — restart your terminal`);
  return false;
}

function bootstrap(args) {
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  console.log('XP-Gate Bootstrap');
  console.log('=================');

  if (dryRun) {
    console.log('(dry-run mode — no tools will be installed)\n');
  }

  const missing = getMissingTools();
  const alreadyOk = GATE_CLI_TOOLS.length - missing.length;

  console.log(`\nCLI tools: ${alreadyOk}/${GATE_CLI_TOOLS.length} available`);

  if (dryRun && missing.length === 0) {
    console.log('\n✓ All CLI tools are already available. Nothing to bootstrap.');
    return 0;
  }

  if (!dryRun && missing.length === 0) {
    console.log('\n✓ All CLI tools are already available.');
    return 0;
  }

  console.log(`\nMissing tools (${missing.length}):`);
  for (const mt of missing) {
    console.log(`  ✗ ${mt.tool} — needed by ${mt.gates[0]}`);
    console.log(`    Install: ${mt.installCmd}`);
    if (mt.scriptPath) {
      console.log(`    Script:  ${mt.scriptPath}`);
    }
  }

  if (dryRun) {
    console.log('\nRun without --dry-run to install these tools.');
    return 0;
  }

  console.log('\nInstalling missing tools...');

  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (const mt of missing) {
    let ok = false;

    if (mt.scriptPath) {
      ok = installViaScript(mt);
    }

    if (!ok) {
      ok = installViaInline(mt);
    }

    if (ok) {
      successCount++;
      verifyAfterInstall(mt.tool);
    } else {
      failCount++;
    }

    results.push({ tool: mt.tool, ok });
  }

  console.log(`\nResults: ${successCount} installed, ${failCount} failed`);

  if (failCount > 0) {
    console.log('\nSome tools could not be installed automatically.');
    console.log('See https://github.com/boyingliu01/xp-gate/blob/main/githooks/TOOL-INSTALLATION-GUIDE.md');
  }

  return failCount > 0 ? 1 : 0;
}

module.exports = { bootstrap };
