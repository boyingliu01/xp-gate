/**
 * Language-specific tool registry for quality gates.
 * Maps each language to its required/optional tools and config files.
 * 
 * @module language-tools
 * @covers Sprint Multi-Language Support
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
// The audit lives in its own module: check-tools and doctor both need the same
// completeness/validity/uniqueness rules, and a rule kept in two files drifts.
const {
  collectGateTools,
  auditAllTools,
  summarizeAudit,
  resolveLatestVersion,
  resolveToolViaShell,
} = require('./tool-audit.js');
// Reuse doctor's own cross-language list so the two commands cannot disagree
// about what "the gate CLI tools" are.
const { GATE_CLI_TOOLS } = require('./detect-deps.js');

/**
 * Tool definition for quality gate language tools.
 * @typedef {Object} ToolDef
 * @property {string} name - Tool name (executable)
 * @property {string} checkCmd - Command to check version
 * @property {Object.<string, string>} install - Install commands per platform
 * @property {boolean} optional - If true, tool is optional (SKIP if missing)
 * @property {string[]} gates - Which gates use this tool
 */

/**
 * Language definition with tools and config files.
 * @typedef {Object} LangDef
 * @property {string} name - Language identifier
 * @property {ToolDef[]} tools - Required and optional tools
 * @property {string[]} configFiles - Project config files that indicate this language
 * @property {string[]} extensions - File extensions for this language
 */

/**
 * Registry of all supported languages and their tools.
 */
const { LANGUAGE_REGISTRY } = require('./language-registry.js');

/**
 * Directories that must never drive language detection: dependency trees ship
 * .sh and .ps1 files of their own, which would label every Node project a Shell
 * project.
 */
const IGNORED_SCAN_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.stryker-tmp', '.next']);

// A bounded scan, not a full walk: detection only needs to know whether an
// extension occurs at all, and huge monorepos must not pay for every file.
const EXTENSION_SCAN_LIMIT = 2000;

function extensionsPresentIn(projectRoot) {
  const extensions = new Set();
  const pending = [projectRoot];
  let inspected = 0;

  while (pending.length > 0 && inspected < EXTENSION_SCAN_LIMIT) {
    const dir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    // Sorted: readdir order is filesystem-dependent, and a bounded scan that
    // stops at an entry count must give the same answer on every machine
    // (Round 1: feasibility FC-03, architecture MI-01).
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (inspected >= EXTENSION_SCAN_LIMIT) break;
      inspected += 1;
      if (entry.isDirectory()) {
        if (!IGNORED_SCAN_DIRS.has(entry.name)) pending.push(path.join(dir, entry.name));
        continue;
      }
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (ext) extensions.add(ext);
    }
  }

  return extensions;
}

/**
 * Read the --languages selection, in either accepted form.
 * `--languages=<a,b>` and `--languages <a,b>`; a bare `--languages`, and an
 * inline `--languages=` with an empty value, both fall back to auto-detection
 * rather than selecting a language named ''.
 * @param {string[]} args
 * @returns {string[]|null}
 */
function parseLanguageFlag(args) {
  const inline = args.find((arg) => arg.startsWith('--languages='));
  let value;
  if (inline !== undefined) {
    value = inline.slice('--languages='.length);
  } else {
    const index = args.indexOf('--languages');
    const following = index === -1 ? undefined : args[index + 1];
    value = following && !following.startsWith('-') ? following : undefined;
  }
  if (value === undefined) return null;
  const picked = value.split(',').filter(Boolean);
  return picked.length > 0 ? picked : null;
}

/**
 * Detect languages used in the current project.
 * @param {string} projectRoot - Project root directory
 * @returns {{detected: string[], configFiles: Object.<string, string[]>}}
 */
/**
 * Decide between Flutter and Dart, which are not independent answers.
 *
 * Flutter IMPLIES Dart: reporting both makes a Flutter app look like a Dart project
 * that happens to use Flutter. A `pubspec.yaml` mentioning flutter is the
 * authoritative signal, so it overrides the extension-based guess rather than
 * adding to it.
 *
 * @param {Set<string>} detected mutated in place
 * @param {string} projectRoot
 */
function resolveFlutterVersusDart(detected, projectRoot) {
  if (detected.has('flutter') && detected.has('dart')) detected.delete('dart');

  const pubspecPath = path.join(projectRoot, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) return;
  try {
    if (fs.readFileSync(pubspecPath, 'utf8').includes('flutter:')) {
      detected.delete('dart');
      detected.add('flutter');
    }
  } catch {
    // An unreadable pubspec leaves the extension-based detection as it stands.
  }
}

