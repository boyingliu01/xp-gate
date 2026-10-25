import { Rule, Violation, Adapter, Severity } from '../../types';
import { getActiveConfig } from '../../config';

/**
 * Primitive type names whose compatibility with any base contract can be assumed.
 *
 * Covers TypeScript and Java/Kotlin spellings: a `string` or an `int` parameter is never
 * the kind of narrowing this rule looks for.
 */
const PRIMITIVE_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'void', 'null', 'undefined', 'unknown', 'Object',
  'Array', 'int', 'long', 'short', 'byte', 'char', 'float', 'double', 'boolean', 'String',
  'Integer', 'Long', 'Short', 'Byte', 'Character', 'Float', 'Double', 'Boolean', 'Object',
]);

interface ClassInfo {
  code?: string;
  line?: number;
  name?: string;
}

/**
 * Tokens that are never a type: keywords, control-flow words and single-letter locals.
 *
 * #588: the message text used to be able to say `Parameter type "false"` or
 * `Parameter type "public"`, which is the signature of the old matcher having read a
 * call site or an expression fragment. Filtering them here means a parse that goes wrong
 * produces no finding instead of a nonsense one.
 */
const NOT_A_TYPE = new Set([
  'false', 'true', 'null', 'undefined', 'this', 'super', 'new', 'return', 'if', 'for',
  'while', 'switch', 'catch', 'public', 'private', 'protected', 'static', 'final',
  'abstract', 'synchronized', 'native', 'default', 'class', 'interface', 'enum', 'record',
]);

/** Parameter type from a TypeScript-style `name: Type` fragment, or null. */
function extractTsParamType(param: string): string | null {
  const typeMatch = param.match(/:\s*([\w$<>[\].]+)/);
  if (!typeMatch) return null;
  return normaliseTypeName(typeMatch[1]);
}

/** Reduce `Map<String, List<Item>>[]` / `Foo?` to a bare type name, or null. */
function normaliseTypeName(raw: string): string | null {
  const stripped = raw.replace(/<.*$/, '').replace(/\[\]$/, '').replace(/\?$/, '').trim();
  if (!stripped) return null;
  // Only the last dotted segment matters for compatibility: `java.util.List` -> `List`.
  const last = stripped.split('.').filter(Boolean).pop();
  if (!last) return null;
  if (!/^[\w$]+$/.test(last)) return null;
  if (NOT_A_TYPE.has(last)) return null;
  return last;
}

/**
 * Parameter type from a Java/Kotlin-style `Type name` fragment, or null.
 *
 * Java puts the type first and has no colon, which is why the TypeScript-only extractor
 * returned null for virtually every Java parameter — and the rule's `return false`
 * default then read that null as "incompatible", flagging every `extends` class.
 */
function extractJavaParamType(param: string): string | null {
  // `final Foo bar`, `@NotNull Foo bar`, `Foo... bar`, `Map<String, X> bar`
  const cleaned = param
    .replace(/@\w+(\([^)]*\))?/g, ' ')
    .replace(/\bfinal\b/g, ' ')
    .replace(/\.\.\./g, ' ')
    .trim();
  if (!cleaned) return null;
  // Everything except the trailing identifier is the type.
  const m = cleaned.match(/^(.+?)\s+[\w$]+$/);
  if (!m) return null;
  return normaliseTypeName(m[1]);
}

function isPrimitive(paramType: string): boolean {
  return PRIMITIVE_TYPES.has(paramType);
}

/**
 * Parameter type names declared by the base class in the same file, keyed by method name.
 *
 * #588's core problem is that LSP cannot be judged without the base contract. A
 * single-file analysis usually lacks it — but when the base class IS in the file (the
 * common shape for these projects, and the only shape a per-file rule can honestly
 * address), the contract is right there. Extracting it is what lets the rule keep a
 * discriminating power instead of degenerating into unconditional silence.
 *
 * Returns an empty map when the base class is not analysable, which the caller reads as
 * "cannot determine" rather than "no violations".
 *
 * @param code the derived class body, which names its base in the `extends` clause
 * @param allClasses every class the adapter found in this file
 * @returns method name -> parameter type names, for the base class only
 */
function baseContract(
  code: string,
  allClasses: ClassInfo[],
  isJava: boolean,
): Map<string, string[]> {
  const contract = new Map<string, string[]>();
  const extendsMatch = code.match(/\bextends\s+([\w$.]+)/);
  if (!extendsMatch) return contract;
  const baseName = extendsMatch[1].split('.').pop() ?? extendsMatch[1];
  const base = allClasses.find((c) => c.name === baseName && typeof c.code === 'string');
  if (!base || !base.code) return contract;
  const declRe = new RegExp(METHOD_DECL_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(base.code)) !== null) {
    contract.set(m[1], extractParamTypes(m[2], isJava));
  }
  return contract;
}

