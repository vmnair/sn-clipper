jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItem: jest.fn(async (key: string) => {
      return store[key] || null;
    }),
    clear: jest.fn(async () => {
      store = {};
    }),
  };
});

import { IndexService } from '../src/services/IndexService';
import { StorageService } from '../src/services/StorageService';
import { PluginFileAPI, PluginNoteAPI, PluginCommAPI } from 'sn-plugin-lib';

let mockReaderPage = 0;

jest.mock('sn-plugin-lib', () => ({
  PluginFileAPI: {
    getNoteTotalPageNum: jest.fn().mockResolvedValue({ success: true, result: 5 }),
    getTitles: jest.fn().mockResolvedValue([]),
    getElements: jest.fn().mockResolvedValue({ success: true, result: [] }),
    getPageSize: jest.fn().mockResolvedValue({ success: true, result: { width: 1404, height: 1872 } }),
    replaceElements: jest.fn().mockResolvedValue({ success: true }),
    deleteElements: jest.fn().mockResolvedValue({ success: true }),
    generateNoteTemplatePng: jest.fn().mockResolvedValue({ success: true, result: true }),
    insertNotePage: jest.fn().mockResolvedValue({ success: true, result: true }),
  },
  PluginNoteAPI: {
    saveCurrentNote: jest.fn().mockResolvedValue({ success: true }),
    insertText: jest.fn().mockResolvedValue({ success: true }),
    insertTextLink: jest.fn().mockResolvedValue({ success: true }),
  },
  PluginCommAPI: {
    // Track the page like a real reader: pollForTargetPage waits for getCurrentPageNum to
    // report the page jumpToPage was asked for. A fixed 0 here never settles, so the
    // continuation path would just burn the whole settle timeout.
    getCurrentPageNum: jest.fn().mockImplementation(async () => ({ success: true, result: mockReaderPage })),
    jumpToPage: jest.fn().mockImplementation(async (p: number) => { mockReaderPage = p; return { success: true, result: true }; }),
    reloadFile: jest.fn().mockResolvedValue({ success: true }),
    recognizeElements: jest.fn().mockResolvedValue({ success: true, result: '' }),
  },
  PluginManager: {
    getPluginDirPath: jest.fn().mockResolvedValue('/sdcard/.data/plugin'),
  },
  FileUtils: {
    deleteFile: jest.fn().mockResolvedValue(true),
  },
}));

