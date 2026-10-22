#!/usr/bin/env bats
# @test REQ-585
# @intent `vitest.config.ts` deliberately keeps `plugins/dsh/` in the collected
#         set (#569): it is the canonical source of the DSH plugin, and its 10 test
#         files are the only protection it has — the `src/npm-package/plugins/dsh/`
#         mirror is excluded. So root `vitest run` collects them.
#
#         But `plugins/dsh` is a SEPARATE npm package with its own `package.json`
#         and its own dependency tree (`@deepseek-ai/dsh-tools`, `cordis`,
#         `dsh-shell`, `dsh-llm`). The root `package.json` has no `workspaces`
#         field, so root `npm ci` never descends into it and never installs those
#         packages. A developer who once ran `npm install` inside `plugins/dsh`
#         keeps a working `plugins/dsh/node_modules` and sees green; CI, which only
#         runs `npm ci` at the root, gets:
#
#             FAIL plugins/dsh/src/gate-runner.test.ts
#             FAIL plugins/dsh/src/index.test.ts
#             Error: Failed to load url @deepseek-ai/dsh-tools (resolved id:
#             @deepseek-ai/dsh-tools) in .../plugins/dsh/src/index.ts.
#             Does the file exist?
#             Test Files  7 failed | 188 passed
#             Tests  6 failed | 2548 passed
#
#         This is the classic "works on my machine" shape: the suite passes where
#         the dependency happens to be installed and fails where it is not, and
#         the failing side is the one that decides whether the code ships.
#
#         Pin: whatever installs the root dependencies must also install the
#         sub-package's, so the collected tests can actually load.
# @covers AC-585-01, AC-585-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WF="$REPO_ROOT/.github/workflows/quality-gates.yml"
  ROOT_PKG="$REPO_ROOT/package.json"
  DSH_PKG="$REPO_ROOT/plugins/dsh/package.json"
}

@test "AC-585-01: plugins/dsh is a separate package with its own runtime deps" {
  [ -f "$DSH_PKG" ] || {
    echo "plugins/dsh/package.json is gone -- this test's premise (a sub-package) no longer holds"
    return 1
  }
  # The premise only matters because the root suite collects these tests.
  run node -e '
    const fs = require("fs");
    const cfg = fs.readFileSync(process.argv[1], "utf8");
    const excluded = /"plugins\/\*\*"|"plugins\/dsh\/\*\*"/.test(cfg);
    console.log(excluded ? "excluded" : "collected");
  ' "$REPO_ROOT/vitest.config.ts"
  [ "$output" = "collected" ] || {
    echo "root vitest no longer collects plugins/dsh; the install requirement is moot"
    return 1
  }
  run node -e '
    const p = require(process.argv[1]);
    const deps = Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies });
    const external = deps.filter((d) => d.startsWith("@deepseek-ai/"));
    if (external.length === 0) { console.log("none"); process.exit(0); }
    console.log(external.join(","));
  ' "$DSH_PKG"
  [ "$output" != "none" ] || {
    echo "plugins/dsh no longer depends on any @deepseek-ai/* package; the load failure cannot occur"
    return 1
  }
  echo "plugins/dsh needs: $output"
}

@test "AC-585-02: CI installs plugins/dsh dependencies too" {
  [ -f "$DSH_PKG" ] || return 1
  run node - "$WF" "$ROOT_PKG" << 'JS'
const fs = require('fs');
const yaml = require('js-yaml');
const wf = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

// If the root declares workspaces, root `npm ci` installs sub-packages already.
if (rootPkg.workspaces) {
  console.log('ok: root package.json declares workspaces, so npm ci covers plugins/dsh');
  process.exit(0);
}

// Otherwise some step in the workflow must install inside plugins/dsh.
// Strip YAML comments first: the workflow's own explanatory comment mentions
// `plugins/dsh/...` and `npm ci`, and matching that text made this test pass with
// the install removed (caught by the anti-vacuity run).
let found = false;
for (const [name, job] of Object.entries(wf.jobs || {})) {
  for (const s of Array.isArray(job.steps) ? job.steps : []) {
    const run = (s.run || '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)#.*$/, ''))
      .join('\n');
    if (/plugins\/dsh/.test(run) && /npm\s+(ci|install|i)\b/.test(run)) found = true;
    if (/npm\s+--prefix\s+plugins\/dsh\s+(ci|install)/.test(run)) found = true;
  }
}
if (!found) {
  console.error('root package.json declares NO workspaces, so root `npm ci` never installs');
  console.error('plugins/dsh/node_modules. But root vitest collects plugins/dsh/src/**/*.test.ts,');
  console.error('whose imports (@deepseek-ai/dsh-tools, cordis, dsh-shell) then fail to load in CI.');
  process.exit(1);
}
console.log('ok: CI installs plugins/dsh dependencies');
JS
  if [ "$status" -ne 0 ]; then
    echo "$output"
    return 1
  fi
}
