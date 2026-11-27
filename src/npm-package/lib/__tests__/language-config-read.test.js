/**
 * @test REQ-LANG-CONFIG
 * @intent `.xp-gate-config.json` 是 `detect-languages --write` 的产物，之后由
 *         check-tools 和 install-tools 读回。它的读取契约是**永不抛异常**：
 *         一个损坏的配置文件必须降级为"没有配置"，而不是让整个命令崩溃。
 *
 *         这条契约此前没有任何直接测试——覆盖率显示 `readProjectConfig` 一次
 *         都没被调用过，尽管它决定了 after-config 的所有行为。
 *
 * @covers AC-LANG-CONFIG-01
 * @covers AC-LANG-CONFIG-02
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tools = require('../language-tools.js');

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-langcfg-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readProjectConfig', () => {
  it('returns null when the project has no config file', () => {
    // "No config" is the common case for a repo that never ran --write; callers use
    // it to decide whether to re-detect, so it must be null and not {}.
    expect(tools.readProjectConfig(root)).toBeNull();
  });

  it('parses a config written by generateProjectConfig', () => {
    const written = tools.generateProjectConfig(root, ['typescript'], {
      typescript: [{ tool: { name: 'eslint', optional: false, gates: [1] }, status: 'available' }],
    });

    const read = tools.readProjectConfig(root);
    expect(read).not.toBeNull();
    expect(read.version).toBe(1);
    expect(read.languages.typescript.name).toBe('TypeScript/JavaScript');
    expect(written.endsWith('.xp-gate-config.json')).toBe(true);
  });

  it('returns null for malformed JSON instead of throwing', () => {
    // A half-written file is what a killed `--write` leaves behind. Throwing here
    // would make every later command fail on a file the tool itself created.
    writeFileSync(join(root, '.xp-gate-config.json'), '{ "version": 1, ');
    expect(tools.readProjectConfig(root)).toBeNull();
  });

  it('returns null when the config path is a directory, not a file', () => {
    // The try/catch covers EISDIR as well; asserting it keeps the "never throws"
    // contract from being narrowed to JSON errors alone.
    const { mkdirSync } = require('node:fs');
    mkdirSync(join(root, '.xp-gate-config.json'));
    expect(tools.readProjectConfig(root)).toBeNull();
  });
});
