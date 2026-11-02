// vitest globals: true — no import needed
/**
 * @test REQ-705, REQ-707
 * @intent 两个缺陷都源自同一种「诊断信息在错误的位置」：
 *
 *   #705 —— 5xx 分支把 provider 的结构化错误体整段丢弃，席位只得到一句
 *           「Server error (500).」。同一个函数里 429 分支已经把 body 用得很好
 *           （区分 category_quota / cost_quota），5xx 却什么都不读。运维无法判断
 *           是网关抖动、上游超时，还是内容触发了处理失败——三者处置完全不同。
 *           实测于 whalecloud 网关：`new ProcessBuilder(args).start()` 这类内容
 *           会让网关在响应处理阶段返 500，body 里写着
 *           `type: response_processing_error` / `param: non_stream_chat_response`。
 *           这类失败重试必然同样失败（内容不变），却仍被标成 retryable。
 *
 *   #707 —— `${VAR}` 展开只挂在 api_key 上，base_url 不在展开范围。把 base_url
 *           写成占位符（「密钥不入库」最自然的直觉做法）不会在校验阶段报错，
 *           因为占位符是合法的非空字符串；它被当成字面 URL 发出去，在**网络层**
 *           失败，报「连接失败」，配置看起来完全正常。
 *
 * 两个测试都钉住「失败时我们能看到原因」，而不只是「失败被报告了」。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

function loadModule() {
  const modulePath = path.resolve(__dirname, '..', 'delphi-external-review.cjs');
  delete require.cache[modulePath];
  return require(modulePath);
}

function writeConfig(dir, providers) {
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({
    active_profile: 'default',
    profiles: {
      default: {
        providers,
        experts: {
          architecture: { provider: Object.keys(providers)[0], model: 'm1' },
          technical: { provider: Object.keys(providers)[0], model: 'm2' },
          feasibility: { provider: Object.keys(providers)[0], model: 'm3' },
        },
      },
    },
  }, null, 2));
  return p;
}

// ── #707: base_url 的 ${VAR} 展开 ───────────────────────────────────────
describe('#707: base_url env placeholder expansion', () => {
  let dir;
  let exitSpy;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi-707-'));
    // 配置错误路径用 process.exit(1) 报错；测试里 replace 成抛异常才可断言。
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
  });
  afterEach(() => {
    exitSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.GATEWAY_BASE_FOR_TEST;
    delete process.env.NOPE_GATEWAY_VAR;
    delete process.env.ALSO_NOPE;
  });

  it('expands ${VAR} in base_url from the environment', () => {
    const { readConfig } = loadModule();
    process.env.GATEWAY_BASE_FOR_TEST = 'https://gateway.test/v1';
    const cfg = writeConfig(dir, {
      gw: { base_url: '${GATEWAY_BASE_FOR_TEST}', api_key: 'literal-key' },
    });

    const result = readConfig(cfg, null);
    expect(result.providers.gw.base_url).toBe('https://gateway.test/v1');
  });

  it('fails at config-load time when the base_url variable is unset', () => {
    // 这是 #707 的核心：占位符没展开必须在**校验层**报错并点名变量，
    // 而不是让字面量流到网络层、在那里以「连接失败」的形式失败。
    const { readConfig } = loadModule();
    delete process.env.NOPE_GATEWAY_VAR;
    const cfg = writeConfig(dir, {
      gw: { base_url: '${NOPE_GATEWAY_VAR}', api_key: 'literal-key' },
    });

    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => readConfig(cfg, null)).toThrow('process.exit');
      // 错误信息必须点名变量名，否则用户不知道该 export 什么。
      expect(errLog.mock.calls.flat().join(' ')).toContain('NOPE_GATEWAY_VAR');
    } finally {
      errLog.mockRestore();
    }
  });

  it('does not silently fall back to the literal placeholder', () => {
    // 退回字面量正是本 bug 的成因：配置看起来正常，URL 却不是一个 URL。
    const { readConfig } = loadModule();
    delete process.env.ALSO_NOPE;
    const cfg = writeConfig(dir, {
      gw: { base_url: '${ALSO_NOPE}', api_key: 'literal-key' },
    });

    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => readConfig(cfg, null)).toThrow('process.exit');
    } finally {
      errLog.mockRestore();
    }
  });

  it('leaves a literal base_url untouched', () => {
    // 反向守护：不能把正常配置当占位符处理。
    const { readConfig } = loadModule();
    const cfg = writeConfig(dir, {
      gw: { base_url: 'https://literal.example/v1', api_key: 'literal-key' },
    });

    const result = readConfig(cfg, null);
    expect(result.providers.gw.base_url).toBe('https://literal.example/v1');
  });
});

// ── #705: 5xx 分支保留 provider 错误体 ──────────────────────────────────
describe('#705: 5xx provider error body is not discarded', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces error.type and error.param from a 5xx body', async () => {
    const { callModelAPI } = loadModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: {
          message: 'Non-stream response processing failed: ',
          type: 'response_processing_error',
          param: 'non_stream_chat_response',
          code: '500',
        },
      }),
    }));

    const result = await callModelAPI(
      { base_url: 'https://example.test/v1', api_key: 'key' },
      'g-qwen3.8-flash', 'system', 'user',
    );

    expect(result.error).toBe(true);
    // 这两个字段就是诊断的全部价值：它们区分「网关抖动」与「内容触发了处理失败」。
    expect(result.message).toContain('response_processing_error');
    expect(result.message).toContain('non_stream_chat_response');
  });

  it('marks a response_processing_error as non-retryable', async () => {
    // 内容相关失败重试必然同样失败。标成 retryable 只会白白烧掉重试预算。
    const { callModelAPI } = loadModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: { type: 'response_processing_error', param: 'non_stream_chat_response' },
      }),
    }));

    const result = await callModelAPI(
      { base_url: 'https://example.test/v1', api_key: 'key' },
      'g-qwen3.8-flash', 'system', 'user',
    );

    expect(result.retryable).toBe(false);
  });

  it('keeps the old behaviour when the 5xx body is not parseable', async () => {
    // 读 body 失败不得改变原有判定：仍是 5xx，仍可重试。
    const { callModelAPI } = loadModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new Error('not json'); },
    }));

    const result = await callModelAPI(
      { base_url: 'https://example.test/v1', api_key: 'key' },
      'model-a', 'system', 'user',
    );

    expect(result.error).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.message).toContain('503');
  });

  it('a genuine transient 5xx (no structured body) stays retryable', async () => {
    const { callModelAPI } = loadModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));

    const result = await callModelAPI(
      { base_url: 'https://example.test/v1', api_key: 'key' },
      'model-a', 'system', 'user',
    );

    expect(result.retryable).toBe(true);
  });
});