/**
 * Can this parameter type be declared incompatible with the base class contract?
 *
 * Tri-state, and that is the whole point: `true` = compatible, `false` = incompatible,
 * `null` = **cannot tell**. A single-file regex analysis does not always have the base
 * class, so it often cannot tell — and the honest answer to "cannot tell" is silence.
 *
 * #588: the previous version was `return false` for anything it did not recognise, which
 * turned a parse failure into a verdict. On Java the parse failed for nearly every
 * parameter, so every class with `extends` was reported.
 *
 * When the base method IS known, a parameter type that the base also declares is
 * compatible and one it does not is reported. That is a real comparison, not a guess:
 * both sides come from declarations in the same file.
 *
 * @param paramType the derived method's parameter type
 * @param className the derived class name
 * @param baseParamTypes the base method's parameter types, or undefined when unavailable
 * @returns true/false when decidable, null when not
 */
function compatibilityVerdict(
  paramType: string,
  className: string | undefined,
  baseParamTypes?: string[],
): boolean | null {
  if (isPrimitive(paramType)) return true;
  if (className && paramType.startsWith(className)) return true;
  if (baseParamTypes && baseParamTypes.length > 0) {
    // A type the base method also accepts is compatible; one it does not is the LSP
    // violation this rule exists to find. Compared by simple name with generics erased,
    // which is the precision a regex analysis can honestly claim.
    return baseParamTypes.includes(paramType);
  }
  // An unresolved generic, a lambda's inferred type, or a base we could not find: not
  // enough information to judge.
  return null;
}

/**
 * Build the "I could not determine this" outcome, which is nothing at all.
 *
 * Kept as a named function so the rule's silence is a decision with a documented reason
 * rather than an accident of a filter chain.
 */
function undetermined(): Violation[] {
  return [];
}

/**
 * Split a parameter list on top-level commas only.
 *
 * #588: `split(',')` broke `Map<String, Item> index` into `Map<String` and `Item> index`,
 * losing the real type and inventing a second one. Generic parameters are the normal
 * case in both Java and TypeScript, so a comma-blanking split is wrong in both.
 *
 * @param paramsText parameter list without surrounding parens
 * @returns parameter fragments
 */
function splitParams(paramsText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of paramsText) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth <= 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function extractParamTypes(paramsText: string, isJava: boolean): string[] {
  const types: string[] = [];
  for (const param of splitParams(paramsText)) {
    const paramType = isJava ? extractJavaParamType(param) : extractTsParamType(param);
    if (paramType) types.push(paramType);
  }
  return types;
}

/**
 * Build a violation record for a class whose parameter type was decided incompatible.
 *
 * Exported for the line-fallback case: after #588 the rule can only report types it can
 * PROVE incompatible, so a fixture can no longer reach `buildViolation` through
 * `lspRule.check`. Asserting it directly keeps the `?? 0` fallback covered instead of
 * letting the case pass vacuously.
 *
 * @param file path reported in the violation
 * @param cls the class, whose `line` may be absent
 * @param paramType the offending parameter type
 * @returns the violation record
 */
export function buildViolation(file: string, cls: ClassInfo, paramType: string): Violation {
  // Read the ACTIVE severity here rather than at module load (#457).
  const settings = getActiveConfig().rules['solid']['lsp'];
  return {
    file,
    line: cls.line ?? 0,
    ruleId: 'solid.lsp',
    message: `Possible LSP violation in "${cls.name}". Parameter type "${paramType}" may not be compatible with base class contract.`,
    severity: (settings.severity as Severity) ?? 'info',
  };
}

/**
 * Method DECLARATIONS in a class body — not call sites.
 *
 * `\w+\s*\(([^)]+)\)` matched calls too, split `foo(a, b)` on the comma and made `a`/`b`
 * into "parameter types". Requiring a declaration shape (modifiers/return type before the
 * name, and `{`/`;` after the parameter list) is what tells the two apart.
 */
const METHOD_DECL_RE = new RegExp(
  '(?:^|\\n)[ \\t]*(?:@[\\w$.]+(?:\\([^)]*\\))?[ \\t]*)*' +
    '(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp|sealed|non-sealed|override|suspend|inline|fun)[ \\t]+)*' +
    '(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>[ \\t]+)?' +
    '[\\w$][\\w$.]*(?:[ \\t]*<[^<>]*(?:<[^<>]*>[^<>]*)*>[ \\t]*)?(?:\\[\\][ \\t]*)*[ \\t]+' +
    '(\\w+)[ \\t]*\\(([^;{}=]*)\\)' +
    '(?:\\s*(?:throws|:)[^{;]+)?\\s*[{;]',
  'g',
);

function methodParamTypes(code: string, isJava: boolean): string[] {
  const types: string[] = [];
  let m: RegExpExecArray | null;
  METHOD_DECL_RE.lastIndex = 0;
  while ((m = METHOD_DECL_RE.exec(code)) !== null) {
    types.push(...extractParamTypes(m[2], isJava));
  }
  return types;
}

