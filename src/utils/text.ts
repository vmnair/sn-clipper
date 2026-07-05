// SnClipper/src/utils/text.ts
// Text helpers for laying out inserted clips.

/**
 * Split `text` so the first part fits within `charBudget` characters, preferring a clean
 * boundary. Returns `[chunk, remainder]`:
 *   - If the whole text fits (or the budget is non-positive), returns `[text, '']`.
 *   - Otherwise cuts at the last sentence end (`. ! ?`, optionally followed by a closing
 *     quote/bracket) at/under the budget; failing that, the last whitespace; failing that
 *     (one oversized token), a hard cut at the budget so progress is always made.
 * `chunk` is right-trimmed and `remainder` is left-trimmed so the split point doesn't leave
 * stray spaces.
 */
export function splitTextToFit(text: string, charBudget: number): [string, string] {
  if (charBudget <= 0 || text.length <= charBudget) {
    return [text, ''];
  }

  const window = text.slice(0, charBudget);

  // Prefer the last sentence terminator within the budget.
  const sentenceRe = /[.!?]["'’”)\]]?\s/g;
  let sentenceEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(window)) !== null) {
    sentenceEnd = m.index + m[0].length; // just past the terminator + trailing space
  }
  if (sentenceEnd > 0) {
    return [text.slice(0, sentenceEnd).trimEnd(), text.slice(sentenceEnd).trimStart()];
  }

  // Fall back to the last whitespace within the budget.
  const ws = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'), window.lastIndexOf('\t'));
  if (ws > 0) {
    return [text.slice(0, ws).trimEnd(), text.slice(ws).trimStart()];
  }

  // Single token longer than the budget: hard-cut so we still make progress. Back off by one
  // if the cut would land between a UTF-16 surrogate pair (e.g. an emoji), so we never split
  // a single code point into two broken halves.
  let cut = charBudget;
  const code = text.charCodeAt(cut);
  if (code >= 0xdc00 && code <= 0xdfff && cut > 1) cut -= 1; // low surrogate → cut before the pair
  return [text.slice(0, cut), text.slice(cut)];
}
