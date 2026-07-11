import { splitTextToFit, countWrappedLines } from '../src/utils/text';

describe('countWrappedLines', () => {
  it('returns 0 for empty text', () => {
    expect(countWrappedLines('', 10)).toBe(0);
  });

  it('counts a short string as one line', () => {
    expect(countWrappedLines('hello world', 40)).toBe(1);
  });

  it('wraps on word boundaries (more lines than naive char-packing)', () => {
    // 5 words of 8 chars ("aaaaaaaa") + spaces = 44 chars. Naive ceil(44/10)=5, but greedy
    // word-wrap fits only one 8-char word per 10-char line → 5 lines here, and for tighter
    // budgets the word-boundary waste shows.
    const text = 'aaaaaaaa bbbbbbbb cccccccc';         // three 8-char words
    // budget 10: each line holds one word (8) — "aaaaaaaa"(8), next needs 8+1+8=17>10 → wrap.
    expect(countWrappedLines(text, 10)).toBe(3);
    // budget 17: "aaaaaaaa bbbbbbbb" = 17 fits, then "cccccccc" wraps → 2 lines.
    expect(countWrappedLines(text, 17)).toBe(2);
  });

  it('never under-counts vs a word-unaware packer for wrappable text', () => {
    const text = 'the quick brown fox jumps over the lazy dog again today';
    const naive = Math.ceil(text.length / 12);
    expect(countWrappedLines(text, 12)).toBeGreaterThanOrEqual(naive);
  });

  it('counts a single over-long token across the lines it fills', () => {
    expect(countWrappedLines('x'.repeat(25), 10)).toBe(3); // 25 chars over 10-wide lines
  });

  it('counts blank paragraphs (from \\n\\n between clips) as one line each', () => {
    expect(countWrappedLines('one\n\ntwo', 40)).toBe(3); // "one", blank, "two"
  });
});

describe('splitTextToFit', () => {
  it('returns the whole text when it fits the budget', () => {
    expect(splitTextToFit('short text', 100)).toEqual(['short text', '']);
  });

  it('returns the whole text when the budget is non-positive', () => {
    expect(splitTextToFit('anything', 0)).toEqual(['anything', '']);
  });

  it('splits at the last sentence boundary within the budget', () => {
    const text = 'First sentence. Second sentence. Third one that overflows the budget.';
    // Budget lands inside the third sentence; should cut after "Second sentence."
    const [chunk, remainder] = splitTextToFit(text, 40);
    expect(chunk).toBe('First sentence. Second sentence.');
    expect(remainder).toBe('Third one that overflows the budget.');
  });

  it('falls back to the last word boundary when no sentence end fits', () => {
    const text = 'alpha beta gamma delta epsilon zeta';
    const [chunk, remainder] = splitTextToFit(text, 20); // no . ! ? in window
    expect(chunk.length).toBeLessThanOrEqual(20);
    // Clean split at a space — no partial word, and rejoining reproduces the text.
    expect(text.startsWith(chunk)).toBe(true);
    expect(`${chunk} ${remainder}`).toBe(text);
    expect(chunk.endsWith(' ')).toBe(false);
    expect(remainder.startsWith(' ')).toBe(false);
  });

  it('hard-cuts a single token longer than the budget so progress is always made', () => {
    const text = 'x'.repeat(50);
    const [chunk, remainder] = splitTextToFit(text, 20);
    expect(chunk).toBe('x'.repeat(20));
    expect(remainder).toBe('x'.repeat(30));
  });

  it('does not split a surrogate pair on a hard cut', () => {
    // 10 emoji (2 UTF-16 code units each = 20 units); budget lands mid-pair at index 5.
    const text = '😀'.repeat(10);
    const [chunk, remainder] = splitTextToFit(text, 5);
    // Neither side should contain a lone surrogate; rejoining reproduces the text.
    expect(chunk + remainder).toBe(text);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(chunk)).toBe(false);
    expect(chunk.length % 2).toBe(0); // whole emoji only
  });

  it('keeps sentence-ending punctuation with the chunk', () => {
    const text = 'Hello world! More text here that goes past the limit.';
    const [chunk, remainder] = splitTextToFit(text, 20);
    expect(chunk).toBe('Hello world!');
    expect(remainder).toBe('More text here that goes past the limit.');
  });
});