/**
 * A predicate over the file extensions present in a project, scanned on first use.
 *
 * Lazy on purpose: the extension fallback is only consulted for languages that have
 * no config file to look for, and the scan is bounded rather than a full walk. On a
 * config-heavy project it never runs at all; on an extension-only one it runs once,
 * not once per language.
 *
 * @param {string} projectRoot
 * @returns {(ext: string) => boolean}
 */
function makeLazyExtensionScanner(projectRoot) {
  let scanned = null;
  return (ext) => {
    if (scanned === null) scanned = extensionsPresentIn(projectRoot);
    return scanned.has(ext);
  };
}

/**
 * Walk the registry and record every language the project shows evidence of.
 *
 * A language is detected by a config file OR, when it has none to look for, by its
 * extension. Config files take precedence because extension lists are broad -- IaC
 * lists yaml/yml, and matching on those would make every repo with a CI YAML an
 * Infrastructure-as-Code project (#468).
 */
/**
 * The config files this entry matches: the literal name, or every file a `*` glob hits.
 *
 * A glob's directory listing is read once per pattern, and an unreadable project root
 * yields no matches rather than throwing -- detection is a report about what was
 * SEEN, and a directory we cannot list was not seen.
 *
 * @param {string} projectRoot
 * @param {string} configFile a literal name or a pattern containing `*`
 * @returns {string[]} matched names, relative to the project root
 */
function matchConfigFile(projectRoot, configFile) {
  if (!configFile.includes('*')) {
    return fs.existsSync(path.join(projectRoot, configFile)) ? [configFile] : [];
  }
  const regex = new RegExp(configFile.replace(/\*/g, '.*'));
  try {
    return fs.readdirSync(projectRoot).filter((file) => regex.test(file));
  } catch {
    return [];
  }
}

function scanRegistryForLanguages(projectRoot, detected, configFiles, extensionSeen) {
for (const [lang, def] of Object.entries(LANGUAGE_REGISTRY)) {
  const foundConfigs = [];
  
  for (const configFile of def.configFiles) {
    foundConfigs.push(...matchConfigFile(projectRoot, configFile));
  }

  if (foundConfigs.length > 0) {
    detected.add(lang);
    configFiles[lang] = foundConfigs;
  } else if (def.configFiles.length === 0 && def.extensions.some(extensionSeen)) {
    // Shell and PowerShell have no package-manager manifest to key off, so file
    // extensions are their only possible signal (#468). Languages that do have
    // config files keep using them: their extension lists are broad (IaC lists
    // yaml/yml), and matching on those would make every repo with a CI YAML an
    // Infrastructure-as-Code project.
    detected.add(lang);
  }
}
}

function detectProjectLanguages(projectRoot) {
  const detected = new Set();
  const configFiles = {};

  const extensionSeen = makeLazyExtensionScanner(projectRoot);

  scanRegistryForLanguages(projectRoot, detected, configFiles, extensionSeen);


  resolveFlutterVersusDart(detected, projectRoot);


  return {
    detected: Array.from(detected),
    configFiles,
  };
}

/**
 * Check if a CLI tool is available.
 * @param {string} toolName - Tool name
 * @param {string} checkCmd - Command to check version
 * @returns {{available: boolean, version?: string}}
 */
const {
  checkTool,
  getToolsForLanguages,
  installTool,
  generateProjectConfig,
  TOOL_PROBE_TIMEOUT_MS,
  INSTALL_EXEC_TIMEOUT_MS,
} = require('./tool-install.js');

/**
 * Read existing project config if present.
 * @param {string} projectRoot - Project root
 * @returns {Object|null}
 */
function readProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.xp-gate-config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Files that declare a build dependency. The version catalog is included because
 * a Gradle project may describe the coordinate ONLY there, never in
 * build.gradle.kts -- checking just the build script would report a genuinely
 * installed tool as missing (AC-689-06).
 *
 * Only the ROOT of the project is scanned: a multi-module build aggregates its
 * dependencies at the root, and walking every submodule would cost a directory
 * traversal per language for no gain (AC-689-09).
 */
const BUILD_FILE_CANDIDATES = [
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle/libs.versions.toml',
];

/**
 * The coordinate each language's architecture tool is declared under.
 *
 * Split per language on purpose: Konsist is a Kotlin tool, but nothing stops a
 * Java project from also depending on it. Matching a single shared list would
 * let one language's declaration turn another language's row green, so doctor
 * would stop reporting the real gap (AC-689-07).
 */
const ARCH_DEPENDENCY_COORDINATES = {
  java: 'com.tngtech.archunit',
  kotlin: 'com.lemonappdev',
};

