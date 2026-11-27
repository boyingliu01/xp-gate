/**
 * Import-clause parsing for the TypeScript adapter's `imports` getter.
 *
 * Extracted from `typescript.ts` so that one function does not have to carry
 * both the parsing rules and the usage-scoring loop: together they pushed the
 * getter past the 50-line budget and to 5 nesting levels. Splitting also lets
 * the clause grammar be tested without reading a file.
 */

/** One symbol bound by an import statement. */
export interface ImportBinding {
  name: string;
  type?: string;
}

/** A plain identifier -- these are the only names an import can bind. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Parse the clause between `import` and `from` into the symbols it binds.
 *
 * Covers the four shapes TypeScript allows: a default binding, a named brace
 * list (with per-member `type` and `as` renames), and a namespace binding.
 *
 * @param clause text between `import` / `import type` and `from`
 * @param isTypeOnly whether the whole statement was `import type ...`
 */
export function parseImportClause(clause: string, isTypeOnly: boolean): ImportBinding[] {
  const marker = isTypeOnly ? 'type' : undefined;
  // One collector for all three forms: an import clause names a default, a set of
  // named members, a namespace, or several of them at once.
  const bindings: ImportBinding[] = [];
  const push = (name: string, type?: string): void => {
    if (IDENTIFIER.test(name)) bindings.push({ name, ...(type ? { type } : {}) });
  };

  pushDefaultImport(clause, marker, push);
  pushNamedImports(clause, isTypeOnly, push);
  pushNamespaceImport(clause, marker, push);
  return bindings;
}

/** A collector for one binding, as `parseImportClause` builds it. */
type BindingCollector = (name: string, type?: string) => void;

/** `import Foo from` -- the leading identifier, if any. */
function pushDefaultImport(clause: string, marker: string | undefined, push: BindingCollector): void {
  const def = /^(\w+)/.exec(clause);
  if (def) push(def[1], marker);
}

/**
 * `import { a, b as c, type D } from` -- every member of the brace list.
 *
 * A member may be type-only on its own (`type D`) even when the whole clause is not,
 * which is why `memberTypeOnly` is OR-ed with the clause-level flag rather than
 * replacing it.
 */
function pushNamedImports(clause: string, isTypeOnly: boolean, push: BindingCollector): void {
  const braces = /\{([\s\S]*?)\}/.exec(clause);
  if (!braces) return;
  for (const raw of braces[1].split(',')) {
    const binding = parseNamedMember(raw, isTypeOnly);
    if (binding) push(binding.name, binding.type);
  }
}

/**
 * One member of a named import list, or null for an empty slot.
 *
 * The `as` alias wins when present: the LOCAL name is what the file binds, and that is
 * what a later reference resolves against.
 */
function parseNamedMember(raw: string, isTypeOnly: boolean): { name: string; type?: string } | null {
  const part = raw.trim();
  if (!part) return null;
  return {
    name: localNameOf(part),
    type: isTypeOnly || isTypeOnlyMember(part) ? 'type' : undefined,
  };
}

/**
 * The LOCAL name a named import binds to.
 *
 * `{ a as b }` binds `b`, so the alias wins -- resolving the imported name would report the
 * wrong identifier as used. Without an alias the name is the identifier itself, with a
 * leading `type` modifier removed.
 */
function localNameOf(part: string): string {
  const alias = /\bas\s+(\w+)\s*$/.exec(part);
  return alias ? alias[1] : part.replace(/^type\s+/, '').trim();
}

/** Whether the member itself carries the `type` modifier: `{ type Foo }`. */
function isTypeOnlyMember(part: string): boolean {
  return /^type\s+/.test(part);
}

/** `import * as ns from` -- the namespace binding. */
function pushNamespaceImport(clause: string, marker: string | undefined, push: BindingCollector): void {
  const ns = /\*\s+as\s+(\w+)/.exec(clause);
  if (ns) push(ns[1], marker);
}
