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
/**
 * Estimate how many lines `text` occupies when greedily word-wrapped into lines of at most
 * `charsPerLine` characters — matching how the note renderer breaks on word boundaries.
 *
 * A naive `ceil(length / charsPerLine)` assumes perfect character packing and so under-counts:
 * real word-wrapping wastes the space at the end of each line where the next word doesn't fit.
 * That under-count is what made inserted text boxes too short and clipped their last line.
 * Blank paragraphs (from `\n\n` between combined clips) count as one line each.
 */
export function measureWrappedText(text: string, charsPerLine: number): { lines: number; lastLineChars: number } {
  if (!text) return { lines: 0, lastLineChars: 0 };
  const cpl = Math.max(1, Math.floor(charsPerLine));
  let total = 0;
  let lastCol = 0; // chars on the final line of the whole text
  for (const para of text.split('\n')) {
    const words = para.split(' ').filter(w => w.length > 0);
    if (words.length === 0) { total += 1; lastCol = 0; continue; } // blank line
    let lines = 1;
    let col = 0; // chars used on the current line
    for (const word of words) {
      if (col !== 0 && col + 1 + word.length <= cpl) {
        col += 1 + word.length; // fits after a space
        continue;
      }
      if (col !== 0) { lines += 1; col = 0; } // wrap to a fresh line
      if (word.length <= cpl) {
        col = word.length;
      } else {
        // A single token longer than a line wraps within itself across extra lines.
        const extra = Math.floor((word.length - 1) / cpl);
        lines += extra;
        col = word.length - extra * cpl;
      }
    }
    total += lines;
    lastCol = col;
  }
  return { lines: total, lastLineChars: lastCol };
}

export function countWrappedLines(text: string, charsPerLine: number): number {
  return measureWrappedText(text, charsPerLine).lines;
}

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
