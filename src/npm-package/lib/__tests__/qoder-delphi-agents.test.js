/**
 * @test qoder-delphi-agents
 * @intent Guard the invariants behind Issue #417: Qoder Custom Agents must bind a
 * built-in model as "[DisplayName](modelId)", stale templates must surface a
 * warning instead of silently falling back to the session model, and agent
 * deployment must never abort an in-flight setup.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

describe('Qoder Delphi agent templates (#417)', () => {
  let tmpHome;
  let logSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-agents-home-'));
    process.env.HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true });
    vi.resetModules();
    delete require.cache[require.resolve('../init')];
    delete require.cache[require.resolve('../detect-deps.js')];
    delete require.cache[require.resolve('../shared-paths')];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(childProcess, 'execSync').mockReturnValue(Buffer.from(''));
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') });
  });

  afterEach(() => {
    delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function repoRoot() {
    // __dirname = src/npm-package/lib/__tests__
    return path.join(__dirname, '..', '..', '..', '..');
  }

  function warned() {
    return warnSpy.mock.calls.map(c => String(c[0])).join('\n');
  }

  function tempAgentPair(filename, srcBody, destBody) {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-agentsrc-'));
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-agentdst-'));
    const srcAgents = path.join(srcDir, 'plugins', 'qoder', 'agents');
    const destAgents = path.join(targetRoot, '.qoder', 'agents');
    fs.mkdirSync(srcAgents, { recursive: true });
    fs.mkdirSync(destAgents, { recursive: true });
    if (srcBody !== null) fs.writeFileSync(path.join(srcAgents, filename), srcBody);
    if (destBody !== null) fs.writeFileSync(path.join(destAgents, filename), destBody);
    return { srcDir, targetRoot, destAgents };
  }

  it('binds every expert template mirror to three distinct built-in models', () => {
    const MODEL_LINE = /^model:\s*"?\[[^"\]]+\]\(([A-Za-z0-9_.-]+)\)"?\s*$/m;
    const mirrors = [
      path.join(repoRoot(), 'plugins', 'qoder', 'agents'),
      path.join(repoRoot(), '.qoder', 'agents'),
      path.join(repoRoot(), 'src', 'npm-package', 'plugins', 'qoder', 'agents'),
    ];

    for (const dir of mirrors) {
      const models = ['delphi-architecture', 'delphi-technical', 'delphi-feasibility'].map(name => {
        const file = path.join(dir, `${name}.md`);
        expect(fs.existsSync(file)).toBe(true);
        const declared = fs.readFileSync(file, 'utf8').match(MODEL_LINE);
        expect(declared).not.toBeNull();
        return declared[1];
      });
      expect(new Set(models).size).toBe(3);
    }
  });

  it('warns about a preserved existing agent whose model binding is stale', () => {
    const dirs = tempAgentPair(
      'delphi-technical.md',
      '---\nmodel: "[DeepSeek-Flash](dfmodel)"\n---\n',
      '---\nmodel: GLM-5.2\n---\n'
    );
    try {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(warned()).toContain('delphi-technical.md');
      expect(warned()).toContain('session model');
      expect(fs.readFileSync(path.join(dirs.destAgents, 'delphi-technical.md'), 'utf8')).toContain('GLM-5.2');
    } finally {
      fs.rmSync(dirs.srcDir, { recursive: true, force: true });
      fs.rmSync(dirs.targetRoot, { recursive: true, force: true });
    }
  });

  it('refuses to deploy a bundled template without a valid model binding', () => {
    const dirs = tempAgentPair(
      'delphi-architecture.md',
      '---\nmodel: Qwen3.7-Max\n---\n',
      null
    );
    try {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(fs.existsSync(path.join(dirs.destAgents, 'delphi-architecture.md'))).toBe(false);
      expect(warned()).toContain('no valid model binding');
    } finally {
      fs.rmSync(dirs.srcDir, { recursive: true, force: true });
      fs.rmSync(dirs.targetRoot, { recursive: true, force: true });
    }
  });

  it('swallows deployment failures instead of aborting setup half-installed', () => {
    const dirs = tempAgentPair(
      'delphi-technical.md',
      '---\nmodel: "[DeepSeek-Flash](dfmodel)"\n---\n',
      null
    );
    const originalCopy = fs.copyFileSync;
    try {
      fs.copyFileSync = () => { throw new Error('EPERM: operation not permitted'); };
      const { deployQoderDelphiAgents } = require('../init');
      expect(() => deployQoderDelphiAgents(dirs.srcDir, dirs.targetRoot)).not.toThrow();
      expect(warned()).toContain('deployment failed');
    } finally {
      fs.copyFileSync = originalCopy;
      fs.rmSync(dirs.srcDir, { recursive: true, force: true });
      fs.rmSync(dirs.targetRoot, { recursive: true, force: true });
    }
  });

  it('reports the detected platform when skipping agent deployment', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = tmpHome;
    fs.rmSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true, force: true });
    try {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(tmpHome, tmpHome);
      expect(logSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain('platform detected:');
    } finally {
      delete process.env.USERPROFILE;
    }
  });
});
