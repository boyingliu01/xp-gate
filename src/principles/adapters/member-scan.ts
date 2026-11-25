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
    const stepped = stepMemberDepth(c, depth);
    if (stepped.consumed) { depth = stepped.depth; continue; }
    if (!isMemberParen(c, depth)) continue;
    const name = memberNameBefore(body, i);
    if (isMemberName(name)) names.push(name.value);
  }
  return names;
}

/**
 * Apply a brace character to the depth.
 *
 * @returns the new depth, and whether this character was a brace at all
 */
function stepMemberDepth(c: string, depth: number): { depth: number; consumed: boolean } {
  if (c === '{') return { depth: depth + 1, consumed: true };
  if (c === '}') return { depth: depth - 1, consumed: true };
  return { depth, consumed: false };
}

/**
 * Whether a `(` at this depth opens a MEMBER's parameter list.
 *
 * Only at the member depth: a `(` deeper in is a call inside a body, and one shallower
 * belongs to the enclosing declaration.
 */
function isMemberParen(c: string, depth: number): boolean {
  return c === '(' && depth === MEMBER_DEPTH;
}

/**
 * Whether this name is a MEMBER rather than a control keyword.
 *
 * `if (`, `for (` and `while (` sit at the same depth as a method and would otherwise be
 * collected as members.
 */
function isMemberName(name: { value: string } | null): name is { value: string; index: number } {
  return Boolean(name) && !CONTROL_KEYWORDS.has((name as { value: string }).value);
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
  const end = skipBackOverSpace(body, parenIndex);
  const start = scanBackOverIdentifier(body, end);
  return start === end ? null : { value: body.substring(start, end), index: start };
}

/** The offset before the run of whitespace ending at `from`. */
function skipBackOverSpace(body: string, from: number): number {
  let end = from;
  while (end > 0 && /\s/.test(body[end - 1])) end -= 1;
  return end;
}

/** The offset before the run of identifier characters ending at `from`. */
function scanBackOverIdentifier(body: string, from: number): number {
  let start = from;
  while (start > 0 && /[\w$]/.test(body[start - 1])) start -= 1;
  return start;
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
