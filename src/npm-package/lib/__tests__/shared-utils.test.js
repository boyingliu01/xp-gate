/**
 * @test shared-utils
 * @intent Verify copyAdapters deploys shipped gate scripts (gate-*.sh, sprint-gate.sh) from the package root so npm-installed init/setup-global produce working gates
 * @covers gate-script deployment into ADAPTER_DIR / PROJECT_GITHOOKS for init and setup-global
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('shared-utils', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-shared-utils-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('copyAdapters', () => {
    it('copies gate-*.sh and sprint-gate.sh from the package root (npm install layout)', () => {
      // npm install layout: the package root carries the shipped copies of
      // gate-*.sh + sprint-gate.sh (placed by sync-package-content.js) and the
      // repo-level githooks/ directory does not exist.
      const pkgRoot = path.join(tmpRoot, 'node_modules', '@boyingliu01', 'xp-gate');
      fs.mkdirSync(pkgRoot, { recursive: true });
      fs.writeFileSync(path.join(pkgRoot, 'adapter-common.sh'), '# adapter-common');
      fs.writeFileSync(path.join(pkgRoot, 'gate-3.sh'), '# gate-3');
      fs.writeFileSync(path.join(pkgRoot, 'gate-12-file-hygiene.sh'), '# gate-12');
      fs.writeFileSync(path.join(pkgRoot, 'sprint-gate.sh'), '# sprint-gate');
      fs.mkdirSync(path.join(pkgRoot, 'adapters'), { recursive: true });
      fs.writeFileSync(path.join(pkgRoot, 'adapters', 'typescript.sh'), '# ts');

      const destDir = path.join(tmpRoot, 'project-githooks');
      fs.mkdirSync(destDir, { recursive: true });

      const { copyAdapters } = require('../shared-utils');
      copyAdapters(pkgRoot, destDir);

      expect(fs.existsSync(path.join(destDir, 'adapter-common.sh'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'typescript.sh'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'gate-3.sh'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'gate-12-file-hygiene.sh'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'sprint-gate.sh'))).toBe(true);
    });

    it('copies only gate-*.sh and sprint-gate.sh from the package root (filters other files)', () => {
      const pkgRoot = path.join(tmpRoot, 'pkg');
      fs.mkdirSync(path.join(pkgRoot, 'adapters'), { recursive: true });
      fs.writeFileSync(path.join(pkgRoot, 'adapter-common.sh'), '# adapter-common');
      fs.writeFileSync(path.join(pkgRoot, 'gate-3.sh'), '# gate-3');
      fs.writeFileSync(path.join(pkgRoot, 'verify.sh'), '# verify');
      fs.writeFileSync(path.join(pkgRoot, 'VERSION'), '1.0.0.0');

      const destDir = path.join(tmpRoot, 'dest');
      fs.mkdirSync(destDir, { recursive: true });

      const { copyAdapters } = require('../shared-utils');
      copyAdapters(pkgRoot, destDir);

      expect(fs.existsSync(path.join(destDir, 'gate-3.sh'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'verify.sh'))).toBe(false);
      expect(fs.existsSync(path.join(destDir, 'VERSION'))).toBe(false);
    });
    it('copies hooks/lib so gate-3 can source the complexity ratchet library', () => {
      // gate-3.sh resolves $GATE_DIR/lib/ccn-ratchet.sh, and GATE_DIR is this same
      // adapters directory (init.js: copyAdapters(srcDir, GLOBAL_ADAPTERS_DIR)). The
      // installer used to skip hooks/lib entirely, so the source failed with "No such
      // file or directory", evaluate_ccn_ratchet stayed undefined and the ratchet
      // graded every CCN regression as PASS.
      const pkgRoot = path.join(tmpRoot, 'pkg');
      fs.mkdirSync(path.join(pkgRoot, 'hooks', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(pkgRoot, 'gate-3.sh'), '# gate-3');
      fs.writeFileSync(path.join(pkgRoot, 'hooks', 'lib', 'ccn-ratchet.sh'), '# ratchet');
      fs.writeFileSync(path.join(pkgRoot, 'hooks', 'lib', 'now-ms.sh'), '# now-ms');

      const destDir = path.join(tmpRoot, 'adapters');
      fs.mkdirSync(destDir, { recursive: true });

      const { copyAdapters } = require('../shared-utils');
      copyAdapters(pkgRoot, destDir);

      expect(fs.existsSync(path.join(destDir, 'lib', 'ccn-ratchet.sh'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'lib', 'now-ms.sh'))).toBe(true);
    });
  });
  describe('copyHooks ships post-commit (audit flush + bypass detection)', () => {
    it('@covers gate-script deployment: copyHooks installs post-commit, not just pre-commit/pre-push/post-merge', () => {
      // Regression: post-commit was absent from both the ship list and copyHooks,
      // so the audit-attribution flush and --no-verify bypass detection that live
      // in post-commit never executed for any installed user.
      const pkgRoot = path.join(tmpRoot, 'node_modules', '@boyingliu01', 'xp-gate');
      const hooksSrc = path.join(pkgRoot, 'hooks');
      fs.mkdirSync(hooksSrc, { recursive: true });
      for (const h of ['pre-commit', 'pre-push', 'post-commit', 'post-merge']) {
        fs.writeFileSync(path.join(hooksSrc, h), `# ${h}`);
      }
      const destDir = path.join(tmpRoot, 'dest-hooks');
      fs.mkdirSync(destDir, { recursive: true });

      const { copyHooks } = require('../shared-utils');
      copyHooks(pkgRoot, destDir);

      expect(fs.existsSync(path.join(destDir, 'post-commit'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'pre-commit'))).toBe(true);
    });
  });

  describe('copyHooks ships hook-module-resolution.sh (#655/#631)', () => {
    it('@covers gate-script deployment: copyHooks installs hook-module-resolution.sh so pre-commit does not FATAL', () => {
      // pre-commit loads hook-module-resolution.sh before any tier decision and
      // fails closed. It was absent from copyHooks, so every fresh `init` /
      // `setup-global` produced hooks that FATAL'd on every commit.
      const pkgRoot = path.join(tmpRoot, 'node_modules', '@boyingliu01', 'xp-gate');
      const hooksSrc = path.join(pkgRoot, 'hooks');
      fs.mkdirSync(hooksSrc, { recursive: true });
      for (const h of ['pre-commit', 'pre-push', 'post-commit', 'post-merge', 'hook-module-resolution.sh']) {
        fs.writeFileSync(path.join(hooksSrc, h), `# ${h}`);
      }
      const destDir = path.join(tmpRoot, 'dest-hooks');
      fs.mkdirSync(destDir, { recursive: true });

      const { copyHooks } = require('../shared-utils');
      copyHooks(pkgRoot, destDir);

      expect(fs.existsSync(path.join(destDir, 'hook-module-resolution.sh'))).toBe(true);
    });
  });

});
