/**
 * @test REQ-726
 * @intent ArchUnit and Konsist are LIBRARIES, not CLIs. `detectBy: 'build-file'`
 *         exists precisely because there is no binary to probe -- but the
 *         `install` field was still filled with an instruction TO A HUMAN
 *         ('add "com.tngtech.archunit:archunit-junit5" to pom.xml / build.gradle').
 *         `installTool()` hands that string to execSync with a shell, so every
 *         Java project running `xp-gate doctor --fix --install-tools` got
 *         `'add' is not recognized as an internal or external command` (or, on
 *         POSIX, an attempted `/bin/sh` execution of prose) and a spurious
 *         install failure for a library that is installed by editing a build
 *         file. A tool with no runnable installer must return an actionable
 *         manual instruction and must never spawn a process.
 * @covers AC-726-02
 */
'use strict';

const path = require('path');

describe('installTool — build-file tools are documented, never executed (#689 review)', () => {
  /**
   * Fresh module each time: installTool reads process.platform at call time,
   * but the tool definitions are module state and a stale cache across cases
   * would hide a change.
   */
  function loadTools() {
    const modPath = require.resolve('../language-tools.js');
    delete require.cache[modPath];
    return require(modPath);
  }

  /**
   * getArchitectureTools() groups tools by language (`{ java: [...], kotlin: [...] }`),
   * so flatten before filtering.
   */
  function buildFileTools(mod) {
    const byLang = mod.getArchitectureTools();
    return Object.values(byLang).flat().filter((tool) => tool.detectBy === 'build-file');
  }

  function findTool(mod, name) {
    return buildFileTools(mod).find((tool) => tool.name === name);
  }

  it('finds the build-file tools this contract is about', () => {
    const names = buildFileTools(loadTools()).map((tool) => tool.name);
    expect(names).toContain('archunit');
    expect(names).toContain('konsist');
  });

  it('refuses to shell-execute a build-file install string and explains why', () => {
    const mod = loadTools();
    const archunit = findTool(mod, 'archunit');

    const result = mod.installTool(archunit);

    expect(result.success).toBe(false);
    // The message must tell the reader what to DO -- the whole point of the
    // field was the instruction, so it must survive as guidance.
    expect(result.message).toMatch(/pom\.xml|build\.gradle/i);
    // And it must be explicit that nothing was run, so a caller cannot read a
    // false failure as "the install command failed".
    expect(result.message).toMatch(/manual|not run|no install command is runnable|library/i);
  });

  it('does not spawn a shell for a build-file tool (the prose never reaches execSync)', () => {
    const mod = loadTools();
    const konsist = findTool(mod, 'konsist');
    const before = console.log;
    const logged = [];
    console.log = (line) => logged.push(String(line));
    try {
      mod.installTool(konsist);
    } finally {
      console.log = before;
    }
    // The old path logged `Installing <name>: <prose>` immediately before
    // execSync. Its absence is the observable proof that no process started.
    const spawning = logged.filter((line) => /^Installing /i.test(line));
    expect(spawning).toEqual([]);
  });
});
