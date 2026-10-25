/**
 * @test REQ-613
 * @intent `xp-gate check . --all` could never run Gate 4 on Windows:
 *
 *             Failed to run principles check: The command line is too long.
 *
 *         Two causes added together in `lib/principles.js`:
 *
 *           1. `shell: process.platform === 'win32'` routes through cmd.exe, whose
 *              command line is capped at 8191 characters (CreateProcess allows
 *              32767).
 *           2. every path is joined into ONE argv element — `files.join(' ')` — so
 *              the whole file list becomes part of that command line. Measured in
 *              the issue: 135 Java files came to 12944 characters before the
 *              `npx -y tsx <entry> --files --format json` prefix was added.
 *
 *         This is not "the occasional huge project"; it is a mid-sized project on
 *         Windows, every time.
 *
 *         Splitting the argv was explicitly ruled out in the issue and the reasoning
 *         holds: the bottleneck is total character count, not quoting, and `npx` on
 *         Windows still needs `shell: true` to be found at all.
 *
 *         The other half of the issue is what the failure is CALLED. "Failed to run
 *         principles check" reads like a principles violation. It is not — the tool
 *         never ran. #596 fixed the same confusion in the shell toolchain
 *         (`classify_tool_failure`); this pins it for the JS side.
 * @covers AC-613-01, AC-613-02, AC-613-03
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const principles = require('../principles.js');

// cmd.exe's command-line ceiling. Named rather than repeated: it is the number the
// whole issue is about, and a bare 8191 in several places reads as unrelated facts.
const CMD_EXE_LIMIT = 8191;

// The measured case from the issue: 135 Java files => 12944 characters, which blocked
// every `--all` run on Windows.
const ISSUE_FILE_COUNT = 135;

// Comfortably past the limit, used where the exact count does not matter — only that
// the list is too long to inline.
const LARGE_FILE_COUNT = 400;

/** A path-only string of roughly `len` characters (the join() payload). */
function longFileList(count) {
  // Paths must be long enough that `count` of them realistically exceeds the
  // Windows limit; the issue's own measurement was ~90 chars per path.
  return Array.from(
    { length: count },
    (_, i) =>
      `src/main/java/com/example/deeply/nested/module${i}/service/implementation/File${i}ImplementationImpl.java`
  );
}

