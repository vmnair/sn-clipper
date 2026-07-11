import { ClipService } from '../src/services/ClipService';
import { StorageService, ClipItem } from '../src/services/StorageService';
import { PluginManager } from 'sn-plugin-lib';

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



jest.mock('react-native', () => {
  return {
    SafeAreaView: 'SafeAreaView',
    ScrollView: 'ScrollView',
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    StyleSheet: {
      create: (styles: any) => styles,
    },
    Clipboard: {
      setString: jest.fn(),
      getString: jest.fn(),
    },
    ToastAndroid: {
      show: jest.fn(),
      SHORT: 0,
      LONG: 1,
    },
    Image: {
      resolveAssetSource: jest.fn().mockReturnValue({ uri: 'mock-uri' }),
    },
  };
});

jest.mock('sn-plugin-lib', () => ({
  PluginManager: {
    init: jest.fn(),
    registerButton: jest.fn(),
    registerButtonListener: jest.fn(),
    closePluginView: jest.fn(),
  },
  FileUtils: {
    deleteFile: jest.fn().mockResolvedValue(true),
  },
}));

describe('ClipService', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    // Reset private static properties of ClipService by calling clearClips
    // and resetting the initPromise/initialized flags
    await ClipService.clearClips();
    (ClipService as any).initialized = false;
    (ClipService as any).initPromise = null;
  });

  it('should initialize and load stored clips', async () => {
    const mockClips = [
      { id: '1', text: 'Snippet 1', articleName: 'Doc A', timestamp: 100 },
    ];
    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);

    await ClipService.init();

    expect(ClipService.getClipsSync()).toEqual(mockClips);
    expect(PluginManager.registerButton).toHaveBeenCalled();
  });

  it('should clean and add clip correctly', async () => {
    const textWithNewlines = 'This is a multi-\ncolumn text  with   spaces.';
    const expectedCleaned = 'This is a multicolumn text with spaces.';

    const newCount = await ClipService.addClip(textWithNewlines, 'My Document');

    expect(newCount).toBe(1);
    const clips = ClipService.getClipsSync();
    expect(clips[0].text).toBe(expectedCleaned);
    expect(clips[0].articleName).toBe('My Document');
  });

  it('should join hyphenated words at line-breaks', async () => {
    const hyphenatedText = 'This is a state-of-the-\nart device.';
    const expectedCleaned = 'This is a state-of-theart device.';

    await ClipService.addClip(hyphenatedText, 'My Document');
    expect(ClipService.getClipsSync()[0].text).toBe(expectedCleaned);
  });

  it('should delete clips by IDs and update clipboard', async () => {
    await ClipService.addClip('Clip A', 'Doc A');
    await ClipService.addClip('Clip B', 'Doc B');
    const clips = ClipService.getClipsSync();
    const idToDelete = clips[0].id;

    await ClipService.deleteClips([idToDelete]);

    const remaining = ClipService.getClipsSync();
    expect(remaining.length).toBe(1);
    expect(remaining[0].text).toBe('Clip B');
  });

  it('should clear all clips', async () => {
    await ClipService.addClip('Clip A', 'Doc A');
    await ClipService.clearClips();

    expect(ClipService.getClipsSync()).toEqual([]);
  });



  describe('mergeClips', () => {
    it('should throw an error if less than 2 IDs are provided', async () => {
      await expect(ClipService.mergeClips(['1'])).rejects.toThrow('Need at least 2 clips to merge.');
    });

    it('should throw an error if no matching clips are found', async () => {
      await expect(ClipService.mergeClips(['invalid-1', 'invalid-2'])).rejects.toThrow('No matching clips found for merge.');
    });

    it('should merge clips in-situ, sorting chronologically, combining source names, and keeping oldest timestamp', async () => {
      const mockClips = [
        { id: 'clip1', text: 'First highlight', articleName: 'Doc A.pdf', timestamp: 100 },
        { id: 'unrelated', text: 'Unrelated highlight', articleName: 'Doc B.pdf', timestamp: 150 },
        { id: 'clip2', text: 'Second highlight', articleName: 'Doc A.pdf', timestamp: 200 },
        { id: 'clip3', text: 'Third highlight', articleName: 'Doc C.pdf', timestamp: 50 },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      await ClipService.mergeClips(['clip1', 'clip2', 'clip3']);

      const updatedClips = ClipService.getClipsSync();

      expect(updatedClips.length).toBe(2);

      const merged = updatedClips.find(c => c.id === 'clip3');
      expect(merged).toBeDefined();
      expect(merged?.text).toBe('Third highlight\n\u200B\nFirst highlight\n\u200B\nSecond highlight');
      expect(merged?.articleName).toBe('Doc C.pdf / Doc A.pdf');
      expect(merged?.timestamp).toBe(50);

      const unrelated = updatedClips.find(c => c.id === 'unrelated');
      expect(unrelated).toBeDefined();
      expect(unrelated?.text).toBe('Unrelated highlight');
    });

    it('should merge sub-elements sequentially including images', async () => {
      const mockClips = [
        {
          id: 'clip1',
          text: 'Snippet 1',
          elements: [{ type: 'text', text: 'Snippet 1' }],
          articleName: 'Doc A.pdf',
          timestamp: 100,
        },
        {
          id: 'clip2',
          text: '',
          elements: [{ type: 'image', imagePath: '/path/to/image.png' }],
          articleName: 'Doc A.pdf',
          timestamp: 200,
        },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      await ClipService.mergeClips(['clip1', 'clip2']);

      const updatedClips = ClipService.getClipsSync();
      expect(updatedClips.length).toBe(1);
      expect(updatedClips[0].elements).toEqual([
        { type: 'text', text: 'Snippet 1' },
        { type: 'image', imagePath: '/path/to/image.png' },
      ]);
    });
  });

  describe('image clipping and cleanup', () => {
    it('should add image clip correctly', async () => {
      const count = await ClipService.addImageClip('/path/to/lasso.png', 'My Doc');
      expect(count).toBe(1);

      const clips = ClipService.getClipsSync();
      expect(clips[0].text).toBe('');
      expect(clips[0].articleName).toBe('My Doc');
      expect(clips[0].elements).toEqual([{ type: 'image', imagePath: '/path/to/lasso.png' }]);
    });

    it('should delete associated PNG file from disk when clip is deleted', async () => {
      const { FileUtils } = require('sn-plugin-lib');
      await ClipService.addImageClip('/path/to/delete.png', 'My Doc');
      const clips = ClipService.getClipsSync();
      expect(clips.length).toBe(1);

      await ClipService.deleteClips([clips[0].id]);
      expect(ClipService.getClipsSync().length).toBe(0);
      expect(FileUtils.deleteFile).toHaveBeenCalledWith('/path/to/delete.png');
    });

    it('should delete all associated PNG files when clearClips is called', async () => {
      const { FileUtils } = require('sn-plugin-lib');
      await ClipService.addImageClip('/path/to/1.png', 'Doc A');
      await ClipService.addImageClip('/path/to/2.png', 'Doc B');
      expect(ClipService.getClipsSync().length).toBe(2);

      await ClipService.clearClips();
      expect(ClipService.getClipsSync().length).toBe(0);
      expect(FileUtils.deleteFile).toHaveBeenCalledWith('/path/to/1.png');
      expect(FileUtils.deleteFile).toHaveBeenCalledWith('/path/to/2.png');
    });
  });

  describe('trimInsertedElements', () => {
    it('removes the inserted leading elements, deletes their images, and recomputes text', async () => {
      const { FileUtils } = require('sn-plugin-lib');
      const mockClips = [
        {
          id: 'mixed',
          text: 'Intro',
          elements: [
            { type: 'text', text: 'Intro' },
            { type: 'image', imagePath: '/path/to/figA.png' },
            { type: 'image', imagePath: '/path/to/figB.png' },
          ],
          articleName: 'Doc A.pdf',
          timestamp: 100,
        },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      // The text and first figure were inserted; the second figure was deferred.
      await ClipService.trimInsertedElements('mixed', 2);

      const clips = ClipService.getClipsSync();
      expect(clips.length).toBe(1);
      expect(clips[0].elements).toEqual([{ type: 'image', imagePath: '/path/to/figB.png' }]);
      expect(clips[0].text).toBe(''); // no text elements remain
      // Only the removed figure's file is deleted; the deferred one is kept.
      expect(FileUtils.deleteFile).toHaveBeenCalledWith('/path/to/figA.png');
      expect(FileUtils.deleteFile).not.toHaveBeenCalledWith('/path/to/figB.png');
    });

    it('deletes the whole clip when all elements were inserted', async () => {
      const mockClips: ClipItem[] = [
        {
          id: 'solo',
          text: 'All of it',
          elements: [{ type: 'text', text: 'All of it' }],
          articleName: 'Doc A.pdf',
          timestamp: 100,
        },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      await ClipService.trimInsertedElements('solo', 1);

      expect(ClipService.getClipsSync().length).toBe(0);
    });

    it('carries over the remainder text of a split element (count 0)', async () => {
      const mockClips: ClipItem[] = [
        {
          id: 'long',
          text: 'First half. Second half.',
          elements: [{ type: 'text', text: 'First half. Second half.' }],
          articleName: 'Doc A.pdf',
          timestamp: 100,
        },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      // The first chunk was inserted; only the remainder should survive.
      await ClipService.trimInsertedElements('long', 0, 'Second half.');

      const clips = ClipService.getClipsSync();
      expect(clips.length).toBe(1);
      expect(clips[0].elements).toEqual([{ type: 'text', text: 'Second half.' }]);
      expect(clips[0].text).toBe('Second half.');
    });
  });

  describe('unmergeClip', () => {
    it('explodes a multi-element clip into one clip per element, in order', async () => {
      const mockClips: ClipItem[] = [
        {
          id: 'merged',
          text: 'A\n​\nC',
          elements: [
            { type: 'text', text: 'A' },
            { type: 'image', imagePath: '/p/b.png', width: 100, height: 80 },
            { type: 'text', text: 'C' },
          ],
          articleName: 'Doc A / Doc B',
          timestamp: 500,
        },
        { id: 'other', text: 'Z', elements: [{ type: 'text', text: 'Z' }], articleName: 'Doc Z', timestamp: 600 },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      const pieces = await ClipService.unmergeClip('merged');
      expect(pieces).toBe(3);

      const clips = ClipService.getClipsSync();
      // 3 pieces replace the merged clip in place, 'other' remains → 4 total.
      expect(clips.length).toBe(4);
      const exploded = clips.slice(0, 3);
      expect(exploded.map(c => c.elements)).toEqual([
        [{ type: 'text', text: 'A' }],
        [{ type: 'image', imagePath: '/p/b.png', width: 100, height: 80 }],
        [{ type: 'text', text: 'C' }],
      ]);
      // Order preserved via ascending timestamps.
      expect(exploded[0].timestamp).toBeLessThan(exploded[1].timestamp);
      expect(exploded[1].timestamp).toBeLessThan(exploded[2].timestamp);
      expect(clips[3].id).toBe('other');
    });

    it('generates unique ids for the exploded pieces', async () => {
      const mockClips: ClipItem[] = [
        {
          id: 'merged',
          text: 'a\n\nb\n\nc',
          elements: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
            { type: 'text', text: 'c' },
          ],
          articleName: 'Doc A',
          timestamp: 100,
        },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      await ClipService.unmergeClip('merged');
      const ids = ClipService.getClipsSync().map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length); // all unique
    });

    it('is a no-op for a single-element clip', async () => {
      const mockClips: ClipItem[] = [
        { id: 'solo', text: 'A', elements: [{ type: 'text', text: 'A' }], articleName: 'Doc A', timestamp: 100 },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      const pieces = await ClipService.unmergeClip('solo');
      expect(pieces).toBe(0);
      expect(ClipService.getClipsSync().length).toBe(1);
    });
  });

  describe('Document context and Link removal', () => {
    it('should add text clip with document path and page context', async () => {
      await ClipService.addClip('Hello metadata', 'Book.pdf', '/sdcard/Books/Book.pdf', 5);
      const clips = ClipService.getClipsSync();
      expect(clips.length).toBe(1);
      expect(clips[0].elements[0]).toEqual({
        type: 'text',
        text: 'Hello metadata',
        documentPath: '/sdcard/Books/Book.pdf',
        documentPage: 5,
        articleName: 'Book.pdf',
      });
    });

    it('should add image clip with document path and page context', async () => {
      await ClipService.addImageClip('/path/img.png', 'Book.pdf', 300, 200, '/sdcard/Books/Book.pdf', 8);
      const clips = ClipService.getClipsSync();
      expect(clips.length).toBe(1);
      expect(clips[0].elements[0]).toEqual({
        type: 'image',
        imagePath: '/path/img.png',
        width: 300,
        height: 200,
        documentPath: '/sdcard/Books/Book.pdf',
        documentPage: 8,
        articleName: 'Book.pdf',
      });
    });

    it('should preserve element-level document metadata when unmerging clips', async () => {
      const mockClips: ClipItem[] = [
        {
          id: 'merged',
          text: 'Text A\n​\nText B',
          elements: [
            { type: 'text', text: 'Text A', documentPath: '/p/a.pdf', documentPage: 1, articleName: 'Doc A' },
            { type: 'text', text: 'Text B', documentPath: '/p/b.pdf', documentPage: 2, articleName: 'Doc B' },
          ],
          articleName: 'Doc A / Doc B',
          timestamp: 500,
        },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      await ClipService.unmergeClip('merged');
      const clips = ClipService.getClipsSync();
      expect(clips.length).toBe(2);
      expect(clips[0].elements[0]).toEqual({
        type: 'text',
        text: 'Text A',
        documentPath: '/p/a.pdf',
        documentPage: 1,
        articleName: 'Doc A',
      });
      expect(clips[0].articleName).toBe('Doc A');

      expect(clips[1].elements[0]).toEqual({
        type: 'text',
        text: 'Text B',
        documentPath: '/p/b.pdf',
        documentPage: 2,
        articleName: 'Doc B',
      });
      expect(clips[1].articleName).toBe('Doc B');
    });

    it('should strip metadata from element via removeLinkFromElement', async () => {
      const mockClips: ClipItem[] = [
        {
          id: 'clip1',
          text: 'Hello world',
          elements: [
            { type: 'text', text: 'Hello world', documentPath: '/p/a.pdf', documentPage: 1, articleName: 'Doc A' },
          ],
          articleName: 'Doc A',
          timestamp: 100,
        },
      ];
      jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);
      await ClipService.init();

      await ClipService.removeLinkFromElement('clip1', 0);
      const clips = ClipService.getClipsSync();
      expect(clips[0].elements[0]).toEqual({
        type: 'text',
        text: 'Hello world',
      });
    });
  });
});
