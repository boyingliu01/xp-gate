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
  const bindings: ImportBinding[] = [];
  const marker = isTypeOnly ? 'type' : undefined;
  const push = (name: string, type?: string): void => {
    if (IDENTIFIER.test(name)) bindings.push({ name, ...(type ? { type } : {}) });
  };

  // default import
  const def = /^(\w+)/.exec(clause);
  if (def) push(def[1], marker);

  // named imports { a, b as c }
  const braces = /\{([\s\S]*?)\}/.exec(clause);
  if (braces) {
    for (const raw of braces[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const asMatch = /\bas\s+(\w+)\s*$/.exec(part);
      const local = asMatch ? asMatch[1] : part.replace(/^type\s+/, '').trim();
      const memberTypeOnly = /^type\s+/.test(part);
      push(local, isTypeOnly || memberTypeOnly ? 'type' : undefined);
    }
  }

  // namespace import * as ns
  const ns = /\*\s+as\s+(\w+)/.exec(clause);
  if (ns) push(ns[1], marker);

  return bindings;
}
