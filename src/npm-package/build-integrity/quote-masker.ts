/**
 * Quote/comment masker for Gate 10's import scanner (#759).
 *
 * Extracted from `gate-10.ts` when that file crossed the 1050-line limit that
 * Gate 4's `clean-code.large-file` rule enforces. The masker is a self-contained
 * state machine over a string, so the split is along a real seam rather than an
 * arbitrary line count: nothing here knows about imports, files or gates.
 */

/**
 * Replace quotes/comments that are not code-level delimiters with a sentinel.
 *
 * Walks the source tracking whether it is currently inside a string, template
 * literal, line comment or block comment. Creatures encountered at the top level
 * (depth 0) are left ALONE — those are real delimiters and the scanner needs
 * them. Anything encountered while already inside a literal or comment is text,
 * and every quote-like character in there becomes `QUOTE_SENTINEL` so the
 * import regexes cannot close a match against it.
 *
 * Length is preserved exactly (one character in, one character out), newlines
 * included, so line/column positions in the masked source match the original.
 *
 * Not a parser: it does not understand regex literals. That limitation can only
 * cause a MISS (a region left unmasked), never a false violation, and pulling a
 * real tokenizer into a check with a sub-second budget is not worth it (#640).
 * If a regex literal ever produces a phantom violation, that is the signal to
 * replace this with a proper lexer.
 */
const QUOTE_SENTINEL = '\u0000';

/** Mutable state threaded through the masking handlers. */
interface MaskState {
  readonly content: string;
  readonly out: string[];
  i: number;
  mode: MaskMode;
  /** One brace depth per open `${...}`; a stack, because interpolations nest. */
  interpolationDepths: number[];
}

/** What the masker is currently inside of. `code` is depth 0. */
type MaskMode = 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment';

/** The delimiter that closes a plain literal mode. */
function literalCloser(mode: MaskMode): string {
  if (mode === 'single') return "'";
  if (mode === 'double') return '"';
  return '`';
}

/** Emit one character, keeping newlines so line numbers stay aligned. */
function emitText(state: MaskState, ch: string): void {
  state.out.push(ch === '\n' ? '\n' : ' ');
}

/** Handle a character while inside a `//` comment. */
function stepLineComment(state: MaskState): void {
  const ch = state.content[state.i];
  if (ch === '\n') {
    state.out.push('\n');
    state.mode = 'code';
  } else {
    state.out.push(' ');
  }
  state.i += 1;
}

/** Handle a character while inside a `/* ... *\/` comment. */
function stepBlockComment(state: MaskState): void {
  const { content, i } = state;
  if (content[i] === '*' && content[i + 1] === '/') {
    state.out.push('  ');
    state.i += 2;
    state.mode = 'code';
    return;
  }
  emitText(state, content[i]);
  state.i += 1;
}

/**
 * Handle an escape sequence inside a literal: both characters are text.
 *
 * The backslash is emitted as a space and the escaped character as the quote
 * sentinel, so neither slot can be read as a quote.
 *
 * A NEWLINE must survive here. `\` immediately followed by a newline is a legal
 * line continuation inside a string literal, and emitting a space for it
 * deleted a line from the masked source — every import reported after that
 * point then carried a line number one too low. Measured: a two-line string
 * followed by an import on line 3 reported `line: 2`. Line numbers are the one
 * thing the masker promises to preserve, so this is a correctness bug, not a
 * cosmetic one.
 *
 * Emitting the sentinel TWICE (one per character) is a provably equivalent
 * mutation — a mutation run kept every test green. Either way neither slot
 * equals a quote, so the state machine cannot be closed early, which is the
 * only property that matters. Recorded so the next reader does not "fix" one
 * form into the other and believe it changed something.
 */
function stepEscape(state: MaskState): void {
  const escaped = state.content[state.i + 1];
  state.out.push(' ');
  // A trailing backslash at EOF (a truncated file, or one that simply ends
  // mid-escape) used to push TWO characters while advancing past a ONE-char
  // remainder, so the output came out one character LONGER than the input —
  // breaking the length invariant every line number depends on. Measured on
  // `const e = 'a<BS>` (13 chars) producing 14. Push only what exists.
  if (escaped !== undefined) {
    state.out.push(escaped === '\n' ? '\n' : QUOTE_SENTINEL);
  }
  state.i += 2;
}

