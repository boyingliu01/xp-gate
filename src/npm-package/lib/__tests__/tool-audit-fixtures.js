/**
 * Shared fixtures for the tool-audit / check-tools / install-tools tests.
 *
 * Kept in one place because three suites assert against the same shapes: a
 * duplicated `row()` builder drifted 16% of a file the first time it was copied,
 * and a fixture that disagrees with its sibling produces tests that pass for
 * different reasons.
 */

/** Capture console output from an async handler. */
async function capture(fn) {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const code = await fn();
    return { code, out: lines.join('\n') };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

/**
 * One audit row, defaulting to a healthy single-copy current tool so each test
 * only states the property it cares about.
 */
function auditRow(name, over = {}) {
  return {
    name,
    available: true,
    validityReason: '',
    npxInvoked: false,
    paths: [`/home/u/.local/bin/${name}`],
    distinctRealPaths: [`/home/u/.local/bin/${name}`],
    duplicated: false,
    version: '1.0.0',
    installedVersion: '1.0.0',
    latestVersion: '1.0.0',
    outdated: false,
    currency: 'current',
    gates: [],
    optional: false,
    languages: ['shell'],
    ...over,
  };
}

/** A registry tool definition carrying an installer command. */
function toolDefinition(name, over = {}) {
  return {
    name,
    checkCmd: `${name} --version`,
    optional: false,
    gates: [],
    install: { linux: `npm install -g ${name}` },
    ...over,
  };
}

/** A throwaway project directory for language detection. */
function tmpProject() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-tools-'));
}

/**
 * Write a fixture file, failing loudly with the path when it cannot be written:
 * a silent failure would make "language not detected" look like a pass.
 */
function writeFixture(dir, name, content) {
  const fs = require('fs');
  const path = require('path');
  const target = path.join(dir, name);
  try {
    fs.writeFileSync(target, content);
  } catch (err) {
    throw new Error(`cannot write fixture ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return target;
}

module.exports = { capture, auditRow, toolDefinition, tmpProject, writeFixture };
