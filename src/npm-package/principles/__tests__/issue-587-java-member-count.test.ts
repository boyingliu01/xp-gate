/**
 * @test REQ-617
 * @intent `countMembers` matched "an identifier followed by `(`", which in Java is a
 *         **call site**, not a method declaration. Everything in a method body inflates
 *         the count:
 *
 *           builder.append(x)          -> member "append"
 *           Objects.requireNonNull(o)  -> member "requireNonNull"
 *           new SQLException(...)      -> member "SQLException"
 *           .map(x -> foo(x))          -> member "foo"
 *
 *         Deduplication is by NAME, which explains both observed oddities: the count is
 *         inflated but bounded, and the inflation tracks how call-diverse the class is.
 *         The reporter measured `WhaleAuditFilter` at 127 against 42 real methods, and a
 *         perfectly normal 24-method class reported as 41.
 *
 *         `clean-code.god-class` and `solid.srp` both default to a threshold of 30, so on
 *         Java both basically lost their discriminating power. The only fix available to
 *         a user was raising the threshold, which then also disables them for genuinely
 *         large classes — the same structural failure as #507 S4, only inverted: instead
 *         of never reporting, they always report.
 *
 *         This is the same shape as #590 and #587's sibling #588: a heuristic borrowed
 *         from one language silently mis-measuring another.
 * @covers AC-617-01, AC-617-02, AC-617-03
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JavaAdapter } from '../adapters/java';

// The adapter reads its subject from disk in the constructor, so fixtures are written
// to a temp dir. One directory for the whole suite; each fixture gets its own file.
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'xp-gate-java-587-'));

/** Number of `find` overloads in the overload fixture. */
const FIND_OVERLOAD_COUNT = 3;

function adapterFor(source: string, name = 'Test.java'): JavaAdapter {
  const file = join(FIXTURE_DIR, name);
  try {
    writeFileSync(file, source, 'utf-8');
  } catch (err) {
    // A fixture that cannot be written makes every case below fail for a reason that has
    // nothing to do with the adapter, so say so once and let the error surface.
    throw new Error(`could not write fixture ${file}: ${(err as Error).message}`);
  }
  return new JavaAdapter(file);
}

/** The part of `extractClasses()`'s result this suite reads. */
interface ClassInfo {
  name: string;
  methods: string[];
}

/**
 * Extract the member list for the first class body in `source`.
 *
 * Goes through the adapter's public `extractClasses` rather than the private helper, so
 * the test exercises the same path the rules do — a fix in `countMembers` that the
 * extractor does not route through would otherwise stay green.
 *
 * `extractClasses()` is typed `unknown[]` by the base adapter, so the shape is asserted
 * here rather than cast away: a silent change to what the extractor returns should fail
 * this suite, not produce `undefined.length`.
 */
function membersOf(source: string): string[] {
  const classes = adapterFor(source).extractClasses() as ClassInfo[];
  if (classes.length === 0) throw new Error('no class found in fixture');
  const first = classes[0];
  if (!Array.isArray(first.methods)) {
    throw new Error(`extractClasses() returned no methods array (got ${typeof first.methods})`);
  }
  return first.methods;
}

/**
 * A Java class whose method bodies are dense with calls, but which declares few
 * methods. The real 24-methods-reporting-41 case, distilled.
 */
const CALL_HEAVY_CLASS = `
public class AuditFilter implements Filter {
    private static final Logger LOG = LoggerFactory.getLogger(AuditFilter.class);

    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(response, "response");
        StringBuilder builder = new StringBuilder();
        builder.append(request.getRemoteAddr());
        builder.append(chain);
        LOG.warn("audit {}", builder.toString());
        List<String> names = items.stream().map(item -> item.getName()).collect(Collectors.toList());
        for (String name : names) {
            validate(name);
        }
        chain.doFilter(request, response);
    }

    private void validate(String name) {
        if (name == null) {
            throw new SQLException("null name");
        }
        Objects.requireNonNull(name);
    }

    public String describe() {
        return String.valueOf(COUNT);
    }

    private static final int COUNT = 3;
}
`;

