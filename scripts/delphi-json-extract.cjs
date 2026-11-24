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
function extractJsonFromResponse(content) {
  if (!content || typeof content !== 'string') {
    return { parse_error: true, raw_content: String(content || '') };
  }

  const trimmed = content.trim();

  // Layer 1: Direct parse
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // Layer 2: Strip markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* continue */ }
  }

  // Layer 3: Extract first JSON object
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* continue */ }
  }

  // Layer 4: Fallback
  return { parse_error: true, raw_content: trimmed };
}


module.exports = { extractJsonFromResponse };