/**
 * Check one derived class against its base class contract.
 *
 * The rule reports a parameter type only when the base method is visible in the SAME file
 * and does not accept that type. Every other case is silence, because a single-file
 * analysis cannot know the base contract otherwise (#588).
 *
 * `allClasses` is passed in so the base class can be located by name; the rule does not
 * enumerate classes itself, keeping class discovery the adapter's job.
 *
 * @param file path reported in violations
 * @param cls the derived class
 * @param allClasses every class the adapter found in this file
 * @param isJava true for Java/Kotlin parameter syntax
 * @returns violations, possibly none
 */
function checkClass(
  file: string,
  cls: ClassInfo,
  allClasses: ClassInfo[],
  isJava: boolean,
): Violation[] {
  if (!cls.code || !cls.code.includes('extends')) return undetermined();

  const contract = baseContract(cls.code, allClasses, isJava);
  if (contract.size === 0) return undetermined();

  const violations: Violation[] = [];
  for (const [methodName, paramTypes] of declaredDeclarations(cls.code, isJava)) {
    const baseParamTypes = contract.get(methodName);
    if (!baseParamTypes) continue;
    for (const paramType of paramTypes) {
      if (compatibilityVerdict(paramType, cls.name, baseParamTypes) === false) {
        violations.push(buildViolation(file, cls, paramType));
      }
    }
  }
  return violations;
}

/**
 * Method name -> parameter types, for the declarations in a class body.
 *
 * Unlike `methodParamTypes` this keeps the method name, which is what makes the base
 * lookup possible.
 *
 * @param code a class body
 * @param isJava true for Java/Kotlin parameter syntax
 * @returns declarations, in source order
 */
function declaredDeclarations(code: string, isJava: boolean): Array<[string, string[]]> {
  const declarations: Array<[string, string[]]> = [];
  const declRe = new RegExp(METHOD_DECL_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(code)) !== null) {
    declarations.push([m[1], extractParamTypes(m[2], isJava)]);
  }
  return declarations;
}

/**
 * Parameter types of the METHOD DECLARATIONS in a body, in source order.
 *
 * Exported for the same reason as `parseJavaParamTypes`: the rule's verdict cannot tell a
 * correct declaration matcher from one that also matches call sites, because both end in
 * silence for unparseable types. #588's anti-vacuity check is what proved that.
 *
 * @param code a class body
 * @param isJava true for Java/Kotlin (`Type name`), false for TypeScript (`name: Type`)
 * @returns parsed parameter type names
 */
export function declaredParamTypes(code: string, isJava = true): string[] {
  return methodParamTypes(code, isJava);
}

/**
 * Parameter types parsed out of a Java parameter list.
 *
 * Exported so the #588 suite can assert on the PARSE rather than only on the rule's
 * verdict. Without this the rule's silence is ambiguous: "parsed and judged
 * undeterminable" and "never parsed at all" look identical from the outside, which is how
 * the first version of this fix survived its own anti-vacuity check.
 *
 * @param paramsText a Java parameter list without the surrounding parens
 * @returns parsed type names
 */
export function parseJavaParamTypes(paramsText: string): string[] {
  return extractParamTypes(paramsText, true);
}

/**
 * Does this adapter's language declare parameters as `Type name` (Java/Kotlin) rather
 * than `name: Type` (TypeScript and friends)?
 *
 * Split out of `lspRule.check` to keep that function's cyclomatic complexity where it was:
 * #588 pushed it from 2 to 4, and Gate 3's ratchet blocks a worsening. It also gives the
 * one piece of language knowledge a name, which is where a future adapter should look.
 *
 * @param adapter the adapter under inspection
 * @returns true for Java/Kotlin parameter syntax
 */
function usesTypeFirstName(adapter: Adapter): boolean {
  if (typeof adapter.detectLanguage !== 'function') return false;
  const language = adapter.detectLanguage();
  return language === 'java' || language === 'kotlin';
}

export const lspRule: Rule = {
  id: 'solid.lsp',
  name: 'Liskov Substitution Principle Rule',
  threshold: 0,
  severity: 'info',
  check: (file: string, adapter: Adapter): Violation[] => {
    // #392-#4: no empty catch — let adapter/rule errors bubble up to
    // analyzer.runRuleOnFile() so they surface as gate errors, not silent [].
    const classes = (adapter.extractClasses() || []) as ClassInfo[];
    // The adapter decides which parameter syntax applies; the rule holds no language
    // knowledge of its own (#588 suggestion 2, taken as far as a single file allows).
    const isJava = usesTypeFirstName(adapter);
    return classes.flatMap((cls) => checkClass(file, cls, classes, isJava));
  },
};
