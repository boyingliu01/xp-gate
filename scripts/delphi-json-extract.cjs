'use strict';
/**
 * Pull a JSON object out of whatever a model returned.
 *
 * Four layers, each for a shape seen in production: a clean object, one wrapped in
 * a ```json fence, one embedded in prose, and a brace-matched substring. Falling
 * through all four yields a parse error with the raw content preserved -- a caller
 * must be able to tell "no JSON" from "wrong JSON", and the model's own text is
 * the only evidence for the second.
 *
 * Moved out of `delphi-external-review.cjs` to keep that file under its ceiling.
 * Boundary checked first: one function, no dependencies.
 */

// ── JSON extraction (4-layer fallback) ─────────────────────────────────
/** A fenced block, with or without a `json` tag. */
const FENCED_BLOCK = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;

/**
 * The first BALANCED brace run, whatever surrounds it.
 *
 * NOT `/{[\s\S]*}/`: that is greedy and runs to the LAST `}` in the text, so an answer
 * containing two objects produced one span from the first `{` to the second `}` -- not
 * JSON at all, while the first object on its own might have parsed (measured, review
 * MC-01). Quotes are skipped so a brace inside a string does not move the depth.
 */
function firstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const step = braceStep(text, i, quote);
    if (step.skip > 0) i += step.skip;
    quote = step.quote;
    if (step.open) depth += 1;
    if (step.close && (depth -= 1) === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * What one character does to the brace scan.
 *
 * Quotes are honoured because `"}"` is data: closing the object at that brace truncated
 * valid JSON. A backslash inside a string also consumes the next character.
 */
function braceStep(text, i, quote) {
  const ch = text[i];
  if (quote !== null) {
    if (ch === '\\') return { quote, skip: 1, open: false, close: false };
    return { quote: ch === quote ? null : quote, skip: 0, open: false, close: false };
  }
  if (ch === '"' || ch === "'") return { quote: ch, skip: 0, open: false, close: false };
  return { quote: null, skip: 0, open: ch === '{', close: ch === '}' };
}

/**
 * The candidate texts to try, in the order a model's answer is likely to need them.
 *
 * A LADDER rather than a cascade of try/catch blocks: an answer may be bare JSON, a
 * fenced block, or prose with an object embedded, and the four attempts read as one list
 * of what is tried instead of four nested handlers.
 */
function jsonCandidates(trimmed) {
  const fenced = trimmed.match(FENCED_BLOCK);
  return [
    trimmed,
    fenced ? fenced[1].trim() : null,
    firstBalancedObject(trimmed),
  ];
}

/**
 * The first candidate that parses, or undefined.
 *
 * A failed parse is not an error here: it means "try the next shape", and only when
 * EVERY shape fails is there a problem worth reporting.
 */
function firstParsed(candidates) {
  for (const text of candidates) {
    if (text === null) continue;
    try {
      return JSON.parse(text);
    } catch {
      // Try the next shape.
    }
  }
  return undefined;
}

/**
 * Extract the JSON object from a model's response.
 *
 * Returns `{ parse_error: true, raw_content }` when nothing parses -- the RAW content is
 * carried so a caller can log what the model actually said, which is the only way to
 * tell a prompt problem from a transport one.
 */
function extractJsonFromResponse(content) {
  if (!content || typeof content !== 'string') {
    return { parse_error: true, raw_content: String(content || '') };
  }
  const trimmed = content.trim();
  const parsed = firstParsed(jsonCandidates(trimmed));
  return parsed === undefined ? { parse_error: true, raw_content: trimmed } : parsed;
}

module.exports = { extractJsonFromResponse };
