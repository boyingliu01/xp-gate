/**
 * @test REQ-TOOLS-ARCH
 * @intent `getArchitectureTools()` 让 doctor 展示"每种语言有哪些架构检查工具"。
 *         它按 Gate 4 的 Architecture 标签筛选，而不是另立一份清单——这个选择
 *         值得一条测试守住：另立清单就意味着"注册了工具，却在 doctor 里看不见"。
 *
 *         该函数此前零覆盖（language-tools.js 的 72 条未覆盖语句全在这里）。
 *
 * @covers AC-TOOLS-ARCH-01
 */
'use strict';

const {
  getArchitectureTools,
  LANGUAGE_REGISTRY,
} = require('../language-tools.js');

describe('getArchitectureTools', () => {
  it('returns an object keyed by language', () => {
    const result = getArchitectureTools();
    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const value of Object.values(result)) {
      expect(Array.isArray(value)).toBe(true);
    }
  });

  it('lists only tools whose gates mention Architecture', () => {
    const result = getArchitectureTools();
    for (const [lang, tools] of Object.entries(result)) {
      for (const tool of tools) {
        expect(
          tool.gates.some((gate) => gate.includes('Architecture')),
          `${lang}/${tool.name} should declare an Architecture gate`,
        ).toBe(true);
      }
    }
  });

  it('omits languages that declare no architecture tool', () => {
    const result = getArchitectureTools();
    for (const [lang, langDef] of Object.entries(LANGUAGE_REGISTRY)) {
      const hasArch = langDef.tools.some((tool) =>
        tool.gates.some((gate) => gate.includes('Architecture')),
      );
      expect(lang in result, `${lang} inclusion should follow its tools`).toBe(hasArch);
    }
  });

  it('derives from the registry rather than a parallel list', () => {
    // The invariant that makes this function worth having: every architecture
    // tool the registry knows about appears here, and nothing else does.
    const fromRegistry = [];
    for (const langDef of Object.values(LANGUAGE_REGISTRY)) {
      for (const tool of langDef.tools) {
        if (tool.gates.some((gate) => gate.includes('Architecture'))) fromRegistry.push(tool);
      }
    }
    const fromFunction = Object.values(getArchitectureTools()).flat();
    expect(fromFunction).toHaveLength(fromRegistry.length);
  });
});
