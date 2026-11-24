/**
 * @test REQ-LANG-BUILDFILE
 * @intent ArchUnit（Java）和 Konsist（Kotlin）没有 CLI 可探测——它们只作为构建
 *         文件里的**依赖坐标**存在。因此"装没装"这个问题只能靠读构建文件回答。
 *
 *         这条路径此前零覆盖：`detectBuildFileDependency` 一次都没被调用过，
 *         意味着"Java 项目的架构工具是否可用"这个判断从来没有被验证过。
 *
 *         版本目录（gradle/libs.versions.toml）必须一并扫描：Gradle 项目可能只
 *         在版本目录里声明坐标，从不写进 build.gradle.kts。只查构建脚本会把一个
 *         真正装好的工具报成缺失（AC-689-06）。
 *
 * @covers AC-689-06
 * @covers AC-LANG-BUILDFILE-01
 * @covers AC-LANG-BUILDFILE-02
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tools = require('../language-tools.js');

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-buildfile-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('detectBuildFileDependency', () => {
  it('reports an unknown language as unavailable rather than guessing', () => {
    // Only java and kotlin have a build-file coordinate. A language outside that set
    // has no build-file signal at all, and "not applicable" must not read as "found".
    const result = tools.detectBuildFileDependency('typescript', root);
    expect(result.available).toBe(false);
    expect(result.path).toBeNull();
  });

  it('finds the coordinate in pom.xml and names the declaring file', () => {
    writeFileSync(join(root, 'pom.xml'), '<dependency><artifactId>com.tngtech.archunit</artifactId></dependency>');

    const result = tools.detectBuildFileDependency('java', root);
    expect(result.available).toBe(true);
    // The path is what lets the reader check the claim; a bare `true` is unfalsifiable.
    expect(result.path).toBe(join(root, 'pom.xml'));
    expect(result.version).toContain('pom.xml');
  });

  it('finds a coordinate declared only in the Gradle version catalog', () => {
    // AC-689-06: the catalog is included precisely because a Gradle project may name
    // the coordinate ONLY there. Checking just build.gradle.kts would report a
    // genuinely installed tool as missing.
    mkdirSync(join(root, 'gradle'), { recursive: true });
    writeFileSync(join(root, 'gradle', 'libs.versions.toml'), 'konsist = "com.lemonappdev:konsist"');

    const result = tools.detectBuildFileDependency('kotlin', root);
    expect(result.available).toBe(true);
    expect(result.path).toBe(join(root, 'gradle', 'libs.versions.toml'));
  });

  it('reports unavailable when a build file exists but omits the coordinate', () => {
    // The distinction that matters: "no build file" and "build file without the
    // dependency" both mean not-installed, but only this case proves the scanner
    // actually reads the file instead of crediting its mere existence.
    writeFileSync(join(root, 'build.gradle'), 'dependencies { implementation "org.other:thing" }');
    expect(tools.detectBuildFileDependency('java', root).available).toBe(false);
  });

  it('reports unavailable for a project with no build file at all', () => {
    expect(tools.detectBuildFileDependency('java', root).available).toBe(false);
  });

  it('defaults to the process cwd when no root is given', () => {
    // The default is part of the contract: callers that omit the argument must not
    // get an empty scan.
    const result = tools.detectBuildFileDependency('java');
    expect(result).toHaveProperty('available');
    expect(result).toHaveProperty('path');
  });
});