/**
 * Whether a build-file-declared architecture tool is present.
 *
 * Tools with `detectBy: 'build-file'` have no CLI to probe -- ArchUnit and
 * Konsist are libraries. Probing them with checkCmd reports "missing" forever,
 * which is what #689 is about: doctor told Java users their architecture tool
 * was absent no matter what they did.
 *
 * @param {string} lang - Language key from LANGUAGE_REGISTRY
 * @param {string} [projectRoot] - Project root; defaults to cwd
 * @returns {{available: boolean, version: string, path: string|null}}
 */
function detectBuildFileDependency(lang, projectRoot) {
  const root = projectRoot || process.cwd();
  const coordinate = ARCH_DEPENDENCY_COORDINATES[lang];
  if (!coordinate) return { available: false, version: 'N/A', path: null };

  for (const relPath of BUILD_FILE_CANDIDATES) {
    const candidate = path.join(root, relPath);
    if (!fs.existsSync(candidate)) continue;
    let contents;
    try {
      contents = fs.readFileSync(candidate, 'utf-8');
    } catch {
      // An unreadable build file is not evidence the tool is absent, but it is
      // not evidence it is present either. Try the next candidate rather than
      // claiming either way.
      continue;
    }
    if (contents.includes(coordinate)) {
      return { available: true, version: `declared in ${relPath}`, path: candidate };
    }
  }
  return { available: false, version: 'N/A', path: null };
}

/**
 * The architecture tools registered for each language.
 *
 * "Architecture tool" is recognised by its Gate 4 label rather than by a second
 * parallel list: one source of truth means a tool cannot be registered and
 * simultaneously missing from the doctor view.
 *
 * @returns {Object<string, Array>} language -> tool definitions
 */
function getArchitectureTools() {
  const result = {};
  for (const [lang, langDef] of Object.entries(LANGUAGE_REGISTRY)) {
    const arch = langDef.tools.filter(tool =>
      tool.gates.some(gate => gate.includes('Architecture'))
    );
    if (arch.length > 0) result[lang] = arch;
  }
  return result;
}

module.exports = {
  LANGUAGE_REGISTRY,
  detectProjectLanguages,
  checkTool,
  getToolsForLanguages,
  installTool,
  generateProjectConfig,
  readProjectConfig,
  handleDetectLanguages,
  handleCheckTools,
  handleInstallTools,
  planToolRepairs,
  getArchitectureTools,
  detectBuildFileDependency,
};

/**
 * Handle detect-languages CLI command.
 * @param {string[]} args - Command arguments
 * @returns {Promise<number>} Exit code
 */
/**
 * The JSON shape of a detection result: languages, where they were found, tools.
 *
 * `tools` is keyed by language, so a consumer can answer "what is missing for Rust"
 * without re-deriving the language list.
 */
function buildDetectionResult(detected, configFiles, toolStatus) {
  const tools = {};
  for (const [lang, list] of Object.entries(toolStatus)) {
    tools[lang] = list.map((t) => ({
      name: t.tool.name,
      status: t.status,
      optional: t.tool.optional,
      version: t.version,
    }));
  }
  return { languages: detected, configFiles, tools };
}

/**
 * Report that nothing was detected, in whichever shape the caller asked for.
 *
 * An empty result is a valid answer, not a failure: a directory with no recognisable
 * project has no languages, and exiting non-zero would make a legitimate "nothing
 * here" look like an error.
 *
 * @param {boolean} jsonOutput
 * @returns {number} exit code
 */
function reportNoLanguages(jsonOutput) {
  if (jsonOutput) {
    console.log(JSON.stringify({ languages: [], configFiles: {} }, null, 2));
  } else {
    console.log('No languages detected.');
  }
  return 0;
}

async function handleDetectLanguages(args, options = {}) {
  // Injectable like the other handle* functions in this file. It defaulted to
  // `process.cwd()` with no seam, so the only way to test it was to chdir --
  // which vitest workers do not allow, and which made the whole command
  // untestable rather than merely untested.
  const projectRoot = options.projectRoot || process.cwd();
  const jsonOutput = args.includes('--json');
  const writeConfig = args.includes('--write') || !jsonOutput;

  console.log('Detecting project languages...');
  console.log(`Project root: ${projectRoot}\n`);

  const { detected, configFiles } = detectProjectLanguages(projectRoot);

  if (detected.length === 0) return reportNoLanguages(jsonOutput);

  const toolStatus = getToolsForLanguages(detected);

  if (jsonOutput) {
    console.log(JSON.stringify(buildDetectionResult(detected, configFiles, toolStatus), null, 2));
  } else {
    console.log('Detected languages:');
    for (const lang of detected) {
      const langDef = LANGUAGE_REGISTRY[lang];
      console.log(`  • ${langDef?.name || lang} (${lang})`);
      if (configFiles[lang]) {
        console.log(`    Config files: ${configFiles[lang].join(', ')}`);
      }
      if (toolStatus[lang]) {
        const available = toolStatus[lang].filter(t => t.status === 'available').length;
        const total = toolStatus[lang].length;
        console.log(`    Tools: ${available}/${total} available`);
        for (const t of toolStatus[lang]) {
          const statusIcon = t.status === 'available' ? '✓' : '✗';
          const optMark = t.tool.optional ? ' (optional)' : '';
          console.log(`      ${statusIcon} ${t.tool.name}${optMark}${t.version ? ` — ${t.version}` : ''}`);
        }
      }
    }
  }

  if (writeConfig) {
    const configPath = generateProjectConfig(projectRoot, detected, toolStatus);
    console.log(`\nGenerated config: ${configPath}`);
  }

  return 0;
}

