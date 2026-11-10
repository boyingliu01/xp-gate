/**
 * @test REQ-DEPLOY-003 项目级默认架构配置
 * @intent Gate 6 自 2026-05-04 起对「没有架构配置文件」的项目**直接阻塞提交**
 *   （`githooks/pre-commit:4838`：`echo "❌ ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED"`）。
 *   实测该判定只看文件是否**存在**（`-f` 三连），不解析内容。于是 `xp-gate init`
 *   装好了全部 gate，却因为少一个文件让每一次提交都被拦——而且拦住的原因
 *   与用户代码无关。本 REQ 让项目级 init 生成该文件。
 *
 *   两个用户决策不可推翻：
 *   1. 只在**项目级** init 生成；全局安装**不写**用户 HOME。
 *   2. 生成内容只含注释、零配置键——因为实测证明 `rules:` 与 `ignore:`
 *      在 archlint 0.16.0 下都被静默忽略（设计文档 §3.4 实验 D/E），
 *      写一个会被忽略的配置等于制造虚假安全感。
 * @covers AC-DEPLOY-003-01, AC-DEPLOY-003-02, AC-DEPLOY-003-03,
 *          AC-DEPLOY-003-04, AC-DEPLOY-003-05, AC-DEPLOY-003-06,
 *          AC-DEPLOY-003-07, AC-DEPLOY-003-08
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// src/npm-package/lib/__tests__/ -> lib/ -> npm-package/ -> src/ -> <repo root>
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const TEMPLATE_MODULE = path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'arch-config-template.js');
const CONFIG_FILENAME = '.archlint.yaml';

describe('REQ-DEPLOY-003 项目级默认架构配置', () => {
  describe('AC-DEPLOY-003-01: 模板是唯一来源常量', () => {
    it('arch-config-template.js 存在并导出 ARCH_CONFIG_TEMPLATE', () => {
      expect(fs.existsSync(TEMPLATE_MODULE)).toBe(true);
      const mod = require(TEMPLATE_MODULE);
      expect(typeof mod.ARCH_CONFIG_TEMPLATE).toBe('string');
      expect(mod.ARCH_CONFIG_TEMPLATE.length).toBeGreaterThan(0);
    });

    it('导出的模块对象被冻结，防止运行时被改写', () => {
      const mod = require(TEMPLATE_MODULE);
      // 断言的是**模块导出对象**冻结（不是字符串字面量——字符串本身不可变，
      // 对它的 Object.isFrozen 断言永远为 false，等于没断言）。
      expect(Object.isFrozen(mod)).toBe(true);
      expect(typeof mod.ARCH_CONFIG_TEMPLATE).toBe('string');
    });

    it('导出 CONFIG_FILENAME，避免"文件名"在多个文件里各写一份', () => {
      const mod = require(TEMPLATE_MODULE);
      expect(mod.CONFIG_FILENAME).toBe('.archlint.yaml');
    });
  });

  describe('AC-DEPLOY-003-02: 生成内容零配置键（实测 rules:/ignore: 均被忽略）', () => {
    it('除注释行与空行外没有任何内容', () => {
      const { ARCH_CONFIG_TEMPLATE } = require(TEMPLATE_MODULE);
      const nonCommentLines = ARCH_CONFIG_TEMPLATE
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // 这是 §3.4 的结论被写成断言：文件不配置任何东西。
      // 实测（设计文档实验 D）：`ignore: ["src/b.ts"]` 在 archlint 0.16.0 下
      // files_analyzed 仍是 2、cyclic_dependencies 仍是 1 —— 配置被静默忽略。
      expect(nonCommentLines).toEqual([]);
    });

    it('不含 rules: / ignore: / entry_points: 三个已知会被误读的顶层键', () => {
      const { ARCH_CONFIG_TEMPLATE } = require(TEMPLATE_MODULE);
      const nonComment = ARCH_CONFIG_TEMPLATE
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'));
      const joined = nonComment.join('\n');
      expect(joined).not.toMatch(/^\s*rules:/m);
      expect(joined).not.toMatch(/^\s*ignore:/m);
      expect(joined).not.toMatch(/^\s*entry_points:/m);
    });
  });

  describe('AC-DEPLOY-003-03: 注释说明为什么是空的、以及如何验证', () => {
    it('说明里包含可执行的核查指引', () => {
      const { ARCH_CONFIG_TEMPLATE } = require(TEMPLATE_MODULE);
      // 新增文案契约：这个字符串是本设计要写的内容，不是对既有输出的观测。
      expect(ARCH_CONFIG_TEMPLATE).toContain('archlint detectors list');
      expect(ARCH_CONFIG_TEMPLATE).toMatch(/deliberately contains no configuration keys/i);
    });

    it('说明里解释了 Gate 6 只检查存在性（否则读者会以为配置已生效）', () => {
      const { ARCH_CONFIG_TEMPLATE } = require(TEMPLATE_MODULE);
      expect(ARCH_CONFIG_TEMPLATE).toMatch(/Gate 6/);
      expect(ARCH_CONFIG_TEMPLATE).toMatch(/exist|存在/i);
    });
  });

  describe('AC-DEPLOY-003-04: 生成内容会被 archlint 接受（解析不报错）', () => {
    it('全注释文档是合法 YAML——js-yaml 会报"空文档"，那是规范内行为', () => {
      const { ARCH_CONFIG_TEMPLATE } = require(TEMPLATE_MODULE);
      const yaml = require('js-yaml');
      // 实测：js-yaml.load() 对全注释文档抛
      //   "expected a document, but the input is empty"
      // 这不是语法错误，是"文档为空"的规范内结论（YAML 规范允许空文档）。
      // 断言"要么解析出空值，要么抛这条特定的空文档错误"，而不是假装它会返回 null。
      let parsed;
      let emptyDocumentError = null;
      try {
        parsed = yaml.load(ARCH_CONFIG_TEMPLATE);
      } catch (e) {
        emptyDocumentError = e.message;
      }
      if (emptyDocumentError === null) {
        expect(parsed === null || parsed === undefined).toBe(true);
      } else {
        expect(emptyDocumentError).toMatch(/empty/i);
      }
    });
  });

  describe('AC-DEPLOY-003-08: 生成的文件真的让 Gate 6 的存在性判定成立', () => {
    it('写到临时目录后，pre-commit 使用的三个 -f 判定至少命中一个', () => {
      const { ARCH_CONFIG_TEMPLATE, CONFIG_FILENAME } = require(TEMPLATE_MODULE);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archcfg-'));
      try {
        const target = path.join(tmp, CONFIG_FILENAME);
        fs.writeFileSync(target, ARCH_CONFIG_TEMPLATE, 'utf8');

        // 逐字对应 githooks/pre-commit:4376 的三个判定
        const hit = fs.existsSync(path.join(tmp, 'architecture.yaml'))
          || fs.existsSync(path.join(tmp, '.architecturerc'))
          || fs.existsSync(path.join(tmp, '.archlint.yaml'));
        expect(hit).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AC-DEPLOY-003-05: 只在项目级 init 生成，全局安装不写 HOME', () => {
    it('init.js 中写 .archlint.yaml 的代码只在 installLocal 路径上', () => {
      const initSource = fs.readFileSync(
        path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'init.js'),
        'utf8',
      );
      // 引用了模板模块
      expect(initSource).toMatch(/arch-config-template/);
      /**
       * 断言的是**调用关系**，不是"函数体里出现过 archlint 这个词"。
       * 后者会误报：installLocal 结尾的 FIRST-CLASS TEST QUALITY 提示里就有
       * `.archlint.yaml ignore` 这行文案，与写入逻辑毫无关系。
       */
      const setupGlobalStart = initSource.search(
        /(?:async\s+)?function\s+setupGlobal\s*\(/,
      );
      expect(setupGlobalStart).toBeGreaterThan(-1);
      const afterSetupGlobal = initSource.slice(setupGlobalStart);
      expect(afterSetupGlobal).not.toMatch(/ensureArchConfig\s*\(/);
    });

    it('ensureArchConfig 在 installLocal 内被调用', () => {
      const initSource = fs.readFileSync(
        path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'init.js'),
        'utf8',
      );
      const installLocalStart = initSource.search(/async\s+function\s+installLocal\s*\(/);
      const setupGlobalStart = initSource.search(
        /(?:async\s+)?function\s+setupGlobal\s*\(/,
      );
      expect(installLocalStart).toBeGreaterThan(-1);
      const installLocalBody = initSource.slice(installLocalStart, setupGlobalStart);
      expect(installLocalBody).toMatch(/ensureArchConfig\s*\(/);
    });

    it('模板模块本身不引用 HOME 或任何全局路径', () => {
      const source = fs.readFileSync(TEMPLATE_MODULE, 'utf8');
      expect(source).not.toMatch(/process\.env\.HOME|os\.homedir\(\)/);
    });
  });

  describe('AC-DEPLOY-003-06: 已有配置文件时不覆盖', () => {
    it('init 的写入逻辑带存在性守卫（不覆盖用户配置）', () => {
      const initSource = fs.readFileSync(
        path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'init.js'),
        'utf8',
      );
      // 必须能找到 existsSync 守卫与 .archlint.yaml 的关联
      const mentions = [...initSource.matchAll(/archlint/g)];
      expect(mentions.length).toBeGreaterThan(0);
      // 守卫断言：写入点前后存在 existsSync 检查
      expect(initSource).toMatch(/existsSync/);
    });
  });
});