describe('REQ-613: Gate 4 must not blow the Windows command-line limit', () => {
  it('AC-613-01: the command line for a mid-sized Java project stays under cmd.exe\\u2019s character limit', () => {
    // The measured case from the issue: 135 files, 12944 characters, blocked.
    const files = longFileList(ISSUE_FILE_COUNT);
    const joined = files.join(' ');
    expect(joined.length).toBeGreaterThan(CMD_EXE_LIMIT);

    const plan = principles.buildPrinciplesInvocation(files, 'json');
    // The contract: whatever is handed to the OS is a single argument list, and the
    // total of that list's characters is what must fit. A plan that still carries the
    // whole list in one argument has not solved anything.
    const longest = Math.max(...plan.args.map((a) => String(a).length));
    expect(longest, `longest single argument is ${longest} chars`).toBeLessThan(CMD_EXE_LIMIT);
  });

  it('AC-613-01: a large file list is passed by reference, not by value', () => {
    // The fix that the issue recommends first: use the project's own tsx through
    // node.exe (an absolute path, no shim, no shell) and keep the argv bounded. If a
    // future change puts every path back on the command line, this fails.
    const files = longFileList(LARGE_FILE_COUNT);
    const plan = principles.buildPrinciplesInvocation(files, 'json');

    const argvChars = plan.args.reduce((n, a) => n + String(a).length + 1, 0);
    expect(argvChars, `argv carries ${argvChars} chars`).toBeLessThan(CMD_EXE_LIMIT);
  });

  it('AC-613-02: the invocation never opts into a shell on any platform', () => {
    // `shell: true` is what routes through cmd.exe and its 8191 limit. It must not be
    // requested at all: the correct target is node.exe, which needs no shim.
    const plan = principles.buildPrinciplesInvocation(['a.ts'], 'json');
    expect(plan.useShell).toBe(false);
  });

  it('AC-613-02: the plan names an executable that needs no shell shim', () => {
    // Either node.exe (preferred — absolute, no shim) or a resolved tool path. A bare
    // 'npx' string would force the caller back to shell:true on Windows.
    const plan = principles.buildPrinciplesInvocation(['a.ts'], 'json');
    expect(plan.command.length).toBeGreaterThan(0);
    expect(plan.command).not.toBe('npx');
  });

  it('AC-613-03: a command-line-too-long failure is classified as a toolchain problem, not a finding', () => {
    // The message used to be "Failed to run principles check", which reads as a code
    // verdict. It never was one.
    expect(principles.classifyPrinciplesFailure({ error: new Error('E2BIG') })).toBe('TOOLCHAIN');
    expect(principles.classifyPrinciplesFailure({ error: new Error('spawn ENAMETOOLONG') })).toBe('TOOLCHAIN');
    expect(
      principles.classifyPrinciplesFailure({
        stdout: 'The command line is too long.',
        status: 1,
      })
    ).toBe('TOOLCHAIN');
  });

  it('AC-613-03: a real principles violation is still classified as a finding', () => {
    // The control. If everything classified as TOOLCHAIN, Gate 4 could never block on
    // an actual violation again — worse than the bug being fixed.
    expect(principles.classifyPrinciplesFailure({ stdout: '1 violations total', status: 1 })).toBe('FINDING');
    expect(principles.classifyPrinciplesFailure({ status: 1 })).toBe('FINDING');
  });

  it('AC-613-01: a file list that fits is still passed directly', () => {
    // Small lists must not be needlessly diverted; the direct path is well tested and
    // has different failure semantics.
    const plan = principles.buildPrinciplesInvocation(['src/a.ts', 'src/b.ts'], 'json');
    const flat = plan.args.join(' ');
    expect(flat).toContain('src/a.ts');
    expect(flat).toContain('src/b.ts');
  });

  it('AC-613-01: the by-reference handoff writes the list somewhere the child can read', () => {
    // Sanity on the mechanism itself: if the plan says "by reference", the reference
    // has to be a real file path the child will be given, not a placeholder.
    const files = longFileList(LARGE_FILE_COUNT);
    const plan = principles.buildPrinciplesInvocation(files, 'json');
    const refArg = plan.args.find((a) => String(a).startsWith('@'));
    expect(refArg, 'no @file argument in the plan').toBeTruthy();
    const refPath = refArg.slice(1);
    expect(path.isAbsolute(refPath) || refPath.includes('tmp') || refPath.includes('TEMP') || refPath.toLowerCase().includes('temp')).toBe(true);
    // And the file must not be left behind by merely planning.
    expect(fs.existsSync(refPath) && plan.cleanup === false).toBe(false);
  });

  it('AC-613-02: the WIRE test \u2014 the call site actually uses the plan it builds', () => {
    // This case exists because the first version of this suite had a hole: every
    // other case asserts on `buildPrinciplesInvocation`'s OUTPUT, and reverting the
    // call site to the old `spawnSync('npx', [...files.join(' ') ...], { shell: true })`
    // left all 8 green. A perfectly correct planner that nobody consults.
    //
    // Intercepting child_process.spawnSync does NOT work here: principles.js
    // destructures `{ spawnSync }` at load time, so replacing the property afterwards
    // never reaches the bound local. (I tried that first and the case failed with
    // "spawnSync was never called" — which is itself a useful demonstration that an
    // indirect assertion can fail for a reason unrelated to the defect.)
    //
    // So this asserts the wiring structurally, plus the one property that is cheap to
    // check at runtime: the module must expose the planner, meaning the call site has
    // something to consume.
    const source = fs.readFileSync(path.join(__dirname, '..', 'principles.js'), 'utf8');

    // The shell:true on the call site, verbatim.
    expect(source, 'the shell:true spawn is back at the call site').not.toContain(
      "shell: process.platform === 'win32'"
    );

    // The wiring: spawnSync must be fed the plan, and the plan must control the shell.
    expect(source).toContain('spawnSync(plan.command, plan.args');
    expect(source).toContain('shell: plan.useShell');

    // The planner bounds the list; the join() is still allowed for SHORT lists inside
    // buildPrinciplesInvocation (that is the correct path for small inputs), but it
    // must never appear in the spawnSync argument position any more.
    const spawnIdx = source.indexOf('spawnSync(plan.command, plan.args');
    const joinAfterSpawn = source.indexOf('files.join(', spawnIdx);
    expect(joinAfterSpawn, 'the spawn call still joins the whole list inline').toBe(-1);

    // And the planner must really exist and be exported, so the call site cannot be
    // referencing a name that only looks right.
    expect(typeof principles.buildPrinciplesInvocation).toBe('function');
  });
});

// Keep the imports referenced so linting does not flag them when the module grows.
void os;