/**
 * Handle check-tools CLI command.
 * @param {string[]} args - Command arguments
 * @returns {Promise<number>} Exit code
 */
/**
 * Render one audit row as the status the CLI contract uses.
 *
 * A row is unusable for two different reasons and they must not be merged:
 * the probe failed (missing/broken), or the probe could not be interpreted.
 * Both are "not usable", but only the first is "not installed".
 */
function statusOfRow(row) {
  return row.available ? 'available' : 'missing';
}

/** Icon for a row: present, present-but-flagged, or absent. */
function iconOfRow(row) {
  if (!row.available) return '✗';
  if (row.duplicated || row.outdated) return '⚠';
  return '✓';
}

/** Extra qualifiers appended to a human line, e.g. "duplicate ×2, 2.14.0 → 2.15.1". */
function qualifiersOfRow(row) {
  const parts = [];
  if (row.duplicated) parts.push(`DUPLICATE ×${row.distinctRealPaths.length}`);
  if (row.outdated && row.installedVersion && row.latestVersion) {
    parts.push(`${row.installedVersion} → ${row.latestVersion} available`);
  } else if (row.currency === 'unknown') {
    parts.push('version currency unknown');
  }
  // #843: say WHERE the binary was found. "Installed but not on PATH" and
  // "not installed" look identical in a pass/fail column and call for opposite
  // actions -- add it to PATH (or symlink it), versus install it.
  if (row.available && row.resolution === 'fallback' && row.resolvedPath) {
    parts.push(`found at ${row.resolvedPath} (not on PATH)`);
  }
  if (!row.available && row.validityReason) parts.push(row.validityReason);
  return parts.join('; ');
}

/**
 * Print the audit as a human-readable list.
 *
 * One list, not one section per language: the question "is my toolchain
 * complete" is about the whole set. Language attribution is kept as a column so
 * nothing is lost.
 */
function printAuditReport(rows, summary) {
  console.log('Quality Gate Tool Audit\n');
  const width = Math.max(...rows.map((r) => r.name.length), 10);
  for (const row of rows) {
    const opt = row.optional ? ' (optional)' : '';
    const version = row.installedVersion || 'N/A';
    const shown = row.npxInvoked ? `${version} (via npx)` : version;
    const q = qualifiersOfRow(row);
    console.log(`  ${iconOfRow(row)} ${row.name.padEnd(width)}${opt} — ${shown}${q ? ` [${q}]` : ''}`);
  }
  console.log('');
  console.log(
    `Summary: ${summary.total} tools — ${summary.missing} missing, ${summary.duplicated} duplicated, `
      + `${summary.outdated} outdated, ${summary.unknown} unknown`,
  );
  if (!summary.complete) {
    console.log('Run `xp-gate install-tools` to install, upgrade and de-duplicate.');
  }
}

/**
 * Handle check-tools CLI command.
 *
 * Reports completeness, validity, uniqueness and currency in ONE list. The
 * audit is injectable so tests drive every branch without touching the network
 * or the real toolchain.
 *
 * @param {string[]} args - Command arguments
 * @param {{
 *   projectRoot?: string,
 *   languages?: string[]|null,
 *   audit?: (tools: Array, deps: object) => Array,
 *   resolveLatest?: (name: string) => string|null,
 * }} [options]
 * @returns {Promise<number>} Exit code
 */
/**
 * Collect the tools the question covers, then audit each through the gate's resolver.
 *
 * Resolving through the SAME helper the gates use (#843) is the point: a binary in
 * `~/.local/bin` IS installed even when the hook's PATH omits it, and reporting it
 * missing sends the reader off to install what is already there.
 *
 * `--all` passes null languages, meaning "every registered tool" rather than "this
 * project's".
 */
