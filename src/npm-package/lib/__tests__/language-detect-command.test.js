/**
 * @test REQ-LANG-DETECT-CMD
 * @intent `detect-languages` 的输出有两个消费者：人和脚本（`--json`）。
 *
 *         两条契约：
 *         1. **没有语言也是成功**。一个没有可识别项目的目录，答案是"没有"，
 *            而不是错误——退出码非零会让"这里什么都没有"看起来像故障。
 *         2. `--json` 时**只**输出一个 JSON 文档。人类可读的进度行混进 stdout
 *            会让 `jq` 直接语法错误。
 *
 *         默认（非 `--json`）会写 `.xp-gate-config.json`；`--json` 默认只读。
 *
 * @covers AC-LANG-DETECT-CMD-01
 * @covers AC-LANG-DETECT-CMD-02
 * @covers AC-LANG-DETECT-CMD-03
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { handleDetectLanguages } = require('../language-tools.js');

let root;
let out;

/** Write a fixture file, naming the path when it cannot be written. */
function write(name, body) {
  const target = join(root, name);
  try {
    writeFileSync(target, body);
  } catch (err) {
    throw new Error(`cannot write fixture ${target}: ${err.message}`);
  }
}

function stdout() {
  return out.join('\n');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-detect-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('handleDetectLanguages', () => {
  it('exits 0 on a directory with no recognisable project', async () => {
    // Nothing here is a valid answer, not a failure.
    const code = await handleDetectLanguages([], { projectRoot: root });
    expect(code).toBe(0);
    expect(stdout()).toContain('No languages detected');
  });

  it('emits only a JSON document under --json for an empty project', async () => {
    const code = await handleDetectLanguages(['--json'], { projectRoot: root });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout());
    expect(parsed.languages).toEqual([]);
    expect(parsed.configFiles).toEqual({});
  });

  it('detects a language from its manifest and names the manifest', async () => {
    write('package.json', '{}');
    await handleDetectLanguages([], { projectRoot: root });
    expect(stdout()).toContain('typescript');
    expect(stdout()).toContain('package.json');
  });

  it('reports the detection as parseable JSON under --json', async () => {
    write('package.json', '{}');
    await handleDetectLanguages(['--json'], { projectRoot: root });
    const parsed = JSON.parse(stdout());
    expect(parsed.languages).toContain('typescript');
    expect(parsed.configFiles.typescript).toContain('package.json');
    // Per-language tool availability rides inside the same document.
    expect(parsed.tools).toHaveProperty('typescript');
  });

  it('writes the project config when not in --json mode', async () => {
    write('package.json', '{}');
    await handleDetectLanguages([], { projectRoot: root });
    expect(existsSync(join(root, '.xp-gate-config.json'))).toBe(true);
  });

  it('does NOT write the project config in --json mode', async () => {
    // JSON output is a READ by contract; a machine-readable run must not mutate the
    // working tree it was asked to describe.
    write('package.json', '{}');
    await handleDetectLanguages(['--json'], { projectRoot: root });
    expect(existsSync(join(root, '.xp-gate-config.json'))).toBe(false);
  });

  it('honours --write explicitly in json mode', async () => {
    // `--write` is the documented way to ask for the file even when the output shape
    // is machine-readable.
    write('package.json', '{}');
    await handleDetectLanguages(['--json', '--write'], { projectRoot: root });
    expect(existsSync(join(root, '.xp-gate-config.json'))).toBe(true);
  });
});
