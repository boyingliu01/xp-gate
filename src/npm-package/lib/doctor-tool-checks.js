/**
 * doctor's tool section, built from the shared audit instead of a private probe.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * doctor used to run its own probe loop (`diagnoseCliToolsAsync`), while
 * `check-tools` ran another. Two implementations of "is this tool usable" is how
 * a verdict drifts, and it had already drifted in three measurable ways on this
 * machine (2026-11-23):
 *
 *   1. VALIDITY — doctor reported `psscriptanalyzer` as available because the
 *      probe (`pwsh -Command "Get-Module -ListAvailable PSScriptAnalyzer"`) exits
 *      0 with empty output when the module is absent. The audit requires output
 *      before it will call a tool available.
 *   2. UNIQUENESS — doctor could not see that hadolint existed as two identical
 *      54 MB binaries.
 *   3. CURRENCY — doctor printed a version but never compared it to the latest.
 *
 * The fix is not "make doctor smarter": it is for doctor to CONSUME the audit,
 * so the rule lives once. This module is the adapter — it maps audit rows onto
 * doctor's existing report contract without changing that contract.
 *
 * CONTRACT PRESERVED: entries are named `CLI tool: <tool> (<gates>)` and carry
 * status PASS or WARN. Existing tests and consumers read exactly that shape.
 */

const { auditAllTools, auditAllToolsAsync } = require('./tool-audit.js');
const { GATE_CLI_TOOLS } = require('./detect-deps.js');

/** Max characters of a gate list before it is abbreviated in a detail line. */
const GATE_LABEL_LIMIT = 120;

/**
 * Build the human detail string for one audit row.
 *
 * A healthy tool keeps the bare version — that is what readers have always
 * seen, and a row of prose for every tool would bury the ones that matter.
 */
function detailForRow(row) {
  if (!row.available) {
    const reason = row.validityReason || 'not available';
    return `${reason} — install with: xp-gate install-tools`;
  }

  const problems = [];
  if (row.duplicated) {
    const extra = row.distinctRealPaths.slice(1).join(', ');
    problems.push(`duplicate install (${row.distinctRealPaths.length} copies; extra: ${extra})`);
  }
  if (row.outdated === true && row.installedVersion && row.latestVersion) {
    problems.push(`${row.installedVersion} → ${row.latestVersion} available`);
  }
  // `currency: 'unknown'` is NOT reported here: doctor deliberately performs no
  // version lookup (a blocking `npm view` starved its sibling probes), so every
  // row would carry the same "currency unknown" line and bury the rows that
  // matter. The check is not hidden — `check-tools` is where currency is a fact
  // worth stating, and its summary counts these explicitly.

  if (!problems.length) return row.version || row.installedVersion || 'available';
  const versionPart = row.installedVersion ? ` [${row.installedVersion}]` : '';
  return `${problems.join('; ')}${versionPart}`;
}

/**
 * Map audit rows onto doctor check entries.
 *
 * Only cross-language rows are emitted: doctor's section is about the tools the
 * gate SCRIPTS call directly, and language-specific tools remain the language
 * layer's job (that is what `check-tools` prints in full).
 *
 * @param {Array} rows audit rows from tool-audit
 * @returns {Array<{name: string, status: 'PASS'|'WARN', detail: string}>}
 */
function mapAuditRowsToDoctorChecks(rows = []) {
  return (rows || []).map((row) => {
    const gates = (row.gates || []).join(', ');
    const label = gates.length > GATE_LABEL_LIMIT ? `${gates.slice(0, GATE_LABEL_LIMIT)}…` : gates;
    return {
      name: `CLI tool: ${row.name}${label ? ` (${label})` : ''}`,
      // A tool that is present but duplicated or outdated is still a WARN-level
      // finding: it is exactly the state a silent check would call healthy.
      status: row.available && !row.duplicated && row.outdated !== true ? 'PASS' : 'WARN',
      detail: detailForRow(row),
    };
  });
}

/**
 * Audit the cross-language gate CLI tools doctor reports on.
 *
 * NO NETWORK, ON PURPOSE (measured 2026-11-23): resolving the latest version
 * runs `npm view` through execFileSync, which blocks the event loop for ~5 s per
 * lookup. Inside doctor's parallel fan-out that starved every sibling probe —
 * `node --version` and `git --version` exceeded the 1.5 s budget and were
 * reported as "Not found" on a machine where both work in 5 ms.
 *
 * doctor answers "can this be used right now"; "is it the newest" belongs to
 * `check-tools`, where the lookup is the point and can be paid for once.
 *
 * @param {{
 *   tools?: Array<{name:string, checkCmd:string, gates:string[], optional?:boolean}>,
 *   runProbe?: Function, locate?: Function, realpath?: Function,
 *   resolveLatest?: Function,
 * }} [options]
 * @returns {Array} audit rows with `currency: 'unknown'`
 */
async function auditGateCliTools(options = {}) {
  const tools = options.tools || GATE_CLI_TOOLS.map((entry) => ({
    name: entry.tool,
    checkCmd: entry.checkCmd,
    gates: entry.gates,
    optional: false,
    languages: [],
  }));
  // `resolveLatest` defaults to a constant null: a caller MAY inject one (tests),
  // but doctor never does, so no lookup happens unless explicitly asked for.
  const resolveLatest = options.resolveLatest || (() => null);
  // CONCURRENT, not sequential: checkov --version alone takes ~1.9 s and
  // semgrep ~1.4 s here. Probed one after another they held the event loop for
  // ~3.6 s and starved doctor's own sibling probes (see the header note).
  return auditAllToolsAsync(tools, {
    runProbe: options.runProbe,
    locate: options.locate,
    realpath: options.realpath,
    resolveLatest,
  });
}

module.exports = { mapAuditRowsToDoctorChecks, auditGateCliTools, detailForRow };