function auditRequestedTools(args, selection, options) {
  const { languages, includeCrossLanguage } = selection;
const tools = collectGateTools({
  registry: LANGUAGE_REGISTRY,
  cliTools: GATE_CLI_TOOLS,
  // `--all` asks about every registered tool, not just this project's.
  languages: args.includes('--all') ? null : (languages.length ? languages : null),
}).filter((t) => includeCrossLanguage || (t.languages && t.languages.length > 0));

const audit = options.audit || ((list, deps) => auditAllTools(list, deps));
// Resolve tools through the SAME helper the gates use (#843): a binary in
// ~/.local/bin is installed even when the hook's PATH omits it, and reporting
// it missing sends the reader off to install what is already there.
const rows = audit(tools, {
  resolveLatest: options.resolveLatest || ((n) => resolveLatestVersion(n)),
  resolveTool: options.resolveTool || ((name) => resolveToolViaShell(name)),
});
const summary = summarizeAudit(rows);
  return { rows, summary };
}

/**
 * Emit the audit as JSON in the shape callers expect.
 *
 * CONTRACT, preserved from #468: the TOP LEVEL is keyed by language name, each value
 * being that language's tool list. Callers parse it that way and a shape change here
 * silently broke them once. The audit's newer facts (duplicates, currency,
 * cross-language tools) ride ALONGSIDE in `summary` and `crossLanguage` rather than
 * replacing the old shape.
 */
/**
 * The JSON shape of one audited tool.
 *
 * One factory for both call sites. They had drifted already -- the cross-language
 * copy carried `npxInvoked` and the per-language one did not -- which is exactly the
 * kind of divergence a second hand-written literal produces.
 *
 * `reason` is `undefined` when absent rather than omitted, so the key is stable for
 * consumers that read it.
 */
function toolEntry(row) {
  return {
    name: row.name,
    status: statusOfRow(row),
    optional: row.optional,
    version: row.version,
    gates: row.gates,
    duplicated: row.duplicated,
    paths: row.paths,
    outdated: row.outdated,
    latestVersion: row.latestVersion,
    currency: row.currency,
    reason: row.validityReason || undefined,
  };
}

function printAuditJson(rows, summary, args) {
  // CONTRACT, preserved from #468: the top level is keyed by language name and
  // each value is that language's tool list. Callers parse it that way, and a
  // shape change here silently broke them once already. The audit's new facts
  // (duplicates, currency, cross-language tools) therefore ride alongside in
  // `summary` and `crossLanguage` rather than replacing the old shape.
  const byLanguage = {};
  for (const row of rows) {
    for (const lang of (row.languages && row.languages.length ? row.languages : ['(cross-language)'])) {
      if (!byLanguage[lang]) byLanguage[lang] = [];
      byLanguage[lang].push(toolEntry(row));
    }
  }
  // Tools the gate scripts call directly; reported once, not per language.
  // Only emitted when such tools exist: an always-present empty group would
  // add a key to a contract callers compare exactly (#468).
  const crossLanguage = rows
    .filter((r) => !r.languages || r.languages.length === 0)
    .map((r) => ({ ...toolEntry(r), npxInvoked: r.npxInvoked }));
  if (crossLanguage.length > 0) byLanguage['(cross-language)'] = crossLanguage;

  // `summary` and the flat view are additive: they appear only when asked
  // for, so the historical shape ({ <language>: [...] }) stays byte-identical
  // for callers that parse it exactly (#468).
  const wantsAuditFields = args.includes('--audit') || args.includes('--flat');
  // The flat view uses the SAME field names as the grouped view (`status`,
  // `version`), so a consumer can switch between them without remapping.
  const flatView = rows.map((r) => ({
    name: r.name,
    status: statusOfRow(r),
    optional: r.optional,
    version: r.version,
    installedVersion: r.installedVersion,
    gates: r.gates,
    languages: r.languages,
    duplicated: r.duplicated,
    paths: r.paths,
    distinctRealPaths: r.distinctRealPaths,
    outdated: r.outdated,
    latestVersion: r.latestVersion,
    currency: r.currency,
    npxInvoked: r.npxInvoked,
    reason: r.validityReason || undefined,
  }));
  console.log(JSON.stringify({
    ...byLanguage,
    ...(wantsAuditFields ? { summary } : {}),
    ...(args.includes('--flat') ? { tools: flatView } : {}),
  }, null, 2));
}