describe('IndexService', () => {
  beforeEach(async () => {
    mockReaderPage = 0;
    jest.clearAllMocks();
    await require('@react-native-async-storage/async-storage').clear();
    // Multi-page ToC ships OFF (design review 2026-09-04). Reset per test so a case that
    // opts into the descoped machinery cannot leak the flag into the next one.
    IndexService.resetTocPagination();
  });

  describe('scanHeadings — adaptive style ranking', () => {
    it('ranks all headings as Level 1 when only 1 style is present', async () => {
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Chapter 1', page: 1, style: 1, Y: 100, X: 50 },
        { title: 'Chapter 2', page: 2, style: 1, Y: 100, X: 50 },
        { title: 'Chapter 3', page: 3, style: 1, Y: 100, X: 50 },
      ]);

      const headings = await IndexService.scanHeadings('/sdcard/Notes/Test.note');
      expect(headings).toHaveLength(3);
      expect(headings[0].level).toBe(1);
      expect(headings[1].level).toBe(1);
      expect(headings[2].level).toBe(1);
    });

    it('maps styles adaptively in order of appearance (first seen = Level 1, second = Level 2)', async () => {
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Main Topic', page: 1, style: 1, Y: 100, X: 50 },
        { title: 'Sub Topic A', page: 1, style: 2, Y: 300, X: 50 },
        { title: 'Sub-Sub Topic', page: 2, style: 4, Y: 150, X: 50 },
        { title: 'Sub Topic B', page: 2, style: 2, Y: 400, X: 50 },
      ]);

      const headings = await IndexService.scanHeadings('/sdcard/Notes/Test.note');
      expect(headings).toHaveLength(4);
      expect(headings[0].title).toBe('Main Topic');
      expect(headings[0].level).toBe(1);
      expect(headings[1].title).toBe('Sub Topic A');
      expect(headings[1].level).toBe(2);
      expect(headings[2].title).toBe('Sub-Sub Topic');
      expect(headings[2].level).toBe(3);
      expect(headings[3].title).toBe('Sub Topic B');
      expect(headings[3].level).toBe(2);
    });

    it('handles out-of-order styles adaptively (first style encountered becomes Level 1)', async () => {
      // Style 3 appears first on page 1, style 1 appears second on page 2
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Intro (Style 3)', page: 1, style: 3, Y: 100, X: 50 },
        { title: 'Section (Style 1)', page: 2, style: 1, Y: 100, X: 50 },
      ]);

      const headings = await IndexService.scanHeadings('/sdcard/Notes/Test.note');
      expect(headings).toHaveLength(2);
      expect(headings[0].level).toBe(1); // style 3 is level 1
      expect(headings[1].level).toBe(2); // style 1 is level 2
    });
  });

  describe('scanHeadings — hierarchical decimal numbering labels', () => {
    it('produces plain 1., 2., 3. labels for single-style notes', async () => {
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'First Chapter', page: 1, style: 1, Y: 100, X: 50 },
        { title: 'Second Chapter', page: 2, style: 1, Y: 100, X: 50 },
        { title: 'Third Chapter', page: 3, style: 1, Y: 100, X: 50 },
      ]);

      const headings = await IndexService.scanHeadings('/sdcard/Notes/Test.note');
      expect(headings).toHaveLength(3);
      expect(headings[0].numberLabel).toBe('1.');
      expect(headings[1].numberLabel).toBe('2.');
      expect(headings[2].numberLabel).toBe('3.');
    });

    it('generates multi-level decimal numbers (1., 1.1, 1.2, 2., 2.1)', async () => {
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Notes on Git', page: 1, style: 1, Y: 100, X: 50 },
        { title: 'Git Merge', page: 3, style: 2, Y: 100, X: 50 },
        { title: 'GitHub Actions Sync', page: 4, style: 2, Y: 200, X: 50 },
        { title: 'Next chapter', page: 5, style: 1, Y: 100, X: 50 },
        { title: 'Sub topic', page: 6, style: 2, Y: 100, X: 50 },
      ]);

      const headings = await IndexService.scanHeadings('/sdcard/Notes/Test.note');
      expect(headings).toHaveLength(5);
      expect(headings[0].numberLabel).toBe('1.');
      expect(headings[1].numberLabel).toBe('1.1');
      expect(headings[2].numberLabel).toBe('1.2');
      expect(headings[3].numberLabel).toBe('2.');
      expect(headings[4].numberLabel).toBe('2.1');
    });

    it('resets deeper counters when a higher-level heading appears (1., 1.1, 1.1.1, 2., 2.1)', async () => {
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Root 1', page: 1, style: 1, Y: 100, X: 50 },
        { title: 'Child 1.1', page: 1, style: 2, Y: 200, X: 50 },
        { title: 'Grandchild 1.1.1', page: 1, style: 3, Y: 300, X: 50 },
        { title: 'Root 2', page: 2, style: 1, Y: 100, X: 50 },
        { title: 'Child 2.1', page: 2, style: 2, Y: 200, X: 50 },
      ]);

      const headings = await IndexService.scanHeadings('/sdcard/Notes/Test.note');
      expect(headings).toHaveLength(5);
      expect(headings[0].numberLabel).toBe('1.');
      expect(headings[1].numberLabel).toBe('1.1');
      expect(headings[2].numberLabel).toBe('1.1.1');
      expect(headings[3].numberLabel).toBe('2.');
      expect(headings[4].numberLabel).toBe('2.1');
      headings.forEach(h => expect(h.numberLabel).not.toContain('..'));
    });

    it('clamps level skips so deep styles under level-1 render 2.1 instead of 2..1 (Fix Round)', async () => {
      // Style 1 (level 1), Style 2 (level 2), Style 3 (level 3), Style 4 (level 4)
      // On Page 2, a Style 3 heading appears directly under Root 2 without any Style 2 in between
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Root 1', page: 1, style: 1, Y: 100, X: 50 },
        { title: 'Child 1.1', page: 1, style: 2, Y: 200, X: 50 },
        { title: 'Grandchild 1.1.1', page: 1, style: 3, Y: 300, X: 50 },
        { title: 'Root 2', page: 2, style: 1, Y: 100, X: 50 },
        { title: 'Deep Child under Root 2 (style 3 directly)', page: 2, style: 3, Y: 200, X: 50 },
        { title: 'Deapest Child (style 4 directly)', page: 2, style: 4, Y: 300, X: 50 },
      ]);

      const headings = await IndexService.scanHeadings('/sdcard/Notes/Test.note');
      expect(headings).toHaveLength(6);
      expect(headings[0].numberLabel).toBe('1.');
      expect(headings[1].numberLabel).toBe('1.1');
      expect(headings[2].numberLabel).toBe('1.1.1');
      expect(headings[3].numberLabel).toBe('2.');
      // Level 3 clamped to 2 -> 2.1 (never 2..1)
      expect(headings[4].numberLabel).toBe('2.1');
      expect(headings[4].level).toBe(2);
      // Level 4 clamped to 3 -> 2.1.1 (never 2..1.1)
      expect(headings[5].numberLabel).toBe('2.1.1');
      expect(headings[5].level).toBe(3);

      // Strict assertion: NO numberLabel ever contains '..'
      headings.forEach(h => {
        expect(h.numberLabel).not.toContain('..');
      });
    });
  });

  describe('generateTocPage — layout indentation and error handling', () => {
    it('applies numberLabel prefix and level-based indentation to title text insertion', async () => {
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Top Level', page: 1, style: 1, Y: 100, X: 50 },
        { title: 'Indented Sublevel', page: 2, style: 2, Y: 100, X: 50 },
      ]);

      const result = await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36);
      expect(result.success).toBe(true);

      const insertTextCalls = (PluginNoteAPI.insertText as jest.Mock).mock.calls;
      // Header, rule, subtitle are the first 3 calls; row 0 is call 3, row 1 is call 4
      const row0 = insertTextCalls.find((c: any) => c[0].textContentFull.includes('Top Level'));
      const row1 = insertTextCalls.find((c: any) => c[0].textContentFull.includes('Indented Sublevel'));

      expect(row0).toBeTruthy();
      expect(row0[0].textContentFull).toMatch(/^1\.\s+Top Level/);
      expect(row1).toBeTruthy();
      expect(row1[0].textContentFull).toMatch(/^1\.1\s+Indented Sublevel/);
      // Level 2 left margin should be greater than Level 1 left margin
      expect(row1[0].textRect.left).toBeGreaterThan(row0[0].textRect.left);
    });

    // ---- multi-page ToC (item 9) --------------------------------------------------
    // rowsPerPage on a 1872-tall page at font 36 is well under 60, so 60 headings force
    // pagination. Each helper below builds however many headings a case needs.
    const manyHeadings = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ title: `Section ${i + 1}`, page: i + 2, style: 1, Y: 100, X: 50 }));

    it('asks once for the shortfall and creates the pages when confirmed', async () => {
      // Exercises the pagination machinery, which is descoped for 0.3.0 but kept
      // behind TOC_PAGINATION and must stay proven for the day it is re-enabled.
      IndexService.setTocPaginationEnabled(true);
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(60));
      // Page 0 is the blank ToC target; every later page has content, so none can be
      // reused and the shortfall is real. totalPages stays large enough for the scan.
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0 ? { success: true, result: [] } : { success: true, result: [{ type: 0 }] }
      ));
      const onNeedPages = jest.fn().mockResolvedValue(true);

      const result = await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36, undefined, onNeedPages);

      expect(result.success).toBe(true);
      // One dialog for the whole run, not one per page.
      expect(onNeedPages).toHaveBeenCalledTimes(1);
      const asked = onNeedPages.mock.calls[0][0];
      expect(asked).toBeGreaterThan(0);
      // A page is created per page asked for, and the template is a rendered PNG path --
      // a style name fails with 802.
      expect(PluginFileAPI.insertNotePage).toHaveBeenCalledTimes(asked);
      expect(PluginFileAPI.generateNoteTemplatePng).toHaveBeenCalled();
      const tplArg = (PluginFileAPI.insertNotePage as jest.Mock).mock.calls[0][0].template;
      expect(tplArg).toMatch(/\.png$/);
      expect(tplArg).not.toMatch(/^style_/);
    });

    it('writes what fits and says so when the user declines', async () => {
      // Exercises the pagination machinery, which is descoped for 0.3.0 but kept
      // behind TOC_PAGINATION and must stay proven for the day it is re-enabled.
      IndexService.setTocPaginationEnabled(true);
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(60));
      // Page 0 is the blank ToC target; every later page has content, so none can be
      // reused and the shortfall is real. totalPages stays large enough for the scan.
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0 ? { success: true, result: [] } : { success: true, result: [{ type: 0 }] }
      ));
      const onNeedPages = jest.fn().mockResolvedValue(false);

      const result = await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36, undefined, onNeedPages);

      // Declining never fails the build.
      expect(result.success).toBe(true);
      expect(PluginFileAPI.insertNotePage).not.toHaveBeenCalled();
      const texts = (PluginNoteAPI.insertText as jest.Mock).mock.calls.map((c: any) => c[0].textContentFull);
      expect(texts.some((t: string) => /^Showing first \d+ of 60 headings$/.test(t))).toBe(true);
      expect(result.message).toMatch(/showing first \d+ of 60 headings/i);
    });

    it('never asks when the headings fit on the ToC page', async () => {
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(3));
      const onNeedPages = jest.fn().mockResolvedValue(true);

      await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36, undefined, onNeedPages);

      expect(onNeedPages).not.toHaveBeenCalled();
      expect(PluginFileAPI.insertNotePage).not.toHaveBeenCalled();
    });

    it('shifts heading page references by the number of pages it inserted', async () => {
      // Exercises the pagination machinery, which is descoped for 0.3.0 but kept
      // behind TOC_PAGINATION and must stay proven for the day it is re-enabled.
      IndexService.setTocPaginationEnabled(true);
      // Inserting ToC continuation pages pushes every later page down. Without the shift
      // every row would name -- and link to -- a page one short of the real one.
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(60));
      // Page 0 is the blank ToC target; every later page has content, so none can be
      // reused and the shortfall is real. totalPages stays large enough for the scan.
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0 ? { success: true, result: [] } : { success: true, result: [{ type: 0 }] }
      ));
      const onNeedPages = jest.fn().mockResolvedValue(true);

      const result = await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36, undefined, onNeedPages);
      const created = (PluginFileAPI.insertNotePage as jest.Mock).mock.calls.length;
      expect(created).toBeGreaterThan(0);

      // Section 1 sits on raw page 2, which scanHeadings reports as display page 3
      // (pageDisplay = rawPg + 1). After inserting `created` pages it must read 3 + created.
      const first = (result.headings || []).find((h: any) => h.title === 'Section 1');
      expect(first?.page).toBe(3 + created);
      const pageNumTexts = (PluginNoteAPI.insertText as jest.Mock).mock.calls
        .map((c: any) => c[0].textContentFull)
        .filter((t: string) => /^p\. \d+$/.test(t));
      expect(pageNumTexts).toContain(`p. ${3 + created}`);
    });

    it('clears a ToC that spans several pages so a shrinking refresh leaves nothing stale', async () => {
      // Pages 0 and 1 both hold ToC; the refreshed ToC is short enough for one page.
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        (p === 0 || p === 1)
          ? { success: true, result: [{ textContentFull: 'TABLE OF CONTENTS' }] }
          : { success: true, result: [] }
      ));
      (PluginFileAPI.getNoteTotalPageNum as jest.Mock).mockResolvedValue({ success: true, result: 5 });
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(2));

      await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36);

      const clearedPages = (PluginFileAPI.replaceElements as jest.Mock).mock.calls.map((c: any) => c[1]);
      expect(clearedPages).toContain(0);
      expect(clearedPages).toContain(1); // the stale trailing ToC page
    });

    it('reads every page it needs BEFORE the first write, and never after', async () => {
      // Exercises the pagination machinery, which is descoped for 0.3.0 but kept
      // behind TOC_PAGINATION and must stay proven for the day it is re-enabled.
      IndexService.setTocPaginationEnabled(true);
      // The invariant behind review 2026-09-03b decision 1. On device, getElements serves a
      // stale layout for any non-current page once something has been written, so a read
      // taken after a write cannot be trusted to decide anything. Everything that informs a
      // decision -- the target page, reusable pages, pages to clear -- must be read first.
      const order: string[] = [];
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(60));
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => {
        order.push(`read:${p}`);
        return { success: true, result: [] };
      });
      (PluginFileAPI.replaceElements as jest.Mock).mockImplementation(async () => {
        order.push('write:replaceElements'); return { success: true };
      });
      (PluginFileAPI.insertNotePage as jest.Mock).mockImplementation(async () => {
        order.push('write:insertNotePage'); return { success: true, result: true };
      });
      (PluginNoteAPI.insertText as jest.Mock).mockImplementation(async () => {
        order.push('write:insertText'); return { success: true };
      });

      await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36, undefined, async () => true);

      const firstWrite = order.findIndex((o) => o.startsWith('write:'));
      const lastRead = order.reduce((acc, o, i) => (o.startsWith('read:') ? i : acc), -1);
      expect(firstWrite).toBeGreaterThan(-1); // it did write something
      expect(lastRead).toBeGreaterThan(-1);   // and it did read something
      expect(lastRead).toBeLessThan(firstWrite);
    });

    it('clears a stale ToC page that sits BEYOND user content, without writing past it', async () => {
      // Review 2026-09-03c Q1. Page 0 = old ToC, page 1 = the user's own page, page 2 = a
      // stale continuation page from a previous longer ToC. The stale page must still be
      // cleared -- it carries live-looking jump links with wrong page numbers -- but
      // nothing may be written past page 1.
      const toc = [{ textContentFull: 'TABLE OF CONTENTS' }];
      const userPage = [{ type: 0, maxY: 500 }];
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => {
        if (p === 0) return { success: true, result: toc };
        if (p === 1) return { success: true, result: userPage };
        if (p === 2) return { success: true, result: toc };
        return { success: true, result: [] };
      });
      (PluginFileAPI.getNoteTotalPageNum as jest.Mock).mockResolvedValue({ success: true, result: 5 });
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(60));

      await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36, undefined, async () => false);

      const cleared = (PluginFileAPI.replaceElements as jest.Mock).mock.calls.map((c: any) => c[1]);
      expect(cleared).toContain(0); // the ToC being refreshed
      expect(cleared).toContain(2); // the stale continuation page beyond the user's page
      expect(cleared).not.toContain(1); // never the user's page
    });

    it('refuses a target page that mixes ToC rows with user content, and touches nothing', async () => {
      // Review 2026-09-03c Q2. Previously startHasContent was false whenever a ToC was
      // present, so the clear removed the user's elements along with our rows.
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0
          ? { success: true, result: [{ textContentFull: 'TABLE OF CONTENTS' }, { type: 0, maxY: 900 }] }
          : { success: true, result: [] }
      ));
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(3));

      const result = await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36);

      expect(result.success).toBe(false);
      expect(result.needsBlankPage).toBe(true);
      expect(result.message).toMatch(/also contains your own content/i);
      // Nothing was deleted or written.
      expect(PluginFileAPI.replaceElements).not.toHaveBeenCalled();
      expect(PluginFileAPI.deleteElements).not.toHaveBeenCalled();
      expect(PluginNoteAPI.insertText).not.toHaveBeenCalled();
    });

    // ---- 0.3.0 descope: one page, no page transition (design review 2026-09-04) --------
    it('writes ONE page and the footer instead of paginating, with the flag off', async () => {
      // The shipped default. A ToC that would need a second page must never raise the
      // dialog, never call insertNotePage, and never navigate the reader mid-write — that
      // navigation is what raced the firmware renderer into a heap-corruption crash.
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(60));
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0 ? { success: true, result: [] } : { success: true, result: [{ type: 0 }] }
      ));
      const onNeedPages = jest.fn().mockResolvedValue(true);

      const result = await IndexService.generateTocPage('/sdcard/Notes/Test.note', 36, undefined, onNeedPages);

      expect(result.success).toBe(true);
      expect(onNeedPages).not.toHaveBeenCalled();
      expect(PluginFileAPI.insertNotePage).not.toHaveBeenCalled();
      // No page transition: the reader is never moved while writing.
      expect(PluginCommAPI.jumpToPage).not.toHaveBeenCalled();
      // Only the first page's header is written — no '(cont.)' page.
      const texts = (PluginNoteAPI.insertText as jest.Mock).mock.calls.map((c: any) => c[0].textContentFull);
      expect(texts.filter((t: string) => /^TABLE OF CONTENTS/.test(t))).toHaveLength(1);
      expect(texts.some((t: string) => /^TABLE OF CONTENTS \(cont\.\)$/.test(t))).toBe(false);
      // ...and the overflow is reported honestly.
      expect(texts.some((t: string) => /^Showing first \d+ of 60 headings$/.test(t))).toBe(true);
      // The old "add a page, then Refresh for the rest" advice would be a lie now.
      expect(result.message).not.toMatch(/add a page/i);
      expect(result.message).toMatch(/one page is the limit/i);
    });

    // ---- §5: page-level classification of our own ToC pages ---------------------------
    // Every element below is one this plugin writes. `isTocElement` only ever matched the
    // header, so each ROW counted as user content and the mixed-page guard refused every
    // refresh on device (device matrix 2026-09-04 §5).
    const ourTocPage = (notePath: string) => ([
      { textContentFull: 'TABLE OF CONTENTS' },
      { textContentFull: 'Test  ·  Generated 9/4/2026, 9:57 AM' }, // subtitle
      { textContentFull: '1. Chapter One ...........................' }, // title + dot leader
      { textContentFull: 'p. 3' }, // page-number column
      { showText: '↗', fullText: '↗', destPath: notePath }, // jump link
      { textContentFull: 'Showing first 21 of 24 headings' }, // truncation footer
    ]);

    it('classifies a real ToC page — header, subtitle, rows, links, footer — as ours', async () => {
      const notePath = '/sdcard/Notes/Test.note';
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0 ? { success: true, result: ourTocPage(notePath) } : { success: true, result: [] }
      ));
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(3));

      const result = await IndexService.generateTocPage(notePath, 36);

      // It refreshes in place rather than refusing.
      expect(result.success).toBe(true);
      expect(result.needsBlankPage).toBeUndefined();
      expect((PluginFileAPI.replaceElements as jest.Mock).mock.calls.map((c: any) => c[1])).toContain(0);
    });

    it('refuses the same page once the user adds a single handwritten stroke', async () => {
      const notePath = '/sdcard/Notes/Test.note';
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0
          ? { success: true, result: [...ourTocPage(notePath), { type: 0, maxY: 900 }] }
          : { success: true, result: [] }
      ));
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(3));

      const result = await IndexService.generateTocPage(notePath, 36);

      expect(result.success).toBe(false);
      expect(result.needsBlankPage).toBe(true);
      expect(result.message).toMatch(/also contains your own content/i);
      expect(PluginFileAPI.replaceElements).not.toHaveBeenCalled();
      expect(PluginFileAPI.deleteElements).not.toHaveBeenCalled();
      expect(PluginNoteAPI.insertText).not.toHaveBeenCalled();
    });

    it('does not claim an arrow link that points at a different note', async () => {
      // The ↗ shape alone is not proof of authorship; the destination has to be this note.
      const notePath = '/sdcard/Notes/Test.note';
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0
          ? { success: true, result: [
              { textContentFull: 'TABLE OF CONTENTS' },
              { showText: '↗', fullText: '↗', destPath: '/sdcard/Notes/SomeOther.note' },
            ] }
          : { success: true, result: [] }
      ));
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(3));

      const result = await IndexService.generateTocPage(notePath, 36);

      expect(result.success).toBe(false);
      expect(result.needsBlankPage).toBe(true);
    });

    // ---- §7: silent heading loss becomes a choice --------------------------------------
    it('asks before replacing a ToC when the scan finds fewer headings than the last build', async () => {
      const notePath = '/sdcard/Notes/Test.note';
      await StorageService.setTocLastBuild(notePath, 24);
      (PluginFileAPI.getElements as jest.Mock).mockImplementation(async (p: number) => (
        p === 0 ? { success: true, result: ourTocPage(notePath) } : { success: true, result: [] }
      ));
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(16));
      const onFewerHeadings = jest.fn().mockResolvedValue(false);

      const result = await IndexService.generateTocPage(notePath, 36, undefined, undefined, onFewerHeadings);

      expect(onFewerHeadings).toHaveBeenCalledWith(16, 24);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/kept the existing/i);
      // Declining must leave the existing ToC completely untouched.
      expect(PluginFileAPI.replaceElements).not.toHaveBeenCalled();
      expect(PluginNoteAPI.insertText).not.toHaveBeenCalled();
    });

    it('does not ask when the scan finds as many headings as before', async () => {
      const notePath = '/sdcard/Notes/Test.note';
      await StorageService.setTocLastBuild(notePath, 3);
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(3));
      const onFewerHeadings = jest.fn().mockResolvedValue(true);

      await IndexService.generateTocPage(notePath, 36, undefined, undefined, onFewerHeadings);

      expect(onFewerHeadings).not.toHaveBeenCalled();
    });

    it('records the scanned heading count, not the number that fitted on the page', async () => {
      // A one-page cap is a display limit. Recording the truncated count would make the
      // next build compare against the wrong baseline and never warn.
      const notePath = '/sdcard/Notes/Test.note';
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue(manyHeadings(60));

      const result = await IndexService.generateTocPage(notePath, 36);

      expect(result.success).toBe(true);
      expect(await StorageService.getTocLastBuild(notePath)).toMatchObject({ count: 60 });
    });

    it('returns permission error when replaceElements returns code 1501 during ToC refresh', async () => {
      // Setup existing ToC header on page 0 so it enters clearToC refresh path
      (PluginFileAPI.getElements as jest.Mock).mockResolvedValue({
        success: true,
        result: [{ textContentFull: 'TABLE OF CONTENTS' }],
      });
      (PluginFileAPI.getTitles as jest.Mock).mockResolvedValue([
        { title: 'Chapter 1', page: 2, style: 1, Y: 100, X: 50 },
      ]);
      (PluginFileAPI.replaceElements as jest.Mock).mockResolvedValue({
        success: false,
        error: { code: 1501, message: 'Permission denied: FILE:WRITE' },
      });

      const result = await IndexService.generateTocPage('/sdcard/Notes/Test.note');
      expect(result.success).toBe(false);
      expect(result.error).toEqual({ code: 1501, message: 'Permission denied: FILE:WRITE' });
    });
  });
});
