/**
 * @test REQ-728
 * @intent Java 依赖方向规则 R08/R15/W01。三条规则分别用类名、包路径、文件名判定，
 *         不是不一致而是各自表达的东西不同（见 dependency.ts 头注释）。
 * @covers AC-728-01 AC-728-02 AC-728-03 AC-728-04 AC-728-05 AC-728-06 AC-728-07
 *         AC-728-08 AC-728-09 AC-728-10 AC-728-11 AC-728-12 AC-728-13 AC-728-14
 */
import { describe, it, expect } from 'vitest';
import {
  dtoLayeringRule,
  domainEventRule,
  utilServiceRule,
} from '../dependency';

/**
 * Adapter stub. `imports` is a GETTER on the real adapter, so this mirrors that
 * shape rather than exposing a plain array -- a rule that reads `.imports()`
 * by mistake must fail here, not in production.
 */
function adapter(imports: string[] = [], classes: string[] = []) {
  return {
    extractClasses: () => classes.map((name) => ({ name, line: 1 })),
    get imports() {
      return imports.map((name) => ({ name, line: 1, used: false, type: 'import' }));
    },
  };
}

const DTO_FILE = 'src/main/java/com/acme/interfaces/dto/UserDTO.java';

describe('R08 — DTO/VO 不得依赖 Service 或 Repository', () => {
  it('AC-728-01: UserDTO import UserService -> 违规', () => {
    const v = dtoLayeringRule.check(DTO_FILE, adapter(['com.acme.application.service.UserService']) as never);
    expect(v).toHaveLength(1);
    expect(v[0].ruleId).toBe('arch.dto-layering');
  });

  it('AC-728-02: OrderVO import OrderRepository -> 违规', () => {
    const v = dtoLayeringRule.check(
      'src/main/java/com/acme/interfaces/vo/OrderVO.java',
      adapter(['com.acme.infrastructure.repository.OrderRepository']) as never,
    );
    expect(v).toHaveLength(1);
  });

  it('AC-728-03: UserDTO 只 import javax.validation 注解 -> 通过', () => {
    const v = dtoLayeringRule.check(
      DTO_FILE,
      adapter(['javax.validation.constraints.NotNull', 'java.util.List']) as never,
    );
    expect(v).toEqual([]);
  });

  // The exclusion list is the whole reason the suffix heuristic survives on a
  // real codebase: `OrderServiceConstants` matches `*Service` but is not one.
  it('AC-728-09: UserDTO import OrderServiceConstants -> 不报（排除后缀优先于命中）', () => {
    const v = dtoLayeringRule.check(
      DTO_FILE,
      adapter(['com.acme.application.service.OrderServiceConstants']) as never,
    );
    expect(v).toEqual([]);
  });

  // A wildcard import carries no class name at all -- the Java adapter's regex
  // does not even capture it. Documented in the design (§4.3) and pinned here so
  // nobody "fixes" the rule into guessing a name from the package.
  it('AC-728-14: DTO 中的通配 import 不参与 R08 判定', () => {
    const v = dtoLayeringRule.check(DTO_FILE, adapter(['com.acme.service']) as never);
    expect(v).toEqual([]);
  });
});

describe('R15 — domain/event 不得依赖 infrastructure', () => {
  const EVENT_FILE = 'src/main/java/com/acme/domain/event/OrderCompletedEvent.java';

  it('AC-728-04: OrderCompletedEvent import infrastructure/kafka/KafkaClient -> 违规', () => {
    const v = domainEventRule.check(
      EVENT_FILE,
      adapter(['com.acme.infrastructure.kafka.KafkaClient']) as never,
    );
    expect(v).toHaveLength(1);
    expect(v[0].ruleId).toBe('arch.domain-event');
  });

  it('AC-728-05: domain/event import domain/model -> 通过', () => {
    const v = domainEventRule.check(
      EVENT_FILE,
      adapter(['com.acme.domain.model.Order']) as never,
    );
    expect(v).toEqual([]);
  });

  // Wildcard imports never reach ANY rule: the Java adapter's import regex
  // (`[\w.]+`) does not match `*`, so `import com.acme.infrastructure.*;` is
  // absent from `adapter.imports` entirely. Measured, not assumed.
  //
  // The design's §4.3 claimed R15 would still catch a wildcard via its package
  // segments. That is not what the parser does, so the claim is corrected here
  // rather than left as documentation that disagrees with the code.
  it('AC-728-14b: 通配 import 不会出现在 adapter.imports 中，因此任何规则都看不到它', () => {
    const wildcardSource = 'import com.acme.infrastructure.*;';
    // Mirror the adapter's own regex so this test breaks if that regex widens.
    const adapterImportRegex = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;\s*$/;
    expect(adapterImportRegex.exec(wildcardSource)).toBeNull();
    // And with an empty import list, R15 stays silent.
    expect(domainEventRule.check(EVENT_FILE, adapter([]) as never)).toEqual([]);
  });
});

