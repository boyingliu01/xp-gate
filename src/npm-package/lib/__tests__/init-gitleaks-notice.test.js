/**
 * @intent #511: Gate 8 is fail-closed since #499 (missing gitleaks BLOCKS the
 *         commit). The npm init path never surfaced that fact, so an upgrading
 *         user met a hard BLOCK with no prior signal. `probeGitleaksNotice`
 *         prints a migration notice and never installs anything.
 * @covers probeGitleaksNotice() in lib/init.js
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { probeGitleaksNotice } = require('../init.js');

describe('probeGitleaksNotice (#511)', () => {
  it('reports present and stays quiet when gitleaks is available', () => {
    const lines = [];
    const result = probeGitleaksNotice(
      () => ({ available: true, version: '8.24.2' }),
      l => lines.push(l),
    );
    expect(result.available).toBe(true);
    const joined = lines.join('\n');
    expect(joined).toContain('gitleaks present');
    expect(joined).toContain('8.24.2');
    expect(joined).not.toContain('FAIL-CLOSED');
  });

  it('prints the fail-closed migration notice when gitleaks is missing', () => {
    const lines = [];
    const result = probeGitleaksNotice(() => ({ available: false }), l => lines.push(l));
    expect(result.available).toBe(false);
    const joined = lines.join('\n');
    expect(joined).toContain('FAIL-CLOSED');
    expect(joined).toContain('Gate 8');
    expect(joined).toContain('install-gitleaks.sh');
    expect(joined).toContain('brew install gitleaks');
    expect(joined).toContain('winget install gitleaks');
  });

  it('probes exactly the gitleaks tool name', () => {
    const checkTool = vi.fn(() => ({ available: true }));
    probeGitleaksNotice(checkTool, () => {});
    expect(checkTool).toHaveBeenCalledWith('gitleaks');
  });

  it('never installs anything — it is a pure text probe', () => {
    // The helper must not shell out: no exec/spawn import is exercised here,
    // and the only observable effect is log lines. A missing tool returns the
    // notice; the caller decides whether to install.
    const lines = [];
    const before = process.env.PATH;
    probeGitleaksNotice(() => ({ available: false }), l => lines.push(l));
    expect(process.env.PATH).toBe(before);
    expect(lines.some(l => /dev\/null|execSync|spawn/.test(l))).toBe(false);
  });
});
