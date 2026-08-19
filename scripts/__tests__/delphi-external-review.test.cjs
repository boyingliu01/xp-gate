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

  function writeConfig(consensus) {
    const configPath = path.join(tmpDir, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      consensus,
      profiles: {
        default: {
          providers: { gateway: { base_url: 'https://example.test/v1', api_key: 'key' } },
          experts: {
            architecture: { provider: 'gateway', model: 'model-a' },
            technical: { provider: 'gateway', model: 'model-b' },
            feasibility: { provider: 'gateway', model: 'model-c' },
          },
        },
      },
    }));
    return readConfig(configPath);
  }

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
      consensus: { cross_provider_required: true },
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
    expect(result.consensus.distinct_models_required).toBe(true);
    expect(result.consensus.threshold_percent).toBe(90);
    expect(result.consensus.max_review_rounds).toBe(5);
    expect(result.consensus.cross_provider_required).toBe(true);
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

  it('normalizes configured model IDs and prevents enforcement bypass', () => {
    const configPath = path.join(tmpDir, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      consensus: { distinct_models_required: false },
      profiles: {
        default: {
          providers: { gateway: { base_url: 'https://example.test/v1', api_key: 'key' } },
          experts: {
            architecture: { provider: 'gateway', model: ' qwen3.7-max ' },
            technical: { provider: 'gateway', model: 'model-b' },
            feasibility: { provider: 'gateway', model: 'model-c' },
          },
        },
      },
    }));

    const result = readConfig(configPath);
    expect(result.experts.architecture.model).toBe('qwen3.7-max');
    expect(result.consensus.distinct_models_required).toBe(true);
    expect(result.warnings).toContain('distinct_models_required_forced');
  });

  it('clamps threshold_percent to the 90 percent minimum', () => {
    const result = writeConfig({ threshold_percent: 1 });
    expect(result.consensus.threshold_percent).toBe(90);
    expect(result.warnings).toContain('threshold_percent_clamped');
  });

  it('preserves threshold_percent above the minimum', () => {
    const result = writeConfig({ threshold_percent: 95 });
    expect(result.consensus.threshold_percent).toBe(95);
    expect(result.warnings).not.toContain('threshold_percent_clamped');
  });

  it('clamps max_review_rounds to five', () => {
    const result = writeConfig({ max_review_rounds: 999 });
    expect(result.consensus.max_review_rounds).toBe(5);
    expect(result.warnings).toContain('max_review_rounds_clamped');
  });

  it('preserves max_review_rounds within the allowed range', () => {
    const result = writeConfig({ max_review_rounds: 3 });
    expect(result.consensus.max_review_rounds).toBe(3);
    expect(result.warnings).not.toContain('max_review_rounds_clamped');
  });

  it('uses safe defaults for invalid consensus bounds', () => {
    const result = writeConfig({ threshold_percent: 'high', max_review_rounds: 0 });
    expect(result.consensus.threshold_percent).toBe(90);
    expect(result.consensus.max_review_rounds).toBe(1);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'threshold_percent_clamped',
      'max_review_rounds_clamped',
    ]));
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

