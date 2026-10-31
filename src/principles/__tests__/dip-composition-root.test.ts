/**
 * @test REQ-627
 * @intent `solid.dip` fired on composition roots. That code's whole job is to
 *         `new` concrete implementations and wire them together -- which IS
 *         dependency injection done correctly -- so reporting it as "violates DIP"
 *         leaves the user two options: break the code, or sprinkle suppression
 *         markers until the rule means nothing.
 *
 *         Measured on a real Java repo: 178 files scanned, 29 `solid.dip`
 *         warnings, and ALL 29 landed on 9 wiring points -- a Spring
 *         `@Configuration`/`@Bean` class, a static factory, a framework
 *         `FilterAdapter.init()`, and constructors of self-contained aggregates.
 *
 *         The distinction the rule was missing is not "where" but "what": a `new`
 *         that assembles a component at the boundary is the inversion working; a
 *         `new` that reaches for a collaborator deep inside business logic is the
 *         inversion being bypassed. This file pins the boundary markers.
 *
 *         Deliberately NOT exempted: a `new` inside an ordinary method of a normal
 *         class. If everything that could be called a "wiring point" were excused,
 *         the rule would never fire and the fix would be indistinguishable from
 *         deleting it.
 * @covers AC-670-29, AC-670-30, AC-670-31
 */
import { describe, it, expect } from 'vitest';
import { dipRule } from '../rules/solid/dip';
import type { Adapter } from '../types';

/** Minimal adapter stub: `extractClasses` is all the DIP rule consumes. */
function adapterWith(code: string, line = 1): Adapter {
  return { extractClasses: () => [{ code, line }] } as unknown as Adapter;
}

describe('solid.dip recognises composition roots (#627)', () => {
  it('AC-670-29: Spring @Configuration/@Bean wiring is not a violation', () => {
    const body = [
      '@Configuration',                       // 0
      'public class DemoDataSourceConfig {',  // 1
      '  @Bean(destroyMethod = "close")',     // 2
      '  public DataSource dataSource() {',   // 3
      '    DruidDataSource ds = new DruidDataSource();', // 4  <- assembly, not a smell
      '    ds.setUrl(cfg.url());',
      '    return ds;',
      '  }',
      '}',
    ].join('\n');

    const violations = dipRule.check('src/DemoDataSourceConfig.java', adapterWith(body));
    expect(violations).toHaveLength(0);
  });

  it('AC-670-30: a static factory / framework init() is not a violation', () => {
    const factoryBody = [
      'public class PlanCollectorFactory {',
      '  public static Assembly assemble(Config c, Clock k) {',
      '    PlanCache cache = new PlanCache(c, k);',
      '    ExplainSidecar sidecar = new ExplainSidecar(c);',
      '    return new Assembly(cache, sidecar);',
      '  }',
      '}',
    ].join('\n');
    expect(dipRule.check('src/PlanCollectorFactory.java', adapterWith(factoryBody))).toHaveLength(0);

    // A framework entry point that assembles in init() is the same shape as a
    // factory: the framework constructed the object, and init() is where wiring
    // belongs.
    const filterBody = [
      'public class WhaleAuditFilter extends FilterAdapter {',
      '  public void init(FilterConfig cfg) {',
      '    this.store = new AuditStore(cfg);',
      '  }',
      '}',
    ].join('\n');
    expect(dipRule.check('src/WhaleAuditFilter.java', adapterWith(filterBody))).toHaveLength(0);
  });

  it('AC-670-31: a `new` inside ordinary business logic is still a violation', () => {
    const body = [
      'public class OrderService {',
      '  public Receipt charge(Order o) {',
      '    PaymentGateway gw = new StripeGateway(apiKey);', // <- bypassed injection
      '    return gw.charge(o);',
      '  }',
      '}',
    ].join('\n');

    const violations = dipRule.check('src/OrderService.java', adapterWith(body));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('solid.dip');
    expect(violations[0].message).toContain('new StripeGateway()');
  });
});

/**
 * @test REQ-676
 * @intent `new RegExp(pattern)` constructs a VALUE, not a collaborator. The
 *         default exclusion list already carries Date/Map/Set/Object/Promise --
 *         every other value type built with `new` in ordinary code -- but RegExp
 *         was missing, so building a dynamic pattern inside a method was reported
 *         as "bypassing dependency injection". There is no injectable alternative:
 *         the pattern is computed from a runtime string.
 * @covers AC-676-01, AC-676-02
 */
describe('solid.dip does not flag value-object construction (REQ-676)', () => {
  it('AC-676-01: a dynamic RegExp built from a runtime name is not a violation', () => {
    const body = [
      'class NameMatcher {',
      '  score(body: string, name: string): boolean {',
      '    const re = new RegExp(`\\b${name}\\b`, "g");',
      '    return re.test(body);',
      '  }',
      '}',
    ].join('\n');

    expect(dipRule.check('src/NameMatcher.ts', adapterWith(body))).toHaveLength(0);
  });

  it('AC-676-02: a genuine collaborator is still reported (anti-vacuity)', () => {
    const body = [
      'class OrderService {',
      '  total(): number {',
      '    const repo = new OrderRepository();',
      '    return repo.sum();',
      '  }',
      '}',
    ].join('\n');

    expect(dipRule.check('src/OrderService.ts', adapterWith(body))).toHaveLength(1);
  });
});
