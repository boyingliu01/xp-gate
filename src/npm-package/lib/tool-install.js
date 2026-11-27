'use strict';
/**
 * Detecting, probing and installing the external tools the gates shell out to.
 *
 * Moved out of `language-tools.js` so that file fits its line ceiling. The behaviour
 * is unchanged; what moved is the part that talks to the machine, which is also the
 * part that benefits from being readable on its own.
 *
 * A probe runs `<tool> --version` through a shell and parses the first line. An
 * install runs the registry's per-platform command and writes the resulting status
 * into the project config. Both bound their runtime: one wedged binary must not stall
 * a whole run.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { LANGUAGE_REGISTRY } = require('./language-registry.js');

/**
 * How long a tool-probe command may take before it is treated as absent.
 *
 * Generous for a `--version` call, short enough that one wedged binary cannot stall a
 * whole check-tools run.
 */
const TOOL_PROBE_TIMEOUT_MS = 10000;

/**
 * How long an installer may run before it is abandoned.
 *
 * Two orders of magnitude above a probe: a package manager legitimately downloads and
 * compiles.
 */
const INSTALL_TIMEOUT_MS = 120000;

/**
 * The outer bound on one installer invocation.
 *
 * Two orders of magnitude above a probe: a package manager legitimately downloads and
 * compiles. The bound exists so an interactive prompt behind a pipe cannot hang the
 * command forever.
 */
const INSTALL_EXEC_TIMEOUT_MS = 600000;

function checkTool(toolName, checkCmd) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const nullRedir = isWindows ? '2>nul' : '2>/dev/null';
  const execOpts = { 
    encoding: 'utf8', 
    stdio: ['ignore', 'pipe', 'pipe'], 
    shell, 
    timeout: TOOL_PROBE_TIMEOUT_MS,
  };

  try {
    const result = execSync(`${checkCmd} ${nullRedir}`, execOpts);
    return { available: true, version: result.trim().split('\n')[0] };
  } catch {
    return { available: false };
  }
}

/**
 * Get required tools for detected languages.
 * @param {string[]} languages - Detected languages
 * @returns {Object.<string, Array<{tool: ToolDef, status: string}>>}
 */
function getToolsForLanguages(languages) {
  const result = {};

  for (const lang of languages) {
    const langDef = LANGUAGE_REGISTRY[lang];
    if (!langDef) continue;

    result[lang] = [];

    for (const tool of langDef.tools) {
      // Build-file tools have no binary to probe; running checkCmd on them
      // would report "missing" permanently (#689 AC-3).
      const status = tool.detectBy === 'build-file'
        ? detectBuildFileDependency(lang)
        : checkTool(tool.name, tool.checkCmd);
      result[lang].push({
        tool,
        status: status.available ? 'available' : 'missing',
        version: status.version,
      });
    }
  }

  return result;
}

/**
 * Install a tool using the appropriate command for the current platform.
 * @param {ToolDef} toolDef - Tool definition
 * @returns {{success: boolean, message: string}}
 */
function installTool(toolDef) {
  // A build-file tool has no installer to run: `detectBy: 'build-file'` exists
  // because ArchUnit and Konsist are libraries with no CLI to probe, and their
  // `install` field holds an instruction written for a human. Handing that
  // prose to execSync made `doctor --fix --install-tools` print
  // `'add' is not recognized as an internal or external command` on every Java
  // machine, and on POSIX actually shell it. Report the guidance and start no
  // process (#689 review, found by Delphi Round 1).
  if (toolDef.detectBy === 'build-file') {
    const guidance = toolDef.install[process.platform] || toolDef.install.linux || '';
    return {
      success: false,
      message:
        `${toolDef.name} is a build-file library, not a CLI: no install command is runnable. ` +
        `Add it manually -- ${guidance}`,
    };
  }

  const platform = process.platform;
  const installCmd = toolDef.install[platform] || toolDef.install.linux;

  if (!installCmd) {
    return { success: false, message: `No install command for platform ${platform}` };
  }

  const isWindows = platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const execOpts = { 
    encoding: 'utf8', 
    stdio: 'inherit', 
    shell, 
    timeout: INSTALL_TIMEOUT_MS,
  };

  try {
    console.log(`Installing ${toolDef.name}: ${installCmd}`);
    execSync(installCmd, execOpts);
    return { success: true, message: `${toolDef.name} installed successfully` };
  } catch (error) {
    return { success: false, message: `Failed to install ${toolDef.name}: ${error.message}` };
  }
}

/**
 * Generate project language config file.
 * @param {string} projectRoot - Project root
 * @param {string[]} languages - Detected languages
 * @param {Object} toolStatus - Tool status per language
 */
function generateProjectConfig(projectRoot, languages, toolStatus) {
  const config = {
    version: 1,
    languages: languages.reduce((acc, lang) => {
      const langDef = LANGUAGE_REGISTRY[lang];
      acc[lang] = {
        name: langDef?.name || lang,
        tools: (toolStatus[lang] || []).map(t => ({
          name: t.tool.name,
          status: t.status,
          optional: t.tool.optional,
          gates: t.tool.gates,
        })),
      };
      return acc;
    }, {}),
    lastDetected: new Date().toISOString(),
  };

  const configPath = path.join(projectRoot, '.xp-gate-config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    // The returned path is printed by the caller; a silent failure would report a
    // config file that does not exist.
    throw new Error(`cannot write ${configPath}: ${err.message}`);
  }
  return configPath;
}

module.exports = { checkTool, getToolsForLanguages, installTool, generateProjectConfig, TOOL_PROBE_TIMEOUT_MS, INSTALL_EXEC_TIMEOUT_MS };