// ── validateDistinctModels ─────────────────────────────────────────────
describe('validateDistinctModels', () => {
  const { validateDistinctModels } = loadModule();

  it('passes when one provider serves three distinct models', () => {
    const experts = {
      architecture: { provider: 'bailian-tp', model: 'qwen3.7-max' },
      technical: { provider: 'bailian-tp', model: 'deepseek-v4-pro' },
      feasibility: { provider: 'bailian-tp', model: 'glm-5.2' },
    };
    expect(validateDistinctModels(experts, {})).toEqual({ valid: true });
  });

  it('fails when different providers use the same model', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'qwen-provider', model: 'shared-model' },
      technical: { provider: 'deepseek-provider', model: ' shared-model ' },
      feasibility: { provider: 'glm-provider', model: 'other-model' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('duplicate');
    expect(result.reason).not.toContain('API key');
  });

  it('fails when a role has a missing model', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'p', model: 'm1' },
      technical: { provider: 'p' },
      feasibility: { provider: 'p', model: 'm3' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('technical');
  });

  it('fails when a model is blank after trimming', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'p', model: 'm1' },
      technical: { provider: 'p', model: '   ' },
      feasibility: { provider: 'p', model: 'm3' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('technical');
  });

  it('rejects local fallback labels because they do not execute models', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'local', model: 'local-a' },
      technical: { provider: 'local', model: 'local-b' },
      feasibility: { provider: 'local', model: 'local-c' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/architecture|callable provider/i);
  });

  it('does not restore provider blocking when the legacy option is present', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'same-provider', model: 'model-a' },
      technical: { provider: 'same-provider', model: 'model-b' },
      feasibility: { provider: 'same-provider', model: 'model-c' },
    }, {}, { cross_provider_required: true });
    expect(result.valid).toBe(true);
    expect(result.warning).toMatch(/cross_provider_required/i);
    expect(result.warning).toMatch(/deprecated/i);
    expect(result.warning).toMatch(/ignored/i);
  });

  it('requires all three expert roles', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'p', model: 'm1' },
      technical: { provider: 'p', model: 'm2' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('feasibility');
  });

  it('rejects a non-enumerable required expert role', () => {
    const experts = {
      technical: { provider: 'p', model: 'm2' },
      feasibility: { provider: 'p', model: 'm3' },
    };
    Object.defineProperty(experts, 'architecture', {
      value: { provider: 'p', model: 'm1' },
      enumerable: false,
    });

    const result = validateDistinctModels(experts, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/architecture|enumerable/i);
  });

  it('rejects unsupported extra expert roles', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'p', model: 'm1' },
      technical: { provider: 'p', model: 'm2' },
      feasibility: { provider: 'p', model: 'm3' },
      security: { provider: 'p', model: 'm4' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unsupported|extra/i);
    expect(result.reason).toContain('security');
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

// ── Provider calls and provenance ──────────────────────────────────────
describe('provider calls and provenance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the normalized configured model and preserves provider resolution', async () => {
    const { callModelAPI } = loadModule();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'qwen3.7-max-actual',
        choices: [{ message: { content: '{"verdict":"APPROVED"}' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callModelAPI(
      { base_url: 'https://example.test/v1', api_key: 'key' },
      'qwen3.7-max',
      'system',
      'user',
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe('qwen3.7-max');
    expect(result.content).toBe('{"verdict":"APPROVED"}');
    expect(result.resolved_model).toBe('qwen3.7-max-actual');
  });

  it('does not expose non-success provider bodies', async () => {
    const { callModelAPI } = loadModule();
    const text = vi.fn().mockResolvedValue('SECRET_TOKEN');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text,
    }));

    const result = await callModelAPI(
      { base_url: 'https://example.test/v1', api_key: 'key' },
      'model-a',
      'system',
      'user',
    );

    expect(result.message).toContain('400');
    expect(result.message).not.toContain('SECRET_TOKEN');
    expect(text).not.toHaveBeenCalled();
  });

  it('records null when the provider omits resolved model identity', async () => {
    const { callModelAPI } = loadModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"verdict":"APPROVED"}' } }] }),
    }));

    const result = await callModelAPI(
      { base_url: 'https://example.test/v1', api_key: 'key' },
      'requested-alias',
      'system',
      'user',
    );

    expect(result.resolved_model).toBeNull();
  });

  it('builds separate requested and resolved model provenance', () => {
    const { buildReviewOutput } = loadModule();
    const result = buildReviewOutput(
      { verdict: 'APPROVED' },
      { expert: 'architecture', round: 1, mode: 'design' },
      { provider: 'gateway', requested_model: 'qwen3.7-max', resolved_model: 'qwen3.7-max-actual' },
    );

    expect(result.requested_model).toBe('qwen3.7-max');
    expect(result.resolved_model).toBe('qwen3.7-max-actual');
    expect(result.result_type).toBe('delphi_expert_result');
    expect(result.expert_role).toBe('architecture');
    expect(result.verdict).toBe('APPROVED');
    expect(result).not.toHaveProperty('consensus');
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
