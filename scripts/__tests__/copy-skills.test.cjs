/**
 * @test REQ-QUALITY-COPY-SKILLS
 * @intent Verify copy-skills.mjs copies every skill directory in full (SKILL.md plus references/templates), replaces stale destinations, and rejects bad invocations instead of silently shipping a partial bundle
 * @covers AC-COPY-SKILLS-001, AC-COPY-SKILLS-002
 *
 * Why this exists: copySkills() is what populates the published npm bundle and
 * every plugin's skills/ directory. It had no test at all, and its failure mode
 * is silent — a skill that fails to copy produces a package that installs
 * cleanly and is simply missing a skill.
 *
 * The module is exercised through its CLI entry rather than imported: it is ESM
 * under a CommonJS test tree, and driving the real --source/--dest/--verify path
 * also covers the argument handling the build scripts depend on.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'copy-skills.mjs');

function makeSkill(root, name, files) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function runCopySkills(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

describe('copy-skills', () => {
  let work;
  let src;
  let dest;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-skills-'));
    src = path.join(work, 'skills');
    dest = path.join(work, 'out');
    fs.mkdirSync(src, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('AC-COPY-SKILLS-001 copies a skill directory whole, including nested references', () => {
    makeSkill(src, 'alpha', {
      'SKILL.md': '# alpha',
      'references/notes.md': 'notes',
      'templates/t.md': 'template',
    });

    const res = runCopySkills(['--source', src, '--dest', dest]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Total skills copied: 1');
    expect(fs.readFileSync(path.join(dest, 'alpha', 'SKILL.md'), 'utf8')).toBe('# alpha');
    expect(fs.readFileSync(path.join(dest, 'alpha', 'references', 'notes.md'), 'utf8')).toBe('notes');
    expect(fs.readFileSync(path.join(dest, 'alpha', 'templates', 't.md'), 'utf8')).toBe('template');
  });

  it('AC-COPY-SKILLS-001 skips directories without SKILL.md', () => {
    makeSkill(src, 'real', { 'SKILL.md': '# real' });
    makeSkill(src, 'not-a-skill', { 'README.md': 'no skill file here' });

    const res = runCopySkills(['--source', src, '--dest', dest]);

    expect(res.stdout).toContain('Total skills copied: 1');
    expect(fs.existsSync(path.join(dest, 'real', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'not-a-skill'))).toBe(false);
  });

  it('AC-COPY-SKILLS-001 replaces a stale destination instead of merging into it', () => {
    makeSkill(src, 'alpha', { 'SKILL.md': '# alpha v2' });
    // A previous copy left a file behind that the source no longer has.
    fs.mkdirSync(path.join(dest, 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'alpha', 'removed.md'), 'stale');

    const res = runCopySkills(['--source', src, '--dest', dest]);

    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(dest, 'alpha', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'alpha', 'removed.md'))).toBe(false);
  });

  it('AC-COPY-SKILLS-002 verify passes when every byte landed', () => {
    makeSkill(src, 'alpha', { 'SKILL.md': '# alpha', 'references/a.md': 'A' });

    const res = runCopySkills(['--source', src, '--dest', dest, '--verify']);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('[verify] OK');
    expect(res.stdout).not.toContain('[verify] FAIL');
  });

  it('AC-COPY-SKILLS-002 missing source fails loudly instead of copying nothing', () => {
    const res = runCopySkills(['--source', path.join(work, 'nope'), '--dest', dest, '--verify']);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Source directory not found');
  });

  it('AC-COPY-SKILLS-002 rejects an unknown flag instead of silently ignoring it', () => {
    makeSkill(src, 'alpha', { 'SKILL.md': '# alpha' });

    const res = runCopySkills(['--source', src, '--dest', dest, '--bogus']);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Unknown option: --bogus');
  });
});
