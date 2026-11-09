# .perf-measure — gate probe-cost measurement harness

Verification tooling for `REQ-GATE-PROBE-SHORTCUT` (#782). Evidence lives in
`docs/plans/2026-11-09-gate-input-shortcircuit-result.md`.

Neither script is part of the shipped package; both are dev-only.

## `paired-ab.cjs` — the one that produced the numbers

```bash
node .perf-measure/paired-ab.cjs 12
```

Compares the **HEAD implementation** against the **working-tree implementation**
of `gate-9` and `python-health` on a fixture with no gate-relevant input.

Why it is built the way it is (each point is a mistake that produced a wrong answer
on this machine before):

- **Interleaved ABBA, not before-and-after.** This machine's load swings 20%–80%.
  Two separate runs of 6 rounds gave load means 9.9% and 28.7% apart — invalid under
  rule 6. Interleaving makes load drift affect both arms symmetrically; it needs
  ~12 rounds for the load means to converge.
- **Real invocation contract.** `src/npm-package/lib/gate-runner.js`
  `resolveTsxInvocation()` spawns `node <tsx/dist/cli.mjs> <gate.ts> --run --cwd <dir>`.
  Running the compiled `dist/gates/*.js` directly throws `ERR_MODULE_NOT_FOUND`
  (the package is `"type": "module"` and tsc emits extension-less imports), so tsx
  is the real loader here, not an optimisation.
- **Local disk fixture.** `/tmp` on Windows makes archlint ~120× slower; measurement
  directories must be on a local disk.
- **Load is measured, not assumed.** Both arms get their own CPU-load sample and the
  script prints `LOAD VALID: YES/NO`. A >5% difference means the comparison is not
  reported as a result.

## `probe-timing.cjs` — single-arm convenience

```bash
node .perf-measure/probe-timing.cjs 5 baseline
```

Times each gate in isolation and writes `result-<label>.json`. Useful for a quick
"what does this gate cost right now", but **do not compare two invocations of this
script** — that is the before-and-after mistake. Use `paired-ab.cjs` for A/B.
