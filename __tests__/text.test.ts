import { splitTextToFit } from '../src/utils/text';

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