/** Handle a character inside a literal or template. Returns false when not consumed. */
function stepLiteral(state: MaskState): boolean {
  const { content, i, mode } = state;
  const ch = content[i];

  if (ch === '\\') {
    stepEscape(state);
    return true;
  }
  if (ch === literalCloser(mode)) {
    // Closing delimiter of a real literal: keep it, back to code.
    state.out.push(ch);
    state.i += 1;
    state.mode = 'code';
    return true;
  }
  if (mode === 'template' && ch === '$' && content[i + 1] === '{') {
    // Interpolation body is code again. Emit `$` and `{` as themselves and push
    // a fresh brace depth for the matching `}`.
    //
    // A single integer counter CANNOT do this: an interpolation may itself open
    // a nested template whose interpolation must return to the INNER template
    // when it closes, not to code. Overwriting the counter on entry made the
    // inner `}` look like the close of the outer one, so `` `${`${x}`}` `` left
    // the masker in template mode and every real import after it was masked —
    // measured before this was a stack: `extractImports` returned `[]` for a
    // file whose only import was perfectly valid.
    state.out.push('$', '{');
    state.i += 2;
    state.interpolationDepths.push(0);
    state.mode = 'code';
    return true;
  }
  // Text: a quote-like character here must not be usable by the regexes.
  const isQuoteLike = ch === "'" || ch === '"' || ch === '`';
  state.out.push(isQuoteLike ? QUOTE_SENTINEL : ch);
  state.i += 1;
  return true;
}

/** Handle a `/` that may open a comment. Returns false when it does not. */
function stepCommentOpen(state: MaskState): boolean {
  const { content, i } = state;
  if (content[i] !== '/') return false;
  const kind = content[i + 1];
  if (kind === '/') {
    state.out.push('  ');
    state.i += 2;
    state.mode = 'line-comment';
    return true;
  }
  if (kind === '*') {
    state.out.push('  ');
    state.i += 2;
    state.mode = 'block-comment';
    return true;
  }
  return false;
}

/** Handle a quote that opens a literal. Returns false when it does not. */
function stepQuoteOpen(state: MaskState): boolean {
  const ch = state.content[state.i];
  const opened: MaskMode | null =
    ch === "'" ? 'single' : ch === '"' ? 'double' : ch === '`' ? 'template' : null;
  if (opened === null) return false;
  state.out.push(ch);
  state.i += 1;
  state.mode = opened;
  return true;
}

/**
 * Track `{`/`}` while inside a `${ ... }` interpolation. Returns true when the
 * interpolation closed and the masker went back to template text.
 */
function stepInterpolationBrace(state: MaskState): boolean {
  const stack = state.interpolationDepths;
  // Depth 0 means we are not inside any interpolation at all.
  if (stack.length === 0) return false;
  const ch = state.content[state.i];
  if (ch === '{') {
    stack[stack.length - 1] += 1;
    return false;
  }
  if (ch !== '}') return false;
  if (stack[stack.length - 1] > 0) {
    stack[stack.length - 1] -= 1;
    return false;
  }
  // This `}` closes the innermost interpolation: resume the template that owns
  // it. Popping (rather than zeroing a counter) is what makes nesting correct.
  stack.pop();
  state.out.push('}');
  state.i += 1;
  state.mode = 'template';
  return true;
}

/** Handle one character in code (depth 0). */
function stepCode(state: MaskState): void {
  if (stepCommentOpen(state) || stepQuoteOpen(state)) return;
  if (stepInterpolationBrace(state)) return;
  state.out.push(state.content[state.i]);
  state.i += 1;
}

/** Handlers by mode; `code` is the fallthrough. */
const MASK_STEPS: Record<MaskMode, (state: MaskState) => void> = {
  code: stepCode,
  single: (s) => void stepLiteral(s),
  double: (s) => void stepLiteral(s),
  template: (s) => void stepLiteral(s),
  'line-comment': stepLineComment,
  'block-comment': stepBlockComment,
};

/**
 * Blank out everything that is not code, keeping every character position in
 * place: string/template bodies and comments become spaces (newlines survive),
 * and every quote-like character inside them becomes `QUOTE_SENTINEL`. The
 * import regexes then cannot match text that only looks like an import.
 */
export function maskTextQuotes(content: string): string {
  const state: MaskState = {
    content,
    out: [],
    i: 0,
    mode: 'code',
    interpolationDepths: [],
  };
  while (state.i < content.length) {
    MASK_STEPS[state.mode](state);
  }
  return state.out.join('');
}

/**
 * Test-only view of the masker.
 *
 * `maskTextQuotes` is the only new algorithm in #759 and it makes three
 * properties that `extractImports` can honour only by accident: output length
 * equals input length, the newline count is unchanged (line numbers come from
 * it), and no raw quote survives inside masked text in a way the import regexes
 * could use. Asserting those directly is what turns the masker's contract into
 * a fail-fast check instead of a behaviour inferred from a dozen indirect
 * import assertions. Kept behind an explicit name so production callers do not
 * reach for it.
 */
export function maskTextQuotesForTest(content: string): string {
  return maskTextQuotes(content);
}
