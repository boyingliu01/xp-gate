// vitest globals: true — no import needed
const path = require('path');
const fs = require('fs');
const os = require('os');

// Helper to load the module fresh for each test
function loadModule() {
  // Clear require cache to get fresh module
  const modulePath = path.resolve(__dirname, '..', 'delphi-external-review.cjs');
  delete require.cache[modulePath];
  return require(modulePath);
}

// ── parseArgs ──────────────────────────────────────────────────────────
describe('parseArgs', () => {
  const { parseArgs } = loadModule();

  it('parses required arguments', () => {
    const result = parseArgs([
      '--expert', 'architecture',
      '--input-file', '/tmp/design.md',
      '--round', '1',
      '--config', '/path/to/.delphi-config.json',
    ]);
    expect(result.expert).toBe('architecture');
    expect(result.inputFile).toBe('/tmp/design.md');
    expect(result.round).toBe(1);
    expect(result.config).toBe('/path/to/.delphi-config.json');
    expect(result.mode).toBe('design');
  });

  it('parses optional arguments', () => {
    const result = parseArgs([
      '--expert', 'technical',
      '--input', 'short text',
      '--round', '2',
      '--config', '/path/config.json',
      '--mode', 'code-walkthrough',
      '--profile', 'alternative',
      '--other-experts-file', '/tmp/verdicts.json',
    ]);
    expect(result.expert).toBe('technical');
    expect(result.input).toBe('short text');
    expect(result.round).toBe(2);
    expect(result.mode).toBe('code-walkthrough');
    expect(result.profile).toBe('alternative');
    expect(result.otherExpertsFile).toBe('/tmp/verdicts.json');
  });

  it('exits with error when required args missing', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseArgs(['--expert', 'architecture'])).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('rejects invalid expert role', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseArgs([
      '--expert', 'invalid-role',
      '--input-file', '/tmp/x.md',
      '--round', '1',
      '--config', '/tmp/c.json',
    ])).toThrow('process.exit');
    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('rejects when both --input and --input-file provided', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseArgs([
      '--expert', 'architecture',
      '--input', 'text',
      '--input-file', '/tmp/x.md',
      '--round', '1',
      '--config', '/tmp/c.json',
    ])).toThrow('process.exit');
    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

// ── readConfig ─────────────────────────────────────────────────────────
describe('readConfig', () => {
  const { readConfig } = loadModule();
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads valid config and returns active profile', () => {
    const configPath = path.join(tmpDir, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      profiles: {
        default: {
          providers: {
            deepseek: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-test' },
          },
          experts: {
            architecture: { provider: 'deepseek', model: 'deepseek-chat' },
            technical: { provider: 'deepseek', model: 'deepseek-chat' },
            feasibility: { provider: 'deepseek', model: 'deepseek-chat' },
          },
        },
      },
    }));

    const result = readConfig(configPath);
    expect(result.active_profile).toBe('default');
    expect(result.experts.architecture.provider).toBe('deepseek');
    expect(result.experts.architecture.model).toBe('deepseek-chat');
  });

  it('supports --profile override', () => {
    const configPath = path.join(tmpDir, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      profiles: {
        default: {
          providers: { ds: { base_url: 'https://a.com/v1', api_key: 'k1' } },
          experts: { architecture: { provider: 'ds', model: 'm1' }, technical: { provider: 'ds', model: 'm1' }, feasibility: { provider: 'ds', model: 'm1' } },
        },
        alt: {
          providers: { qs: { base_url: 'https://b.com/v1', api_key: 'k2' } },
          experts: { architecture: { provider: 'qs', model: 'm2' }, technical: { provider: 'qs', model: 'm2' }, feasibility: { provider: 'qs', model: 'm2' } },
        },
      },
    }));

    const result = readConfig(configPath, 'alt');
    expect(result.experts.architecture.provider).toBe('qs');
    expect(result.experts.architecture.model).toBe('m2');
  });

  it('exits with error when config file not found', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => readConfig('/nonexistent/path.json')).toThrow('exit');
    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('exits with error when profile not found', () => {
    const configPath = path.join(tmpDir, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      profiles: { default: { providers: {}, experts: {} } },
    }));

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => readConfig(configPath, 'nonexistent')).toThrow('exit');
    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

// ── validateCrossProvider ──────────────────────────────────────────────
describe('validateCrossProvider', () => {
  const { validateCrossProvider } = loadModule();

  it('passes with 2+ different providers', () => {
    const experts = {
      architecture: { provider: 'deepseek', model: 'm1' },
      technical: { provider: 'zhipu', model: 'm2' },
      feasibility: { provider: 'dashscope', model: 'm3' },
    };
    const providers = {
      deepseek: { base_url: 'https://a.com' },
      zhipu: { base_url: 'https://b.com' },
      dashscope: { base_url: 'https://c.com' },
    };
    const result = validateCrossProvider(experts, providers);
    expect(result.valid).toBe(true);
  });

  it('fails when all experts use same provider', () => {
    const experts = {
      architecture: { provider: 'ds', model: 'm1' },
      technical: { provider: 'ds', model: 'm1' },
      feasibility: { provider: 'ds', model: 'm1' },
    };
    const providers = { ds: { base_url: 'https://a.com' } };
    const result = validateCrossProvider(experts, providers);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('provider');
  });

  it('ignores "local" experts when counting providers', () => {
    const experts = {
      architecture: { provider: 'deepseek', model: 'm1' },
      technical: { provider: 'local' },
      feasibility: { provider: 'zhipu', model: 'm2' },
    };
    const providers = {
      deepseek: { base_url: 'https://a.com' },
      zhipu: { base_url: 'https://b.com' },
    };
    const result = validateCrossProvider(experts, providers);
    expect(result.valid).toBe(true);
  });

  it('passes with only local experts (degraded mode)', () => {
    const experts = {
      architecture: { provider: 'local' },
      technical: { provider: 'local' },
      feasibility: { provider: 'local' },
    };
    const providers = {};
    const result = validateCrossProvider(experts, providers);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeTruthy();
  });
});

