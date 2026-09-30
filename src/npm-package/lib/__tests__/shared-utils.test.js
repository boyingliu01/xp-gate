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
  });
});
