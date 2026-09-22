/**
 * @test qoder-delphi-agents
 * @intent Guard the invariants behind Issue #417: Qoder Custom Agents must bind a
 * built-in model as "[DisplayName](modelId)", stale or diverged deployments must
 * surface a warning instead of silently falling back to the session model, and
 * agent deployment must never abort an in-flight setup.
 */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const {
  resetLibModules, muteConsole, makeTempDirs, removeTempDirs,
} = require('./helpers/lib-sandbox.cjs');

const LIB_MODULES = ['../init', '../detect-deps.js', '../shared-paths'].map(name => require.resolve(name));

describe('Qoder Delphi agent templates (#417)', () => {
  let tmpDirs;
  let tmpHome;
  let logSpy;
  let warnSpy;
  let originalHome;

  beforeEach(() => {
    tmpDirs = makeTempDirs(['xpgate-agents-home']);
    tmpHome = tmpDirs['xpgate-agents-home'];
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true });
    resetLibModules(vi, LIB_MODULES);
    ({ log: logSpy, warn: warnSpy } = muteConsole(vi));
    vi.spyOn(childProcess, 'execSync').mockReturnValue(Buffer.from(''));
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    removeTempDirs(tmpDirs);
    vi.restoreAllMocks();
  });

  function repoRoot() {
    // __dirname = src/npm-package/lib/__tests__
    return path.join(__dirname, '..', '..', '..', '..');
  }

  function warned() {
    return warnSpy.mock.calls.map(c => String(c[0])).join('\n');
  }

  function logged() {
    return logSpy.mock.calls.map(c => String(c[0])).join('\n');
  }

  function agentTemplate(modelLine, name) {
    return `---\nname: ${name}\n${modelLine}\n---\n# ${name}\n`;
  }

  function tempAgentPair(filename, srcBody, destBody) {
    const dirs = makeTempDirs(['xpgate-agentsrc', 'xpgate-agentdst']);
    const srcDir = dirs['xpgate-agentsrc'];
    const targetRoot = dirs['xpgate-agentdst'];
    const srcAgents = path.join(srcDir, 'plugins', 'qoder', 'agents');
    const destAgents = path.join(targetRoot, '.qoder', 'agents');
    fs.mkdirSync(srcAgents, { recursive: true });
    fs.mkdirSync(destAgents, { recursive: true });
    if (srcBody !== null) fs.writeFileSync(path.join(srcAgents, filename), srcBody);
    if (destBody !== null) fs.writeFileSync(path.join(destAgents, filename), destBody);
    return { dirs, srcDir, targetRoot, srcAgents, destAgents };
  }

  function withDirs(dirs, fn) {
    try {
      return fn();
    } finally {
      removeTempDirs(dirs.dirs);
    }
  }

  it('binds every expert template mirror to three distinct, identical built-in models', () => {
    const { readQoderModelId } = require('../init');
    const mirrors = [
      path.join(repoRoot(), 'plugins', 'qoder', 'agents'),
      path.join(repoRoot(), '.qoder', 'agents'),
      path.join(repoRoot(), 'src', 'npm-package', 'plugins', 'qoder', 'agents'),
    ];
    const names = ['delphi-architecture', 'delphi-technical', 'delphi-feasibility'];

    for (const dir of mirrors) {
      const models = names.map(name => {
        const file = path.join(dir, `${name}.md`);
        expect(fs.existsSync(file)).toBe(true);
        const modelId = readQoderModelId(file);
        expect(modelId).not.toBeNull();
        return modelId;
      });
      expect(new Set(models).size).toBe(3);
      // Bodies may diverge (`.qoder/agents/` is this repo's own install), but the
      // model each expert pins must not.
      for (const [index, name] of names.entries()) {
        const ids = mirrors.map(dir => readQoderModelId(path.join(dir, `${name}.md`)));
        expect(new Set(ids).size).toBe(1);
        expect(ids[0]).toBe(models[index]);
      }
    }
  });

  it('reads the modelId only from a quoted frontmatter binding', () => {
    const { readQoderModelId } = require('../init');
    const dirs = tempAgentPair('probe.md', null, null);
    return withDirs(dirs, () => {
      const write = body => {
        const file = path.join(dirs.destAgents, 'probe.md');
        fs.writeFileSync(file, body);
        return readQoderModelId(file);
      };
      expect(write('---\nmodel: "[Qwen3.8-Flash](qfmodel)"\n---\n')).toBe('qfmodel');
      expect(write("---\nmodel: '[Qwen3.8-Flash](qfmodel)'\n---\n")).toBe('qfmodel');
      expect(write('---\nmodel: [Qwen3.8-Flash](qfmodel)\n---\n')).toBe('qfmodel');
      expect(write('---\nmodel: "[Qwen3.8-Flash](qfmodel)\n---\n')).toBeNull(); // unbalanced quote
      expect(write('---\nmodel: Qwen3.7-Max\n---\n')).toBeNull(); // bare name
      expect(write('---\nname: x\n---\n\nExample:\n```md\nmodel: "[Doc](docmodel)"\n```\n')).toBeNull();
    });
  });

  it('warns about a preserved existing agent whose model binding is stale', () => {
    const dirs = tempAgentPair(
      'delphi-technical.md',
      agentTemplate('model: "[DeepSeek-Flash](dfmodel)"', 'delphi-technical'),
      agentTemplate('model: GLM-5.2', 'delphi-technical')
    );
    withDirs(dirs, () => {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(warned()).toContain('delphi-technical.md');
      expect(warned()).toContain('session model');
      expect(fs.readFileSync(path.join(dirs.destAgents, 'delphi-technical.md'), 'utf8')).toContain('GLM-5.2');
    });
  });

  it('warns when a preserved agent binds a different model than this version ships', () => {
    const dirs = tempAgentPair(
      'delphi-feasibility.md',
      agentTemplate('model: "[DeepSeek-Flash](dfmodel)"', 'delphi-feasibility'),
      agentTemplate('model: "[GLM-5.3-Flash](gfmodel)"', 'delphi-feasibility')
    );
    withDirs(dirs, () => {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(warned()).toContain('binds "gfmodel"');
      expect(warned()).toContain('pins "dfmodel"');
      expect(fs.existsSync(path.join(dirs.destAgents, 'delphi-feasibility.md'))).toBe(true);
    });
  });

  it('audits deployed agents even when the bundled templates are missing', () => {
    const dirs = tempAgentPair('delphi-architecture.md', null, agentTemplate('model: Qwen3.7-Max', 'delphi-architecture'));
    fs.rmSync(dirs.srcAgents, { recursive: true, force: true });
    withDirs(dirs, () => {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(warned()).toContain('templates not bundled');
      expect(warned()).toContain('delphi-architecture.md');
    });
  });

  it('leaves unrelated user agents alone', () => {
    const dirs = tempAgentPair(
      'delphi-technical.md',
      agentTemplate('model: "[DeepSeek-Flash](dfmodel)"', 'delphi-technical'),
      null
    );
    fs.writeFileSync(path.join(dirs.destAgents, 'my-other-agent.md'), '# no frontmatter at all\n');
    withDirs(dirs, () => {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(warned()).not.toContain('my-other-agent.md');
    });
  });

  it('refuses to deploy a bundled template without a valid model binding', () => {
    const dirs = tempAgentPair('delphi-architecture.md', agentTemplate('model: Qwen3.7-Max', 'delphi-architecture'), null);
    withDirs(dirs, () => {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(fs.existsSync(path.join(dirs.destAgents, 'delphi-architecture.md'))).toBe(false);
      expect(warned()).toContain('no valid model binding');
      expect(warned()).toContain('1 bundled template(s) rejected');
      expect(logged()).not.toContain('no agent templates found');
    });
  });

  it('swallows deployment failures instead of aborting setup half-installed', () => {
    const dirs = tempAgentPair(
      'delphi-technical.md',
      agentTemplate('model: "[DeepSeek-Flash](dfmodel)"', 'delphi-technical'),
      null
    );
    const originalCopy = fs.copyFileSync;
    try {
      fs.copyFileSync = () => { throw 'EPERM: operation not permitted'; };
      const { deployQoderDelphiAgents } = require('../init');
      expect(() => deployQoderDelphiAgents(dirs.srcDir, dirs.targetRoot)).not.toThrow();
      expect(warned()).toContain('deployment failed: EPERM: operation not permitted');
    } finally {
      fs.copyFileSync = originalCopy;
      fs.rmSync(dirs.srcDir, { recursive: true, force: true });
      fs.rmSync(dirs.targetRoot, { recursive: true, force: true });
    }
  });

  it('reports the detected platform when skipping agent deployment', () => {
    fs.rmSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true, force: true });
    const dirs = tempAgentPair('delphi-technical.md', null, null);
    withDirs(dirs, () => {
      const { configureQoderDelphiAgents } = require('../init');
      configureQoderDelphiAgents(dirs.srcDir, dirs.targetRoot);

      expect(logged()).toContain('platform detected:');
      expect(warned()).not.toContain('templates not bundled');
    });
  });
});