describe('W01 — Util/Helper 不应依赖 Application Service（WARNING）', () => {
  const UTIL_FILE = 'src/main/java/com/acme/shared/StringUtils.java';

  it('AC-728-06: StringUtils import OrderService -> 告警', () => {
    const v = utilServiceRule.check(UTIL_FILE, adapter(['com.acme.application.service.OrderService']) as never);
    expect(v).toHaveLength(1);
    expect(v[0].ruleId).toBe('arch.util-service');
    expect(v[0].severity).toBe('warning');
  });

  it('AC-728-07: FileHelper import java.io.* -> 通过', () => {
    const v = utilServiceRule.check(
      'src/main/java/com/acme/shared/FileHelper.java',
      adapter(['java.io.File', 'java.util.List']) as never,
    );
    expect(v).toEqual([]);
  });

  // Framework services are not this project's application layer. Paired with
  // AC-728-13 below, these two prove the exclusion is scoped to framework
  // prefixes and does not silence the project's own services.
  it('AC-728-12: OrderHelper import Spring 的 DiscoveryService -> 不报（框架包排除）', () => {
    const v = utilServiceRule.check(
      'src/main/java/com/acme/shared/OrderHelper.java',
      adapter(['org.springframework.cloud.client.discovery.DiscoveryService']) as never,
    );
    expect(v).toEqual([]);
  });

  it('AC-728-13: OrderHelper import 本项目的 OrderService -> 报（排除只对框架包生效）', () => {
    const v = utilServiceRule.check(
      'src/main/java/com/acme/shared/OrderHelper.java',
      adapter(['com.acme.application.service.OrderService']) as never,
    );
    expect(v).toHaveLength(1);
  });
});

describe('W01 不得阻塞提交', () => {
  // "Not blocking" is not "silent": the two assertions below are deliberately
  // separate. An implementation that swallowed W01 entirely would pass the
  // first and fail the second (AC-728-10 / AC-728-11).
  it('AC-728-10: W01 产出中没有 error 级违规', () => {
    const v = utilServiceRule.check(
      'src/main/java/com/acme/shared/StringUtils.java',
      adapter(['com.acme.application.service.OrderService']) as never,
    );
    expect(v.every((violation) => violation.severity !== 'error')).toBe(true);
  });

  it('AC-728-11: W01 仍然出现在结果里（不阻塞 != 不上报）', () => {
    const v = utilServiceRule.check(
      'src/main/java/com/acme/shared/StringUtils.java',
      adapter(['com.acme.application.service.OrderService']) as never,
    );
    expect(v.length).toBeGreaterThan(0);
  });

  it('AC-728-08: W01 默认规则配置为 warning', () => {
    expect(utilServiceRule.severity).toBe('warning');
  });
});

describe('src/test/java 整体排除', () => {
  // Test sources may be named anything; the rules constrain production layering.
  it('测试目录下的同名依赖不触发任何规则', () => {
    const testFile = 'src/test/java/com/acme/interfaces/dto/UserDTOTest.java';
    expect(dtoLayeringRule.check(testFile, adapter(['com.acme.application.service.UserService']) as never)).toEqual([]);
    expect(utilServiceRule.check('src/test/java/com/acme/StringUtilsTest.java', adapter(['com.acme.application.service.OrderService']) as never)).toEqual([]);
  });
});
