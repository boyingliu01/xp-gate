/**
 * @test REQ-GATE-RUNNER-FILES
 * @intent `--all` 模式必须把文件清单**写进临时文件**再交给 gate，不能内联成
 *         `bash -c` 的参数。两条实测原因：
 *
 *         1. Windows 的整条命令行上限是 32,767 字符，超了就是
 *            `spawnSync bash ENAMETOOLONG`——Gate 3 在 `--all` 下**完全跑不起来**；
 *         2. 内联在语义上也是坏的：`JSON.stringify` 会把分隔符转义成字面量
 *            `\n`，而 bash 不解释双引号里的转义序列，于是 gate 收到**一个很长的
 *            不存在的路径**而不是一份清单。
 *
 *         所以临时文件的写入必须真的发生、必须可清理，而清理失败不能阻断 gate。
 *
 * @covers AC-GATE-RUNNER-FILES-01
 * @covers AC-GATE-RUNNER-FILES-02
 * @covers AC-GATE-RUNNER-FILES-03
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  writeAllModeFileList,
  removeFileList,
  buildFileSourceLines,
  firstExisting,
} = require('../gate-runner.js');

let written;

beforeEach(() => {
  written = [];
  vi.spyOn(console, 'error').mockImplementation((...a) => written.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('writeAllModeFileList', () => {
  it('writes the list to a real file and returns its path', () => {
    const contents = 'a.ts\nb.ts\nc.ts';
    const listFile = writeAllModeFileList(contents);
    try {
      // A path is not enough: the gate reads this file, so it must exist with the
      // exact bytes.
      expect(existsSync(listFile)).toBe(true);
      expect(readFileSync(listFile, 'utf8')).toBe(contents);
    } finally {
      removeFileList(listFile);
    }
  });

  it('gives each call a distinct path so two runs cannot collide', () => {
    // The name carries pid and timestamp for this reason; a fixed name would let two
    // concurrent gate runs overwrite each other's population.
    const a = writeAllModeFileList('a');
    const b = writeAllModeFileList('b');
    try {
      expect(a).not.toBe(b);
    } finally {
      removeFileList(a);
      removeFileList(b);
    }
  });
});

describe('removeFileList', () => {
  it('is a no-op for an empty path', () => {
    expect(() => removeFileList('')).not.toThrow();
  });

  it('removes an existing file without complaining', () => {
    const listFile = writeAllModeFileList('x');
    removeFileList(listFile);
    expect(existsSync(listFile)).toBe(false);
    // A successful cleanup must be silent; noise here trains people to ignore it.
    expect(written.join('')).toBe('');
  });

  it('treats ENOENT as already clean', () => {
    // Best effort: another process may have removed it, which is the desired end
    // state, not a failure.
    expect(() => removeFileList('/tmp/xp-gate-definitely-not-here.txt')).not.toThrow();
    expect(written.join('')).not.toContain('could not remove');
  });
});

describe('buildFileSourceLines', () => {
  it('reads the file list in --all mode', () => {
    // #589: an --all run scans the TRACKED TREE, not the diff.
    const lines = buildFileSourceLines(true).join('\n');
    expect(lines).toContain('cat "$5"');
    expect(lines).not.toContain('git diff');
  });

  it('uses the staged-then-HEAD diff form otherwise', () => {
    // The historical scope, unchanged: staged first, then anything versus HEAD.
    const lines = buildFileSourceLines(false).join('\n');
    expect(lines).toContain('git diff --cached');
    expect(lines).toContain('git diff HEAD');
  });

  it('references CHANGED_FILES intact rather than a torn template', () => {
    // The literal `${CHANGED_FILES}` is assembled from pieces precisely because this
    // file's own template literals would eat the braces.
    const lines = buildFileSourceLines(false).join('\n');
    expect(lines).toContain('${CHANGED_FILES}');
  });
});

describe('firstExisting', () => {
  it('returns the first candidate that exists on disk', () => {
    expect(firstExisting(['/definitely/not/here', '/tmp', '/usr'])).toBe('/tmp');
  });

  it('returns the empty string when nothing exists', () => {
    // The empty string is deliberate: the caller tolerates a missing helper and the
    // fragment then fails the way it does in the commit hook.
    expect(firstExisting(['/definitely/not/here'])).toBe('');
  });

  it('returns the empty string for an empty candidate list', () => {
    expect(firstExisting([])).toBe('');
  });
});
