/**
 * @test Issues #871 make the project discoverable from the CLI itself
 * @intent The three call sites must actually invoke the notice -- a module
 *         nobody calls is the same silent failure this repo keeps digging out.
 * @covers #871
 */
const fs = require('fs');
const path = require('path');

const LIBS = path.join(__dirname, '..');
const BIN = path.join(LIBS, '..', 'bin', 'xp-gate.js');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

describe('REQ-871 star notice is wired into the three conversion points', () => {
  it('--version calls the notice', () => {
    const source = read(BIN);
    const versionBlock = source.slice(source.indexOf("args.includes('--version')"));
    const end = versionBlock.indexOf('return;');
    expect(versionBlock.slice(0, end)).toContain('maybeShowStarNotice');
  });

  it('a completed init calls the notice', () => {
    const source = read(path.join(LIBS, 'init.js'));
    expect(source).toMatch(/Installation complete![\s\S]{0,400}maybeShowStarNotice/);
  });

  it('check calls the notice only when nothing failed', () => {
    const source = read(path.join(LIBS, 'check.js'));
    expect(source).toMatch(/if \(failures === 0\) require\('\.\/star-notice\.js'\)\.maybeShowStarNotice\(\)/);
  });

  it('star-notice has no dependency on the CLI layer (no import cycles)', () => {
    const source = read(path.join(LIBS, 'star-notice.js'));
    expect(source).not.toMatch(/require\(['"]\.\.\/(bin|lib\/(?!shared-paths))/);
  });
});
