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

jest.mock('sn-plugin-lib', () => ({
  PluginFileAPI: {
    getNoteTotalPageNum: jest.fn().mockResolvedValue({ success: true, result: 5 }),
    getTitles: jest.fn().mockResolvedValue([]),
    getElements: jest.fn().mockResolvedValue({ success: true, result: [] }),
    getPageSize: jest.fn().mockResolvedValue({ success: true, result: { width: 1404, height: 1872 } }),
    replaceElements: jest.fn().mockResolvedValue({ success: true }),
    deleteElements: jest.fn().mockResolvedValue({ success: true }),
  },
  PluginNoteAPI: {
    saveCurrentNote: jest.fn().mockResolvedValue({ success: true }),
    insertText: jest.fn().mockResolvedValue({ success: true }),
    insertTextLink: jest.fn().mockResolvedValue({ success: true }),
  },
  PluginCommAPI: {
    getCurrentPageNum: jest.fn().mockResolvedValue({ success: true, result: 0 }),
    reloadFile: jest.fn().mockResolvedValue({ success: true }),
    recognizeElements: jest.fn().mockResolvedValue({ success: true, result: '' }),
  },
}));

describe('IndexService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await require('@react-native-async-storage/async-storage').clear();
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