describe('REQ-617: Java member counting must count declarations, not call sites', () => {
  it('AC-617-01: a call-heavy class reports only its declared methods', () => {
    const members = membersOf(CALL_HEAVY_CLASS);
    // Three declared methods: doFilter, validate, describe. The constructor is absent
    // here, so nothing else belongs in the list.
    expect(members.sort()).toEqual(['describe', 'doFilter', 'validate']);
  });

  it('AC-617-01: called-only names never appear as members', () => {
    // Each of these is a call site in the fixture above and was a phantom member
    // before the fix. Asserted individually so a regression names the culprit.
    const members = membersOf(CALL_HEAVY_CLASS);
    for (const phantom of [
      'append', 'requireNonNull', 'warn', 'info', 'requireNonNullElse',
      'map', 'collect', 'getName', 'toString', 'valueOf',
      'doFilterCall', 'SQLException', 'getRemoteAddr',
    ]) {
      expect(members, `${phantom} is a call site, not a declaration`).not.toContain(phantom);
    }
  });

  it('AC-617-02: overloads are distinct members and are each counted', () => {
    // Deduplication is by name today, so two `find` overloads collapse into one. A god
    // class with many overloads is exactly where the count should be highest, so this
    // matters beyond tidiness.
    const source = `
public class Repo {
    public Repo() {}

    public Item find(Long id) { return null; }

    public Item find(String name) { return null; }

    public Item find(Long id, boolean lock) { return null; }
}
`;
    const members = membersOf(source);
    // One constructor + three overloads of find.
    const findCount = members.filter((m) => m === 'find').length;
    expect(findCount, 'overloads collapsed into one member').toBe(FIND_OVERLOAD_COUNT);
  });

  it('AC-617-02: a constructor counts as a member, and the class name is not counted twice', () => {
    const source = `
public class Service {
    private final Dep dep;

    public Service(Dep dep) {
        this.dep = dep;
    }

    public void run() {
        dep.execute();
    }
}
`;
    const members = membersOf(source);
    expect(members).toContain('run');
    // `Service(Dep dep)` is a constructor declaration and does count.
    expect(members.filter((m) => m === 'Service').length).toBe(1);
    // `dep.execute()` must not contribute `execute`.
    expect(members).not.toContain('execute');
  });

  it('AC-617-03: an interface reports its abstract method signatures', () => {
    // Interface methods end in `;`, not `{`. A declaration matcher that requires an
    // opening brace would report zero methods for every interface, which would make ISP
    // structurally dead on Java -- the #507 S4 failure mode again.
    const source = `
public interface Filter {
    void init(FilterConfig config) throws ServletException;

    void doFilter(ServletRequest request, ServletResponse response, FilterChain chain);

    void destroy();

    default boolean isEnabled() {
        return true;
    }
}
`;
    const adapter = adapterFor(source, 'Filter.java');
    const ifaces = adapter.extractInterfaces();
    expect(ifaces.length).toBe(1);
    const names = ifaces[0].methods.sort();
    expect(names).toEqual(['destroy', 'doFilter', 'init', 'isEnabled']);
  });

  it('AC-617-03: generic and array return types do not swallow the method name', () => {
    // `Map<String, List<Item>> loadAll()` and `byte[] read()` are declarations whose
    // type expression contains angle brackets, commas and brackets. A naive matcher
    // either rejects them or reports `loadAll` as something else entirely.
    const source = `
public class Store {
    public Map<String, List<Item>> loadAll() {
        return Collections.emptyMap();
    }

    public byte[] read(int offset) {
        return new byte[0];
    }

    public <T extends Comparable<T>> T pick(List<T> items) {
        return items.get(0);
    }
}
`;
    const members = membersOf(source).sort();
    expect(members).toEqual(['loadAll', 'pick', 'read']);
  });

  it('AC-617-03: annotations do not become members', () => {
    const source = `
public class Annotated {
    @Override
    public String toString() {
        return "x";
    }

    @SuppressWarnings(value = "unchecked")
    private void work() {
        Objects.requireNonNull(this);
    }
}
`;
    const members = membersOf(source).sort();
    expect(members).toEqual(['toString', 'work']);
  });

  it('AC-617-02: methods of a nested class are not the outer class members', () => {
    // Measured on a real class: counting through the class body still gave 46 unique
    // names' worth of declarations where a brace-aware census gave 38 methods plus 8
    // overloads. The surplus was anonymous/nested class methods — the outer class is not
    // responsible for them, and a god-class verdict against it would be wrong.
    const source = `
public class Outer {
    public void outerWork() {
        helper.run();
    }

    private static final class Inner {
        public void innerWork() {
            new Thread(() -> {}).start();
        }
    }

    private Runnable anonymous = new Runnable() {
        @Override
        public void run() {
            outerWork();
        }
    };
}
`;
    const members = membersOf(source);
    expect(members).toContain('outerWork');
    expect(members, 'a nested class method counted against the outer class').not.toContain('innerWork');
    // The anonymous class's `run` is not a member of Outer either, and `outerWork` was
    // already counted once from its own declaration.
    expect(members.filter((m) => m === 'run').length).toBe(0);
    expect(members.filter((m) => m === 'outerWork').length).toBe(1);
  });
});