async function handleCheckTools(args, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const jsonOutput = args.includes('--json');
  let languages = options.languages !== undefined ? options.languages : parseLanguageFlag(args);

  // Auto-detect if no languages specified
  if (languages === undefined || languages === null) {
    const detected = detectProjectLanguages(projectRoot);
    languages = detected.detected;
  }

  // The cross-language CLI tools are part of the answer even when no detected
  // language mentions them: they are what the gate SCRIPTS call directly.
  // The cross-language CLI tools belong to the answer when we are describing the
  // whole toolchain (auto-detected or --all). When the caller names languages
  // explicitly, they asked "what does THIS language need" and a cross-language
  // section would answer a different question.
  const explicitSelection = parseLanguageFlag(args);
  // An EMPTY selection is "nothing was asked for", not "ask for nothing": the
  // auto-detect path and `options.languages = []` must still describe the whole
  // toolchain, or the report silently becomes empty and reads as complete.
  const includeCrossLanguage = !explicitSelection || explicitSelection.length === 0
    || args.includes('--all');

  const { rows, summary } = auditRequestedTools(args, { languages, includeCrossLanguage }, options);

  if (jsonOutput) printAuditJson(rows, summary, args);
  else printAuditReport(rows, summary);

  return 0;
}

/**
 * Paths owned by the distribution. A copy here is the SYSTEM's copy, not a
 * duplicate install: removing it can take unrelated software with it, and the
 * user asked explicitly for distro packages to be left alone (2026-11-23).
 */
const { SYSTEM_PATH_PREFIXES } = require('./tool-audit.js');

/**
 * Build a repair plan from audit rows. Pure: no IO, no execution.
 *
 * Rules, in the order they are applied per tool:
 *   1. npx-invoked tools have no PATH entity — nothing to remove.
 *   2. A distro-owned copy is never removed; it is reported as kept.
 *   3. Duplicates: keep the FIRST path (what gates execute today) and remove the
 *      rest, so repairing does not change which binary the gates run.
 *   4. Missing REQUIRED tool -> install. Missing optional -> skipped and named.
 *   5. Outdated required tool -> upgrade.
 *
 * @param {Array} rows audit rows
 * @param {{definitions?: Array, systemPrefixes?: string[], platform?: string}} [options]
 * @returns {{actions: Array, clean: boolean}}
 */
/**
 * Plan an upgrade, and detect the plan that cancels itself.
 *
 * MEASURED DEFECT (2026-11-23): hadolint was duplicated AND outdated. The plan removed
 * `~/.local/bin/hadolint`, then ran an installer whose command writes to that exact
 * path -- so the duplicate came straight back and the repair silently achieved
 * nothing. `writesToRemovedPath` names that case instead of reporting a success that
 * is not one.
 */
function planUpgrade(row, installCmd, actions) {
  if (row.outdated === true) {
    // MEASURED DEFECT (2026-11-23): hadolint was duplicated AND outdated. The
    // plan removed ~/.local/bin/hadolint, then ran an installer whose command
    // writes to that exact path — so the duplicate came straight back and the
    // repair silently achieved nothing. Detect it and say so loudly instead of
    // reporting a success that is not one.
    const removedHere = actions
      .filter((a) => a.kind === 'remove-duplicate' && a.tool === row.name)
      .map((a) => a.path);
    const writesToRemovedPath = Boolean(installCmd)
      && removedHere.some((removedPath) => String(installCmd).includes(removedPath));
    actions.push({
      kind: 'upgrade',
      tool: row.name,
      command: installCmd,
      from: row.installedVersion,
      to: row.latestVersion,
      writesToRemovedPath,
      conflictsWith: writesToRemovedPath ? removedHere : undefined,
    });
  }
}

/**
 * Plan removal of a duplicated tool's extra copies.
 *
 * Only USER-owned duplicates are a repair. A distro copy plus a user copy is
 * coexistence (jq from apt vs a newer ~/.local/bin/jq), and removing either is not a
 * fix: the distro one can drag dependencies with it, the user one is what the reader
 * installed on purpose.
 *
 * The KEEP copy is the one the resolver hands to the gates, not whichever path came
 * first. Measured 2026-11-24: with the same tool and the same two paths, listing the
 * installer's copy FIRST made `writesToRemovedPath` false and listing it SECOND made
 * it true -- the self-cancelling guard depended on the order of `distinctRealPaths`,
 * which follows however the locator walked PATH. A guard that only fires for half the
 * callers is not a guard.
 *
 * @returns {boolean} true when the row is fully handled and needs no further action
 */
