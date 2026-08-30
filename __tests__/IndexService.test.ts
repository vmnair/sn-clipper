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

  describe('generateTocPage — layout indentation and error handling', () => {
    it('applies level-based indentation to title text insertion', async () => {
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
      expect(row1).toBeTruthy();
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
