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
 * Can this parameter type be declared incompatible with the base class contract?
 *
 * Tri-state, and that is the whole point: `true` = compatible, `false` = incompatible,
 * `null` = **cannot tell**. A single-file regex analysis does not have the base class, so
 * it usually cannot tell — and the honest answer to "cannot tell" is silence.
 *
 * #588: the previous version was `return false` for anything it did not recognise, which
 * turned a parse failure into a verdict. On Java the parse failed for nearly every
 * parameter, so every class with `extends` was reported.
 */
function compatibilityVerdict(
  paramType: string,
  className: string | undefined,
): boolean | null {
  if (isPrimitive(paramType)) return true;
  if (className && paramType.startsWith(className)) return true;
  // An unresolved generic, a lambda's inferred type, or a type we simply could not
  // parse: not enough information to judge.
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

function buildViolation(file: string, cls: ClassInfo, paramType: string): Violation {
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

function checkClass(file: string, cls: ClassInfo, isJava: boolean): Violation[] {
  if (!cls.code || !cls.code.includes('extends')) return undetermined();

  const violations: Violation[] = [];
  for (const paramType of methodParamTypes(cls.code, isJava)) {
    if (compatibilityVerdict(paramType, cls.name) === false) {
      violations.push(buildViolation(file, cls, paramType));
    }
  }
  return violations;
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
    const language = typeof adapter.detectLanguage === 'function' ? adapter.detectLanguage() : '';
    const isJava = language === 'java' || language === 'kotlin';
    return classes.flatMap((cls) => checkClass(file, cls, isJava));
  },
};
