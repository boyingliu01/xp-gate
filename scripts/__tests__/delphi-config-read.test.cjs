/**
 * @test REQ-DELPHI-CONFIG-READ
 * @intent 读取 Delphi 配置有三条**错了不会报错**的约定：
 *
 *         1. **`model` 必须 trim**。配置里带个尾随换行会让网关收到一个它不认识的
 *            模型 id，而错误信息里显示的值**看起来是对的**——这是最难查的一类。
 *         2. **consensus 阈值有 90 下限，是策略不是默认值**。配置可以抬高，不能降低；
 *            降低之后"共识"就不再是共识。被 clamp 的事实要记录成 warning。
 *         3. **关闭 `distinct_models_required` 会被记录而非遵守**。三个名字解析到
 *            同一个模型，评审的匿名性只是表面上的。
 *
 * @covers AC-DELPHI-CONFIG-01
 * @covers AC-DELPHI-CONFIG-02
 * @covers AC-DELPHI-CONFIG-03
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { mkdtempSync: mkdtemp, writeFileSync: writeFile, rmSync: rm } = await import('node:fs');
const { tmpdir: osTmpdir } = await import('node:os');
const { join: joinPath } = await import('node:path');
const { readConfig } = await import('../delphi-config-read.cjs');

let dir;

beforeEach(() => {
  dir = mkdtemp(joinPath(osTmpdir(), 'delphi-config-'));
});

afterEach(() => {
  rm(dir, { recursive: true, force: true });
});

/**
 * Write a config document and return its path.
 *
 * The write is wrapped so a fixture problem names itself instead of surfacing as a
 * confusing assertion failure three lines later.
 */
function configFile(doc) {
  const file = joinPath(dir, '.delphi-config.json');
  try {
    writeFile(file, JSON.stringify(doc));
  } catch (error) {
    throw new Error(`could not write the test config: ${String(error)}`);
  }
  return file;
}

/** A minimal config that passes the provider and expert checks. */
function baseConfig(overrides = {}) {
  return {
    active_profile: 'default',
    profiles: {
      default: {
        providers: {
          gw: { base_url: 'https://gw.example/v1', api_key: 'k' },
        },
        experts: {
          architecture: { provider: 'gw', model: 'model-a' },
          technical: { provider: 'gw', model: 'model-b' },
          feasibility: { provider: 'gw', model: 'model-c' },
        },
      },
    },
    ...overrides,
  };
}

describe('readConfig', () => {
  it('trims whitespace from every expert model', () => {
    // A trailing newline in `model` sends an id the gateway does not know, and the
    // error names a value that LOOKS right -- the worst kind to debug.
    const doc = baseConfig();
    doc.profiles.default.experts.architecture.model = '  model-a\n';
    const config = readConfig(configFile(doc), undefined);
    expect(config.experts.architecture.model).toBe('model-a');
  });

  it('records a distinct-models opt-out instead of obeying it', () => {
    // Three names resolving to one model makes the review anonymous only in
    // appearance, so the request is overruled and reported.
    const config = readConfig(configFile(baseConfig({ consensus: { distinct_models_required: false } })), undefined);
    expect(config.consensus.distinct_models_required).toBe(true);
    expect(config.warnings).toContain('distinct_models_required_forced');
  });

  it('raises a consensus threshold above the 90 floor', () => {
    const config = readConfig(configFile(baseConfig({ consensus: { threshold_percent: 95 } })), undefined);
    expect(config.consensus.threshold_percent).toBe(95);
    expect(config.warnings).not.toContain('threshold_percent_clamped');
  });

  it('clamps a threshold below 90 and says it did', () => {
    // The floor is POLICY: a config may raise the bar, never lower it -- a lower bar
    // stops calling the result a consensus. The warning is what makes that visible.
    const config = readConfig(configFile(baseConfig({ consensus: { threshold_percent: 60 } })), undefined);
    expect(config.consensus.threshold_percent).toBe(90);
    expect(config.warnings).toContain('threshold_percent_clamped');
  });

  it('clamps the review rounds into 1..5', () => {
    const high = readConfig(configFile(baseConfig({ consensus: { max_review_rounds: 99 } })), undefined);
    expect(high.consensus.max_review_rounds).toBe(5);
    expect(high.warnings).toContain('max_review_rounds_clamped');

    const low = readConfig(configFile(baseConfig({ consensus: { max_review_rounds: 0 } })), undefined);
    expect(low.consensus.max_review_rounds).toBe(1);
  });
});
