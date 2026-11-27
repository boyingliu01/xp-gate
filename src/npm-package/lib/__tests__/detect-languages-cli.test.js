/**
 * @test REQ-TOOLS-DETECT-CLI
 * @intent `handleDetectLanguages` 是 `xp-gate detect-languages` 的实现（72 条
 *         语句零覆盖）。它输出的 JSON 是下游 `--write` 配置的来源，也是
 *         用户判断"门禁到底认不认我的项目"的第一手依据。
 *
 *         三条路径都要断言：空项目（什么都不认）、--json（机器可读）、
 *         默认（人类可读并写出配置）。
 *
 * @covers AC-TOOLS-DETECT-CLI-01
 * @covers AC-TOOLS-DETECT-CLI-02
 * @covers AC-TOOLS-DETECT-CLI-03
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { handleDetectLanguages } = require('../language-tools.js');

let tmpDir;

function capture(run) {
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  return Promise.resolve()
    .then(run)
    .then((code) => { console.log = orig; return { code, out: out.join('\n') }; },
      (err) => { console.log = orig; throw err; });
}

beforeEach(() => {
  // The handler takes the project root as an option; chdir is not available in
  // vitest workers, and a seam is the better answer anyway.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-detect-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('handleDetectLanguages', () => {
  it('reports an empty project and exits 0', async () => {
    const { code, out } = await capture(() => handleDetectLanguages([], { projectRoot: tmpDir }));
    expect(code).toBe(0);
    expect(out).toContain('No languages detected');
  });

  it('emits parseable JSON for an empty project in --json mode', async () => {
    const { code, out } = await capture(() => handleDetectLanguages(['--json'], { projectRoot: tmpDir }));
    expect(code).toBe(0);
    const json = JSON.parse(out.slice(out.indexOf('{')));
    expect(json).toEqual({ languages: [], configFiles: {} });
  });

  it('detects a TypeScript project from package.json + tsconfig.json', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const { code, out } = await capture(() => handleDetectLanguages(['--json'], { projectRoot: tmpDir }));
    expect(code).toBe(0);
    expect(out).toContain('typescript');
    expect(JSON.parse(out.slice(out.indexOf('{'))).languages).toContain('typescript');
  });

  it('prints a human-readable list by default', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const { code, out } = await capture(() => handleDetectLanguages([], { projectRoot: tmpDir }));
    expect(code).toBe(0);
    expect(out).toContain('Detected languages');
    // The default path also writes the config; --json deliberately does not.
    expect(out).toContain('Generated config');
  });

  it('writes the project config in the default (non-JSON) mode', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    await capture(() => handleDetectLanguages([], { projectRoot: tmpDir }));
    const entries = fs.readdirSync(tmpDir).filter((f) => f.includes('xp-gate'));
    expect(entries.length).toBeGreaterThan(0);
  });
});