function planDuplicateRemoval(row, userCopies, actions) {
  if (row.duplicated && userCopies.length > 1) {
    // Keep the copy the resolver actually hands to the gates, not whichever
    // path happened to come first.
    //
    // Measured 2026-11-24: with the same tool and the same two paths, listing
    // the copy the installer writes to FIRST made `writesToRemovedPath` false
    // and listing it SECOND made it true -- the self-cancelling-plan guard
    // therefore depended on the order of `distinctRealPaths`, which comes from
    // however the locator walked PATH. A guard that only fires for half the
    // callers is not a guard.
    const preferred = row.resolvedPath && userCopies.includes(row.resolvedPath)
      ? row.resolvedPath
      : userCopies[0];
    const keep = preferred;
    const rest = userCopies.filter((p) => p !== keep);
    actions.push({ kind: 'keep', tool: row.name, path: keep });
    for (const dup of rest) {
      actions.push({ kind: 'remove-duplicate', tool: row.name, path: dup, keepPath: keep });
    }
    // A tool that is duplicated but otherwise current needs no install step.
    if (row.available && !row.outdated) return true;
  }

  return false;
}

function planToolRepairs(rows, options = {}) {
  const definitions = options.definitions || [];
  const platform = options.platform || process.platform;
  const systemPrefixes = options.systemPrefixes || SYSTEM_PATH_PREFIXES;
  const defByName = new Map(definitions.map((d) => [d.name, d]));
  const isSystemOwned = (p) => systemPrefixes.some((pre) => String(p).startsWith(pre));

  const actions = [];
  for (const row of rows || []) {
    if (row.npxInvoked) continue;

    const def = defByName.get(row.name);
    const installCmd = def && def.install
      ? (def.install[platform] || def.install.linux || def.install.npm || null)
      : null;

    // Only USER-owned duplicates are a repair. A distro copy plus a user copy is
    // coexistence (jq from apt vs a newer ~/.local/bin/jq), and removing either
    // is not a fix: the distro one can drag dependencies with it, the user one is
    // what the reader installed on purpose.
    // `distinctRealPaths` is only present on rows that were actually located on
    // disk; a row can be flagged `duplicated` by another producer (or by a
    // caller assembling rows by hand) without that list. Defaulting to [] keeps
    // the plan honest -- no copies means no duplicate to remove -- instead of
    // throwing out of a planning function.
    const userCopies = (row.userCopies || (row.distinctRealPaths || []).filter((p) => !isSystemOwned(p)));
    if (planDuplicateRemoval(row, userCopies, actions)) continue;

    if (!row.available) {
      if (row.optional) {
        actions.push({ kind: 'skip-optional', tool: row.name, reason: 'optional tool not installed' });
      } else {
        actions.push({ kind: 'install', tool: row.name, command: installCmd });
      }
      continue;
    }

    planUpgrade(row, installCmd, actions);
  }

  return { actions, clean: actions.length === 0 };
}

/** Human line for one planned action. */
function describeAction(action) {
  switch (action.kind) {
    case 'remove-duplicate':
      return `remove duplicate  ${action.tool}: ${action.path} (keeping ${action.keepPath})`;
    case 'keep':
      return `keep              ${action.tool}: ${action.path}`;
    case 'keep-system':
      return `keep (system)     ${action.tool}: ${action.path}`;
    case 'skip-optional':
      return `skip (optional)   ${action.tool}`;
    case 'install':
      return `install           ${action.tool}  ← ${action.command || 'no installer known'}`;
    case 'upgrade':
      return `upgrade           ${action.tool}  ${action.from} → ${action.to}  ← ${action.command || 'no installer known'}`;
    default:
      return `${action.kind} ${action.tool}`;
  }
}

/** Default command runner: returns {status}. Injectable so tests never execute. */
function defaultRunCommand(command) {
  if (!command) return { status: 1, error: 'no installer command' };
  try {
    execSync(command, { stdio: 'inherit', timeout: INSTALL_EXEC_TIMEOUT_MS, shell: true });
    return { status: 0 };
  } catch (err) {
    return { status: typeof err.status === 'number' ? err.status : 1, error: String(err.message || err) };
  }
}

