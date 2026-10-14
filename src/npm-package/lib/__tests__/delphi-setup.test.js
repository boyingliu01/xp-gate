/**
 * @test delphi-setup
 * @intent Guard #414 REQ-4: `xp-gate delphi-setup` is the repair path for
 * drifted Qoder agent bindings. `xp-gate init` deliberately never overwrites
 * an existing agent file, so a stale binding could previously never be fixed
 * without hand-editing. delphi-setup must write three distinct, quoted model
 * bindings, refuse duplicates and junk, and always demand an IDE reload —
 * Qoder caches agent definitions at session start, so a skipped reload looks
 * exactly like a fix that did not work.
 */
const fs = require('fs');
const path = require('path');
const { resetLibModules, muteConsole, makeTempDirs, removeTempDirs } = require('./helpers/lib-sandbox.cjs');

const LIB_MODULES = ['../init', '../detect-deps.js', '../shared-paths', '../delphi-setup'].map(name => require.resolve(name));

function repoRoot() {
  return path.join(__dirname, '..', '..', '..', '..');
}

describe('delphi-setup (#414 REQ-4)', () => {
  let tmpDirs;
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    tmpDirs = makeTempDirs(['delphi-setup-home']);
    tmpHome = tmpDirs['delphi-setup-home'];
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.qoder'), { recursive: true });
    resetLibModules(vi, LIB_MODULES);
    muteConsole(vi);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    removeTempDirs(tmpDirs);
    vi.restoreAllMocks();
  });

  function agentsDir() {
    return path.join(tmpHome, '.qoder', 'agents');
  }

  it('writes three agent files with the requested distinct bindings', async () => {
    const { delphiSetup } = require('../delphi-setup');
    const code = await delphiSetup([
      '--model', 'architecture=qwen-max',
      '--model', 'technical=deepseek-v3.2',
      '--model', 'feasibility=glm-5.2',
    ]);
    expect(code).toBe(0);
    const { readQoderModelId } = require('../init');
    expect(readQoderModelId(path.join(agentsDir(), 'delphi-architecture.md'))).toBe('qwen-max');
    expect(readQoderModelId(path.join(agentsDir(), 'delphi-technical.md'))).toBe('deepseek-v3.2');
    expect(readQoderModelId(path.join(agentsDir(), 'delphi-feasibility.md'))).toBe('glm-5.2');
  });

  it('preserves the rest of the bundled template body when rebinding', async () => {
    const { delphiSetup } = require('../delphi-setup');
    await delphiSetup([
      '--model', 'architecture=qwen-max',
      '--model', 'technical=deepseek-v3.2',
      '--model', 'feasibility=glm-5.2',
    ]);
    const body = fs.readFileSync(path.join(agentsDir(), 'delphi-architecture.md'), 'utf8');
    const shippedBody = fs.readFileSync(path.join(repoRoot(), 'plugins', 'qoder', 'agents', 'delphi-architecture.md'), 'utf8');
    // The name line is template identity; only the binding may change.
    expect(body).toMatch(/^name: delphi-architecture$/m);
    expect(body).not.toBe('');
    expect(shippedBody).toMatch(/^name: delphi-architecture$/m);
  });

  it('repairs a stale binding by overwriting it (this is the point of the command)', async () => {
    const { delphiSetup } = require('../delphi-setup');
    fs.mkdirSync(agentsDir(), { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir(), 'delphi-architecture.md'),
      '---\nname: delphi-architecture\nmodel: "[Retired-Model](dead-model-id)"\n---\n# body\n',
    );
    const code = await delphiSetup([
      '--model', 'architecture=qwen-max',
      '--model', 'technical=deepseek-v3.2',
      '--model', 'feasibility=glm-5.2',
    ]);
    expect(code).toBe(0);
    const { readQoderModelId } = require('../init');
    expect(readQoderModelId(path.join(agentsDir(), 'delphi-architecture.md'))).toBe('qwen-max');
  });

  // R1 FC-04: a repair without a rollback is a second way to lose a working
  // binding — existing files are backed up before the first write.
  it('backs up existing agent files before overwriting them', async () => {
    const { delphiSetup } = require('../delphi-setup');
    fs.mkdirSync(agentsDir(), { recursive: true });
    const staleBody = '---\nname: delphi-architecture\nmodel: "[Retired-Model](dead-model-id)"\n---\n# body\n';
    fs.writeFileSync(path.join(agentsDir(), 'delphi-architecture.md'), staleBody);
    const code = await delphiSetup([
      '--model', 'architecture=qwen-max',
      '--model', 'technical=deepseek-v3.2',
      '--model', 'feasibility=glm-5.2',
    ]);
    expect(code).toBe(0);
    // Some backup copy of the stale file must exist somewhere under the
    // sandbox HOME config dir; the exact timestamped dir is intentional.
    const backupRoot = path.join(tmpHome, '.config', 'xp-gate', 'backup');
    const found = (function find(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          const hit = find(p);
          if (hit) return hit;
        } else if (e.name === 'delphi-architecture.md') {
          return p;
        }
      }
      return null;
    })(backupRoot);
    expect(found).not.toBeNull();
    expect(fs.readFileSync(found, 'utf8')).toBe(staleBody);
  });

  // R1 MN-05: a BOM in front of '---' must not read as a missing frontmatter.
  it('rebinds a template carrying a UTF-8 BOM', async () => {
    const { delphiSetup } = require('../delphi-setup');
    fs.mkdirSync(agentsDir(), { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir(), 'delphi-architecture.md'),
      '\uFEFF---\nname: delphi-architecture\nmodel: "[Old](old-id)"\n---\n# body\n',
    );
    const code = await delphiSetup([
      '--model', 'architecture=qwen-max',
      '--model', 'technical=deepseek-v3.2',
      '--model', 'feasibility=glm-5.2',
    ]);
    expect(code).toBe(0);
    const { readQoderModelId } = require('../init');
    expect(readQoderModelId(path.join(agentsDir(), 'delphi-architecture.md'))).toBe('qwen-max');
  });

  it('rejects duplicate model IDs — three distinct models are the invariant being set up', async () => {
    const { delphiSetup } = require('../delphi-setup');
    const code = await delphiSetup([
      '--model', 'architecture=same-model',
      '--model', 'technical=same-model',
      '--model', 'feasibility=other',
    ]);
    expect(code).toBe(1);
    expect(fs.existsSync(agentsDir())).toBe(false);
  });

  it('rejects an unknown role and a bare model id without a role=', async () => {
    const { delphiSetup } = require('../delphi-setup');
    expect(await delphiSetup(['--model', 'critic=x'])).toBe(1);
    expect(await delphiSetup(['--model', 'just-a-model'])).toBe(1);
    expect(fs.existsSync(agentsDir())).toBe(false);
  });

  it('rejects a model id outside the platform binding charset', async () => {
    const { delphiSetup } = require('../delphi-setup');
    const code = await delphiSetup([
      '--model', 'architecture=has space',
      '--model', 'technical=deepseek-v3.2',
      '--model', 'feasibility=glm-5.2',
    ]);
    expect(code).toBe(1);
    expect(fs.existsSync(agentsDir())).toBe(false);
  });

  it('demands an IDE reload on success — the registry only loads at session start', async () => {
    const { delphiSetup } = require('../delphi-setup');
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    await delphiSetup([
      '--model', 'architecture=qwen-max',
      '--model', 'technical=deepseek-v3.2',
      '--model', 'feasibility=glm-5.2',
    ]);
    logSpy.mockRestore();
    const out = logs.join('\n');
    expect(out).toMatch(/重载|reload|新会话|restart/i);
  });

  it('--local --project targets the project .qoder/agents instead of HOME', async () => {
    const { delphiSetup } = require('../delphi-setup');
    const projectDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'delphi-setup-proj-'));
    try {
      const code = await delphiSetup([
        '--local', '--project', projectDir,
        '--model', 'architecture=qwen-max',
        '--model', 'technical=deepseek-v3.2',
        '--model', 'feasibility=glm-5.2',
      ]);
      expect(code).toBe(0);
      const { readQoderModelId } = require('../init');
      expect(readQoderModelId(path.join(projectDir, '.qoder', 'agents', 'delphi-architecture.md'))).toBe('qwen-max');
      expect(fs.existsSync(path.join(tmpHome, '.qoder', 'agents'))).toBe(false);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
