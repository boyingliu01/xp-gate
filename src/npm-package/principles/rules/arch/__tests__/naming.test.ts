/**
 * @test REQ-727
 * @intent Java 命名规则 R10/R11/R12 —— 按包路径约束类名后缀。
 *         ArchUnit 33 条里这三条是纯 AST 模式匹配，不需要跑 Maven，
 *         因此能在 pre-commit 拦住，比 ArchUnit 快一个数量级。
 * @covers AC-694-01 AC-694-02 AC-694-03 AC-694-04 AC-694-05 AC-694-06 AC-694-07 AC-694-08
 */
import { describe, it, expect } from 'vitest';
import { Rule, Violation } from '../../../types';
import {
  controllerNamingRule,
  serviceNamingRule,
  repositoryNamingRule,
} from '../naming';
import { extractPackageSegments } from '../shared';

/** Minimal adapter surface the naming rules read: class names + positions. */
function adapterWithClasses(classes: Array<{ name: string; line?: number }>) {
  return { extractClasses: () => classes };
}

/** Call a rule and return only its violations, so each test reads as one assertion. */
function violationsOf(
  rule: Rule,
  file: string,
  classes: Array<{ name: string; line?: number }>,
): Violation[] {
  return rule.check(file, adapterWithClasses(classes) as never);
}

describe('R10 — interfaces/rest 下的类必须以 Controller 结尾', () => {
  it('AC-694-01: UserAPI 在 interfaces/rest 下 -> 违规', () => {
    const v = violationsOf(
      controllerNamingRule,
      'src/main/java/com/acme/interfaces/rest/UserAPI.java',
      [{ name: 'UserAPI' }],
    );
    expect(v).toHaveLength(1);
    expect((v[0] as { ruleId: string }).ruleId).toBe('arch.controller');
  });

  it('AC-694-02: UserController 在 interfaces/rest 下 -> 通过', () => {
    const v = violationsOf(
      controllerNamingRule,
      'src/main/java/com/acme/interfaces/rest/UserController.java',
      [{ name: 'UserController' }],
    );
    expect(v).toEqual([]);
  });
});

describe('R11 — application/service 下的类必须以 Service 或 ServiceImpl 结尾', () => {
  it('AC-694-03: OrderManager 在 application/service 下 -> 违规', () => {
    const v = violationsOf(
      serviceNamingRule,
      'src/main/java/com/acme/application/service/OrderManager.java',
      [{ name: 'OrderManager' }],
    );
    expect(v).toHaveLength(1);
    expect((v[0] as { ruleId: string }).ruleId).toBe('arch.service');
  });

  it('AC-694-04: OrderServiceImpl 在 application/service 下 -> 通过', () => {
    const v = violationsOf(
      serviceNamingRule,
      'src/main/java/com/acme/application/service/OrderServiceImpl.java',
      [{ name: 'OrderServiceImpl' }],
    );
    expect(v).toEqual([]);
  });
});

describe('R12 — infrastructure/repository 与 gateway 下的类必须以 Mapper/DAO/Repository 结尾', () => {
  // The suffix whitelist is case-SENSITIVE on purpose: `DAO` is the documented
  // form, so `UserDao` must be reported. Lower-casing before comparison would
  // silently accept it and the rule would stop enforcing the standard.
  it('AC-694-05: UserDao 在 infrastructure/repository 下 -> 违规（DAO 大写才算）', () => {
    const v = violationsOf(
      repositoryNamingRule,
      'src/main/java/com/acme/infrastructure/repository/UserDao.java',
      [{ name: 'UserDao' }],
    );
    expect(v).toHaveLength(1);
    expect((v[0] as { ruleId: string }).ruleId).toBe('arch.repository');
  });

  it('AC-694-06: UserMapper 在 infrastructure/repository 下 -> 通过', () => {
    const v = violationsOf(
      repositoryNamingRule,
      'src/main/java/com/acme/infrastructure/repository/UserMapper.java',
      [{ name: 'UserMapper' }],
    );
    expect(v).toEqual([]);
  });
});

describe('包路径边界', () => {
  // Maven multi-module puts the module name before src/main/java. Anchoring the
  // match on the start of the path (or on "src/main/java" as a prefix) would
  // miss every class in every submodule -- the common shape, not an edge case.
  it('AC-694-07: Maven 多模块路径 core/src/main/java/... 正确识别为 interfaces/rest', () => {
    const v = violationsOf(
      controllerNamingRule,
      'core/src/main/java/com/acme/interfaces/rest/UserAPI.java',
      [{ name: 'UserAPI' }],
    );
    expect(v).toHaveLength(1);
  });

  // The case above does NOT pin down WHICH `src/.../java` is used: it holds a
  // single occurrence, so "first" and "last" agree. A mutation run proved this:
  // flipping the anchor to the first occurrence left every test green.
  //
  // Asserting through a rule cannot fix that, because the rules search for a
  // CONTIGUOUS run (`interfaces/rest`), and both anchors still contain it. So
  // this checks the extracted package directly -- the only assertion that
  // actually distinguishes the two behaviours.
  it('AC-694-07b: 路径含两处 src/main/java 时锚定最后一处（嵌套模块）', () => {
    expect(
      extractPackageSegments(
        'legacy/src/main/java/gen/src/main/java/com/acme/interfaces/rest/UserAPI.java',
      ),
    ).toEqual(['com', 'acme', 'interfaces', 'rest']);
  });

  it('AC-694-08: 非目标包 util/FooHelper.java 不误报任何命名规则', () => {
    const file = 'src/main/java/com/acme/util/FooHelper.java';
    const classes = [{ name: 'FooHelper' }];
    expect(violationsOf(controllerNamingRule, file, classes)).toEqual([]);
    expect(violationsOf(serviceNamingRule, file, classes)).toEqual([]);
    expect(violationsOf(repositoryNamingRule, file, classes)).toEqual([]);
  });
});