// ── extractJsonFromResponse ────────────────────────────────────────────
describe('extractJsonFromResponse', () => {
  const { extractJsonFromResponse } = loadModule();

  it('Layer 1: parses clean JSON', () => {
    const input = '{"verdict":"APPROVED","confidence":9}';
    const result = extractJsonFromResponse(input);
    expect(result.verdict).toBe('APPROVED');
    expect(result.confidence).toBe(9);
  });

  it('Layer 2: strips markdown code block', () => {
    const input = '```json\n{"verdict":"APPROVED","confidence":8}\n```';
    const result = extractJsonFromResponse(input);
    expect(result.verdict).toBe('APPROVED');
  });

  it('Layer 3: extracts JSON from surrounding text', () => {
    const input = 'Here is my review:\n{"verdict":"REQUEST_CHANGES","confidence":7}\nDone.';
    const result = extractJsonFromResponse(input);
    expect(result.verdict).toBe('REQUEST_CHANGES');
  });

  it('Layer 4: returns parse_error when nothing works', () => {
    const input = 'This is just plain text with no JSON at all';
    const result = extractJsonFromResponse(input);
    expect(result.parse_error).toBe(true);
    expect(result.raw_content).toBe(input);
  });

  it('handles nested JSON objects', () => {
    const input = '{"verdict":"APPROVED","consensus_report":{"agreed_items":["a","b"],"consensus_ratio":0.95}}';
    const result = extractJsonFromResponse(input);
    expect(result.consensus_report.consensus_ratio).toBe(0.95);
  });

  it('handles JSON with special characters', () => {
    const input = '{"verdict":"APPROVED","summary":"支持中文和\\"引号\\""}';
    const result = extractJsonFromResponse(input);
    expect(result.verdict).toBe('APPROVED');
  });
});

// ── buildSystemPrompt ──────────────────────────────────────────────────
describe('buildSystemPrompt', () => {
  const { buildSystemPrompt } = loadModule();

  it('returns architecture prompt for architecture role', () => {
    const prompt = buildSystemPrompt('architecture');
    expect(prompt).toContain('架构');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('returns technical prompt for technical role', () => {
    const prompt = buildSystemPrompt('technical');
    expect(prompt).toContain('实现');
  });

  it('returns feasibility prompt for feasibility role', () => {
    const prompt = buildSystemPrompt('feasibility');
    expect(prompt).toContain('可行性');
  });
});

// ── buildUserPrompt ────────────────────────────────────────────────────
describe('buildUserPrompt', () => {
  const { buildUserPrompt } = loadModule();

  it('builds Round 1 prompt without other experts', () => {
    const result = buildUserPrompt('Design content here', null, 1);
    expect(result).toContain('Design content here');
    expect(result).not.toContain('其他专家');
  });

  it('builds Round 2+ prompt with other experts context', () => {
    const otherExperts = JSON.stringify({
      round: 1,
      verdicts: [
        { expert_id: 'B', verdict: 'APPROVED', confidence: 8 },
      ],
    });
    const result = buildUserPrompt('Design content', otherExperts, 2);
    expect(result).toContain('其他专家');
    expect(result).toContain('APPROVED');
    expect(result).toContain('Round 2');
  });
});

// ── resolveInputContent ────────────────────────────────────────────────
describe('resolveInputContent', () => {
  const { resolveInputContent } = loadModule();
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi-input-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads content from --input-file', () => {
    const filePath = path.join(tmpDir, 'design.md');
    fs.writeFileSync(filePath, '# Design Doc\nSome content here');
    const result = resolveInputContent({ inputFile: filePath });
    expect(result).toBe('# Design Doc\nSome content here');
  });

  it('uses --input text directly', () => {
    const result = resolveInputContent({ input: 'Short review text' });
    expect(result).toBe('Short review text');
  });

  it('exits with error when input file not found', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveInputContent({ inputFile: '/nonexistent/file.md' })).toThrow('exit');
    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

// ── resolveLocalFallback ───────────────────────────────────────────────
describe('resolveLocalFallback', () => {
  const { resolveLocalFallback } = loadModule();

  it('returns fallback JSON when provider is "local"', () => {
    const result = resolveLocalFallback('feasibility');
    expect(result.fallback).toBe(true);
    expect(result.expert_role).toBe('feasibility');
    expect(result.reason).toBe('local');
  });
});

// ── checkNodeVersion ───────────────────────────────────────────────────
describe('checkNodeVersion', () => {
  const { checkNodeVersion } = loadModule();

  it('returns true for Node >= 18', () => {
    const major = parseInt(process.versions.node.split('.')[0]);
    if (major >= 18) {
      expect(checkNodeVersion()).toBe(true);
    }
  });
});
