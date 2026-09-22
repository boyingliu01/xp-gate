/**
 * Shared scaffolding for `lib/__tests__` suites. Hoisted out of the #417 agent
 * test because the same reset-and-mute sequence already lives in two other
 * suites and a third inline copy tripped the architecture ratchet.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Drop the HOME-derived modules from Node's cache so the next require() sees
 * the sandboxed `process.env.HOME`.
 *
 * @param {object} vi - Vitest API
 * @param {string[]} resolvedPaths - already require.resolve()d module paths
 */
function resetLibModules(vi, resolvedPaths) {
  vi.resetModules();
  for (const resolved of resolvedPaths) delete require.cache[resolved];
}

/**
 * @param {object} vi - Vitest API
 * @returns {{log: object, warn: object, error: object}} console spies
 */
function muteConsole(vi) {
  const spies = {};
  for (const level of ['log', 'warn', 'error']) {
    spies[level] = vi.spyOn(console, level).mockImplementation(() => {});
  }
  return spies;
}

/**
 * @param {string[]} prefixes - tmpdir name prefixes to create
 * @returns {Object<string, string>} created temp directories by prefix
 */
function makeTempDirs(prefixes) {
  const dirs = {};
  for (const prefix of prefixes) {
    dirs[prefix] = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  }
  return dirs;
}

/**
 * @param {Object<string, string>} dirs - directories returned by makeTempDirs
 */
function removeTempDirs(dirs) {
  for (const dir of Object.values(dirs)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { resetLibModules, muteConsole, makeTempDirs, removeTempDirs };
