/**
 * Class-member scanning for the TypeScript adapter.
 *
 * Extracted from `typescript.ts` to keep that file inside its line budget, and
 * because this is the piece that was wrong: counting members by looking at the
 * character BEFORE a name reported every call site inside a method body as a
 * member. `{ helper(1); }` and `{ async run() { ... }` differ in what follows the
 * name, not in what precedes it -- so depth is what separates them.
 */

/** Words that look like `name(` but are control flow, never members. */
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new',
]);

/** Class body members live one level in: the body string starts AT its `{`. */
const MEMBER_DEPTH = 1;

/**
 * Names of the members declared directly in a class body.
 *
 * Depth-aware rather than prefix-aware: a member declaration sits at brace
 * depth 1 of the body, and a call inside a method sits deeper. Nesting is
 * tracked over the MASKED body, so braces inside strings and comments cannot
 * shift the depth -- prose in a JSDoc line like
 * "three separate events (close / error / timeout)" otherwise reads as
 * `events(` and is counted as a method, as is `unknown` from `(): unknown {`.
 *
 * Arrow-function properties (`handler = () => {}`) carry no `name(` shape and
 * are not counted; they were not counted before either.
 */
export function countTopLevelMembers(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '{') { depth += 1; continue; }
    if (c === '}') { depth -= 1; continue; }
    if (depth !== MEMBER_DEPTH || c !== '(') continue;
    const name = memberNameBefore(body, i);
    if (name && !CONTROL_KEYWORDS.has(name.value)) names.push(name.value);
  }
  return names;
}

/**
 * The identifier immediately before the `(` at `parenIndex`, skipping modifiers
 * (`public`, `static`, `async`, `readonly`, `get`, `set`, `*`).
 *
 * @returns the name and its offset, or null when no identifier precedes the paren.
 */
function memberNameBefore(
  body: string,
  parenIndex: number,
): { value: string; index: number } | null {
  let end = parenIndex;
  while (end > 0 && /\s/.test(body[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[\w$]/.test(body[start - 1])) start -= 1;
  if (start === end) return null;
  return { value: body.substring(start, end), index: start };
}

/**
 * Claim a `name@offset` key once, so overlapping extraction shapes cannot
 * double-count the same declaration.
 */
export function claimMember(seen: Set<string>, name: string, nameIndex: number): boolean {
  const key = `${name}@${nameIndex}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
