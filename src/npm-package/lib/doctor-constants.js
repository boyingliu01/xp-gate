'use strict';
/**
 * Values `doctor.js` and its split-out check modules share.
 *
 * Created so the check modules could be lifted out of `doctor.js` without a
 * CIRCULAR require: each of them needs these, and importing them back from
 * `doctor.js` would make the constants `undefined` at load time (Node completes the
 * cycle by handing out a partial exports object). With them here, `doctor.js` and
 * every check module depend on this leaf instead.
 */

const path = require('path');
const sharedPaths = require('./shared-paths.js');

/** Read through the module at each use: tests swap `sharedPaths` per case. */
const HOME_DIR = () => sharedPaths.HOME_DIR;
const CONFIG_FILE = () => sharedPaths.CONFIG_FILE;
const GLOBAL_HOOKS_DIR = () => sharedPaths.GLOBAL_HOOKS_DIR;
const GLOBAL_ADAPTERS_DIR = () => sharedPaths.GLOBAL_ADAPTERS_DIR;

/**
 * The npm package root: `<pkg>/src/npm-package/lib` -> `<pkg>/src/npm-package`.
 *
 * Two levels up from THIS file, same as when the value lived in doctor.js -- both sit
 * in the same directory, which is why the expression is unchanged.
 */
const PKG_DIR = path.dirname(__dirname);

/** The three Delphi seats, in report order. */
const DELPHI_ROLES = ['architecture', 'technical', 'feasibility'];

/** A review needs three DISTINCT models; two of the same model is one opinion twice. */
const MIN_DISTINCT_MODELS = 3;

module.exports = {
  HOME_DIR,
  CONFIG_FILE,
  GLOBAL_HOOKS_DIR,
  GLOBAL_ADAPTERS_DIR,
  PKG_DIR,
  DELPHI_ROLES,
  MIN_DISTINCT_MODELS,
};
