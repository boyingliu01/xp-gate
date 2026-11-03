/**
 * @test REQ-726
 * @intent doctor 必须能诊断架构工具的安装状态。难点是 Java/Kotlin 的 ArchUnit/Konsist
 *         是构建依赖而非 CLI —— 用 checkCmd 永远探不到，会误报「未安装」。
 *         另外每种语言只认自己的坐标，否则 Kotlin 声明 Konsist 会让 Java 误判已装。
 * @covers AC-689-01 AC-689-02 AC-689-03 AC-689-04 AC-689-05 AC-689-06 AC-689-07
 *         AC-689-08 AC-689-09
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  LANGUAGE_REGISTRY,
  getArchitectureTools,
  detectBuildFileDependency,
} from '../language-tools.js';

const dirs = [];

/**
 * Create a throwaway project directory populated with `files`.
 *
 * Fixture I/O is wrapped so a failure names the file it was writing: a bare
 * ENOENT from mkdirSync tells the next reader nothing about which fixture broke.
 */
function projectWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'xp-gate-arch-tools-'));
  dirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    try {
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    } catch (error) {
      throw new Error(`failed to write fixture ${relPath}: ${error.message}`);
    }
  }
  return dir;
}

/** Clean every temp project this file created. */
function cleanup() {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

const MAVEN_ARCHUNIT = `<project><dependencies><dependency>
  <groupId>com.tngtech.archunit</groupId>
  <artifactId>archunit-junit5</artifactId>
</dependency></dependencies></project>`;

const GRADLE_KONSIST = `dependencies { testImplementation("com.lemonappdev:konsist:0.13.0") }`;
const CATALOG_ARCHUNIT = `[libraries]
archunit = { module = "com.tngtech.archunit:archunit-junit5", version = "1.2.1" }`;

describe('AC-689-01/05 — 架构工具在注册表中可见', () => {
  it('每个支持的语言都暴露架构工具条目', () => {
    const arch = getArchitectureTools();
    expect(Object.keys(arch).sort()).toEqual(['go', 'java', 'kotlin', 'python', 'typescript']);
    for (const tools of Object.values(arch)) {
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  it('每条架构工具都有 name / gates / 安装提示或构建依赖标记', () => {
    for (const tools of Object.values(getArchitectureTools())) {
      for (const tool of tools) {
        expect(typeof tool.name).toBe('string');
        expect(tool.gates.length).toBeGreaterThan(0);
        // Either it is a CLI with per-platform install commands, or it is a
        // build-file dependency -- there is no third shape.
        const hasInstall = tool.install && typeof tool.install === 'object';
        const isBuildDependency = tool.detectBy === 'build-file';
        expect(hasInstall || isBuildDependency).toBe(true);
      }
    }
  });
});

describe('AC-689-08 — 架构工具必须 optional，缺失不改变退出码语义', () => {
  it('所有架构工具都是 optional', () => {
    for (const tools of Object.values(getArchitectureTools())) {
      for (const tool of tools) {
        expect(tool.optional, `${tool.name} must be optional`).toBe(true);
      }
    }
  });
});

describe('AC-689-04 — 不影响既有工具条目', () => {
  it('既有的 mvn / gradle / eslint 条目仍在且形态未变', () => {
    expect(LANGUAGE_REGISTRY.java.tools.some((t) => t.name === 'mvn')).toBe(true);
    expect(LANGUAGE_REGISTRY.java.tools.some((t) => t.name === 'gradle')).toBe(true);
    const eslint = LANGUAGE_REGISTRY.typescript.tools.find((t) => t.name === 'eslint');
    expect(eslint).toBeDefined();
    // Pre-existing CLI tools carry no detectBy, so they keep the default path.
    expect(eslint.detectBy).toBeUndefined();
  });
});

describe('AC-689-03 — 构建依赖检测（ArchUnit / Konsist）', () => {
  it('Maven pom.xml 声明 ArchUnit -> 已安装', () => {
    const dir = projectWith({ 'pom.xml': MAVEN_ARCHUNIT });
    const result = detectBuildFileDependency('java', dir);
    expect(result.available).toBe(true);
    cleanup();
  });

  it('Gradle 声明 Konsist -> kotlin 已安装', () => {
    const dir = projectWith({ 'build.gradle.kts': GRADLE_KONSIST });
    const result = detectBuildFileDependency('kotlin', dir);
    expect(result.available).toBe(true);
    cleanup();
  });

  it('没有任何构建文件 -> 未安装（不误报为已装）', () => {
    const dir = projectWith({ 'README.md': '# nothing here' });
    expect(detectBuildFileDependency('java', dir).available).toBe(false);
    cleanup();
  });

  it('AC-689-06: 坐标只在 gradle/libs.versions.toml 声明时也识别为已安装', () => {
    const dir = projectWith({ 'gradle/libs.versions.toml': CATALOG_ARCHUNIT });
    expect(detectBuildFileDependency('java', dir).available).toBe(true);
    cleanup();
  });

  // Cross-language isolation: declaring Konsist does NOT mean ArchUnit is
  // present. Without this split, a Kotlin project's build file would turn the
  // Java row green and doctor would stop reporting the real gap.
  it('AC-689-07: Kotlin 项目只声明 Konsist 时，Java 的 archunit 仍报未安装', () => {
    const dir = projectWith({ 'build.gradle.kts': GRADLE_KONSIST });
    expect(detectBuildFileDependency('kotlin', dir).available).toBe(true);
    expect(detectBuildFileDependency('java', dir).available).toBe(false);
    cleanup();
  });

  it('AC-689-07b: Java 项目只声明 ArchUnit 时，Kotlin 的 konsist 仍报未安装', () => {
    const dir = projectWith({ 'pom.xml': MAVEN_ARCHUNIT });
    expect(detectBuildFileDependency('java', dir).available).toBe(true);
    expect(detectBuildFileDependency('kotlin', dir).available).toBe(false);
    cleanup();
  });

  // AC-689-09: submodules are not scanned one by one -- the root pom plus the
  // version catalog is the whole search space.
  it('AC-689-09: 仅在子模块 pom.xml 声明时不被识别（只扫根构建文件）', () => {
    const dir = projectWith({ 'core/pom.xml': MAVEN_ARCHUNIT });
    expect(detectBuildFileDependency('java', dir).available).toBe(false);
    cleanup();
  });
});

describe('AC-689-02 — CLI 型工具的安装提示与注册表完全一致', () => {
  it('每个 CLI 架构工具在三大平台都有非空安装命令', () => {
    for (const tools of Object.values(getArchitectureTools())) {
      for (const tool of tools) {
        if (tool.detectBy === 'build-file') continue;
        for (const platform of ['darwin', 'linux', 'win32']) {
          expect(typeof tool.install[platform], `${tool.name}.${platform}`).toBe('string');
          expect(tool.install[platform].length).toBeGreaterThan(0);
        }
      }
    }
  });
});
