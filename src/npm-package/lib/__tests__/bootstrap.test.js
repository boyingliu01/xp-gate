const { bootstrap } = require('../bootstrap.js');

describe('bootstrap', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 when --dry-run given with no missing tools', () => {
    vi.mock('../detect-deps.js', () => ({
      GATE_CLI_TOOLS: [],
      checkCliTool: () => ({ available: true }),
      getToolInstallCmd: () => 'echo done',
    }));

    const { bootstrap } = require('../bootstrap.js');
    const code = bootstrap(['--dry-run']);
    expect(code).toBe(0);
    vi.restoreAllMocks();
  });

  it('returns 0 when all CLI tools are available', () => {
    vi.mock('../detect-deps.js', () => ({
      GATE_CLI_TOOLS: [{ tool: 'testtool', gates: ['Gate 1'], install: { linux: 'echo ok' } }],
      checkCliTool: () => ({ available: true, version: '1.0' }),
      getToolInstallCmd: () => 'echo ok',
    }));

    const { bootstrap } = require('../bootstrap.js');
    const code = bootstrap([]);
    expect(code).toBe(0);
    vi.restoreAllMocks();
  });

  it('accepts --lang ts parameter', () => {
    vi.mock('../detect-deps.js', () => ({
      GATE_CLI_TOOLS: [],
      checkCliTool: () => ({ available: true }),
      getToolInstallCmd: () => 'echo done',
    }));

    const { bootstrap } = require('../bootstrap.js');
    const code = bootstrap(['--lang', 'ts']);
    expect(code).toBe(0);
    vi.restoreAllMocks();
  });

  it('accepts --lang ts,py parameter', () => {
    vi.mock('../detect-deps.js', () => ({
      GATE_CLI_TOOLS: [],
      checkCliTool: () => ({ available: true }),
      getToolInstallCmd: () => 'echo done',
    }));

    const { bootstrap } = require('../bootstrap.js');
    const code = bootstrap(['--lang', 'ts,py']);
    expect(code).toBe(0);
    vi.restoreAllMocks();
  });

  it('recognizes --verbose flag without error', () => {
    vi.mock('../detect-deps.js', () => ({
      GATE_CLI_TOOLS: [],
      checkCliTool: () => ({ available: true }),
      getToolInstallCmd: () => 'echo done',
    }));

    const { bootstrap } = require('../bootstrap.js');
    const code = bootstrap(['--verbose']);
    expect(code).toBe(0);
    vi.restoreAllMocks();
  });
});