/** Default file remover, used only for duplicate cleanup. */
function defaultRemoveFile(target) {
  try {
    fs.rmSync(target, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle install-tools CLI command.
 *
 * Installs missing required tools, upgrades outdated ones and removes duplicate
 * copies so each tool ends up as one current, working entity.
 *
 * Without `--yes` nothing is executed: the plan is printed and the command says
 * plainly that it changed nothing. Silence there would be indistinguishable
 * from "the repair ran and needed no work".
 *
 * @param {string[]} args - Command arguments
 * @param {{
 *   projectRoot?: string,
 *   languages?: string[],
 *   audit?: (tools: Array, deps: object) => Array,
 *   definitions?: Array,
 *   run?: (cmd: string) => {status: number},
 *   removeFile?: (p: string) => boolean,
 * }} [options]
 * @returns {Promise<number>} Exit code
 */
/**
 * Build the repair plan for this project's toolchain.
 *
 * Installer commands come from the registry entry (a language tool) or the CLI entry,
 * which is why `definitions` concatenates both: a tool reachable from either side must
 * be installable, and `planToolRepairs` looks definitions up by name alone.
 */
function buildInstallPlan(args, options, projectRoot) {
let languages = options.languages !== undefined ? options.languages : parseLanguageFlag(args);
if (languages === undefined || languages === null) {
  languages = detectProjectLanguages(projectRoot).detected;
}

const tools = collectGateTools({
  registry: LANGUAGE_REGISTRY,
  cliTools: GATE_CLI_TOOLS,
  languages: args.includes('--all') || !languages.length ? null : languages,
});

const audit = options.audit || ((list, deps) => auditAllTools(list, deps));
const rows = audit(tools, { resolveLatest: options.resolveLatest || ((n) => resolveLatestVersion(n)) });

// Installer commands come from the registry entry (language) or the CLI entry.
const definitions = options.definitions
  || [
    ...tools,
    ...GATE_CLI_TOOLS.map((c) => ({ name: c.tool, install: c.install, optional: false })),
  ];

const plan = planToolRepairs(rows, { definitions });

  return planToolRepairs(rows, { definitions });
}

/**
 * Report a plan whose parts undo each other, and say whether it must be refused.
 *
 * A repair whose parts cancel is not a repair. Refusing -- rather than running it and
 * watching a duplicate survive a "successful" run -- points the operator at the
 * installer command, which is the thing that actually needs fixing.
 *
 * @param {{actions: Array}} plan
 * @returns {boolean} true when the plan is self-cancelling
 */
function reportSelfCancellingPlan(plan) {
// A repair whose parts undo each other is not a repair. Refuse to run it and
// say which action conflicts, so the operator can fix the installer instead of
// watching a duplicate survive a "successful" run.
const conflicting = plan.actions.filter((a) => a.kind === 'upgrade' && a.writesToRemovedPath);
if (conflicting.length) {
  for (const a of conflicting) {
    console.log(`CONFLICT ${a.tool}: its installer writes to ${(a.conflictsWith || []).join(', ')},`);
    console.log('         which this same plan removes — the duplicate would come back.');
  }
  console.log('Refusing to apply a self-cancelling plan. Fix the installer command first.');
  return 1;
}

  return false;
}

/**
 * Run the mutating actions, counting failures without stopping.
 *
 * One failed install must not strand the rest -- the operator wants to see every
 * outcome in one pass, not discover them one re-run at a time. A missing installer
 * command counts as a failure rather than being skipped silently: the tool stays
 * broken either way, and only one of those tells the reader.
 */
function applyPlanActions(actions, io) {
  const { run, removeFile } = io;
  let failed = 0;
  for (const action of actions) {
  if (action.kind === 'remove-duplicate') {
    const ok = removeFile(action.path);
    if (!ok) failed += 1;
    console.log(`${ok ? 'removed' : 'FAILED to remove'} ${action.path}`);
    continue;
  }
  if (!action.command) {
    failed += 1;
    console.log(`FAILED ${action.tool}: no installer command for this platform`);
    continue;
  }
  console.log(`> ${action.command}`);
  const result = run(action.command) || { status: 1 };
  if (result.status !== 0) {
    failed += 1;
    console.log(`FAILED ${action.tool} (exit ${result.status})`);
  }
}

  return failed;
}

async function handleInstallTools(args, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const autoYes = args.includes('--yes') || args.includes('-y');
  const run = options.run || defaultRunCommand;
  const removeFile = options.removeFile || defaultRemoveFile;

  const plan = buildInstallPlan(args, options, projectRoot);
  if (plan.clean) {
    console.log('Toolchain is already up to date: nothing to install, upgrade or remove.');
    return 0;
  }

  console.log('Planned toolchain changes:\n');
  for (const action of plan.actions) console.log(`  • ${describeAction(action)}`);
  console.log('');

  if (reportSelfCancellingPlan(plan)) return 1;

  const mutating = plan.actions.filter((a) =>
    a.kind === 'install' || a.kind === 'upgrade' || a.kind === 'remove-duplicate');
  if (!mutating.length) {
    console.log('No changes needed for the required tools.');
    return 0;
  }

  if (!autoYes) {
    console.log(`${mutating.length} change(s) planned. No changes were made — re-run with --yes to apply them.`);
    return 0;
  }

  const failed = applyPlanActions(mutating, { run, removeFile });

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of ${mutating.length} change(s) failed.`);
    return 1;
  }
  console.log(`Applied ${mutating.length} change(s) successfully.`);
  return 0;
}
