/**
 * @test REQ-652 BUILD 阶段的门禁清单必须从真相源生成，而非手抄
 * @intent #652 的实证是：BUILD 阶段生成代码时，模型对 Boy Scout / CCN / jscpd /
 *         archlint 完全不可知——不是"知道却不遵守"，是**根本不知道规则存在**。
 *         后果是 27% 的门禁失败属于静态规则违规，即唯一 100% 可在生成前规避的类别。
 *
 *         补一页手写的阈值表能解决今天的问题，但会制造明天的问题：`.principlesrc`
 *         里 `long-function` 是 50、`deep-nesting` 是 4，一旦有人调成 60/5，那一页
 *         手抄的表就开始说谎。**一个说谎的自检清单比没有清单更糟**——它会让人按错的
 *         规则写代码，然后在提交时被告知另一套。
 *
 *         所以这个清单必须从配置文件生成。真相源有几个就在几个里读，不复制。
 * @covers AC-652-01, AC-652-02, AC-652-03
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { collectGateRules } = require('../gate-rules');

const REPO = path.join(__dirname, '..', '..', '..', '..');

describe('BUILD 阶段门禁清单 (#652)', () => {
  it('AC-652-01: 从 .principlesrc 读出真实阈值，不是写死的数字', () => {
    const rules = collectGateRules({ cwd: REPO });
    const longFn = rules.find((r) => r.id === 'clean-code.long-function');
    const nesting = rules.find((r) => r.id === 'clean-code.deep-nesting');
    expect(longFn).toBeDefined();
    expect(nesting).toBeDefined();
    // The value must come from the config file. Reading .principlesrc here keeps the
    // test honest: if the config changes and the generator does not follow, this fails.
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, '.principlesrc'), 'utf8'));
    expect(longFn.threshold).toBe(cfg.rules['clean-code']['long-function'].threshold);
    expect(nesting.threshold).toBe(cfg.rules['clean-code']['deep-nesting'].threshold);
  });

  it('AC-652-02: 覆盖会阻断提交的每一类规则，而不只是 principles', () => {
    const rules = collectGateRules({ cwd: REPO });
    const sources = new Set(rules.map((r) => r.source));
    // #652 named exactly these four as absent from BUILD docs.
    for (const required of ['principles', 'ccn', 'jscpd', 'boy-scout']) {
      expect(sources).toContain(required);
    }
  });

  it('AC-652-03: 生成结果可渲染成一份自检清单，含阈值与出处', () => {
    const rules = collectGateRules({ cwd: REPO });
    for (const rule of rules) {
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.source).toBe('string');
      // Without the evidence pointer, "the threshold is 50" cannot be checked or
      // argued with -- it is indistinguishable from a guess.
      expect(typeof rule.evidence).toBe('string');
      expect(rule.evidence).not.toBe('');
      expect(['block', 'warn', 'info']).toContain(rule.severity);
    }
  });
});
