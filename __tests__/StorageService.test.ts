import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageService, ClipItem } from '../src/services/StorageService';

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

describe('StorageService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('should save and load clips correctly', async () => {
    const testClips: ClipItem[] = [
      {
        id: '1',
        text: 'Hello world',
        elements: [{ type: 'text', text: 'Hello world' }],
        articleName: 'Test Article',
        timestamp: 12345,
      },
    ];

    await StorageService.saveClips(testClips);
    const loaded = await StorageService.loadClips();

    expect(loaded).toEqual(testClips);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'sn_clipper_aggregated_clips',
      JSON.stringify(testClips)
    );
  });

  it('should return empty array if no clips are stored', async () => {
    const loaded = await StorageService.loadClips();
    expect(loaded).toEqual([]);
  });

  it('should migrate legacy clips lacking elements array on load', async () => {
    const legacyClips = [
      {
        id: 'legacy-id',
        text: 'Legacy highlight text content',
        articleName: 'Legacy Doc',
        timestamp: 99999,
      },
    ];

    await AsyncStorage.setItem('sn_clipper_aggregated_clips', JSON.stringify(legacyClips));

    const loaded = await StorageService.loadClips();
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe('legacy-id');
    expect(loaded[0].text).toBe('Legacy highlight text content');
    expect(loaded[0].elements).toEqual([{ type: 'text', text: 'Legacy highlight text content' }]);
  });

  it('defaults the auto-remove-inserted setting to on when unset', async () => {
    expect(await StorageService.getAutoRemoveInserted()).toBe(true);
  });

  it('persists and reads back the auto-remove-inserted setting', async () => {
    await StorageService.setAutoRemoveInserted(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('clipper_auto_remove_inserted', 'false');
    expect(await StorageService.getAutoRemoveInserted()).toBe(false);

    await StorageService.setAutoRemoveInserted(true);
    expect(await StorageService.getAutoRemoveInserted()).toBe(true);
  });

  it('defaults the insert font size to 44 (Medium) when unset', async () => {
    expect(await StorageService.getInsertFontSize()).toBe(44);
  });

  it('persists and reads back the insert font size', async () => {
    await StorageService.setInsertFontSize(56);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('clipper_insert_font_size', '56');
    expect(await StorageService.getInsertFontSize()).toBe(56);
  });

  it('defaults combine-inserted to off and persists changes', async () => {
    expect(await StorageService.getCombineInserted()).toBe(false);
    await StorageService.setCombineInserted(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('clipper_combine_inserted', 'true');
    expect(await StorageService.getCombineInserted()).toBe(true);
  });

  it('defaults show-source-in-clipper to on and persists changes', async () => {
    expect(await StorageService.getShowSourceInClipper()).toBe(true);
    await StorageService.setShowSourceInClipper(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('clipper_show_source', 'false');
    expect(await StorageService.getShowSourceInClipper()).toBe(false);
  });

  it('defaults insert-source-link to on and persists changes', async () => {
    expect(await StorageService.getInsertSourceLink()).toBe(true);
    await StorageService.setInsertSourceLink(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('clipper_insert_source_link', 'false');
    expect(await StorageService.getInsertSourceLink()).toBe(false);
  });

  it('should migrate legacy parent-level documentPath/documentPage to first sub-element on load', async () => {
    const legacyClips = [
      {
        id: 'legacy-id',
        text: 'Legacy highlight text content',
        articleName: 'Legacy Doc',
        timestamp: 99999,
        documentPath: '/sdcard/Books/nlp.pdf',
        documentPage: 12,
      },
    ];

    await AsyncStorage.setItem('sn_clipper_aggregated_clips', JSON.stringify(legacyClips));

    const loaded = await StorageService.loadClips();
    expect(loaded.length).toBe(1);
    expect(loaded[0].elements).toEqual([{
      type: 'text',
      text: 'Legacy highlight text content',
      documentPath: '/sdcard/Books/nlp.pdf',
      documentPage: 12,
      articleName: 'Legacy Doc',
    }]);
    expect((loaded[0] as any).documentPath).toBeUndefined();
    expect((loaded[0] as any).documentPage).toBeUndefined();
  });

  describe('StorageService Error Handling', () => {
    let originalSetItem: any;
    let originalGetItem: any;

    beforeAll(() => {
      originalSetItem = AsyncStorage.setItem;
      originalGetItem = AsyncStorage.getItem;
    });

    afterAll(() => {
      AsyncStorage.setItem = originalSetItem;
      AsyncStorage.getItem = originalGetItem;
    });

    it('should catch errors when saveClips fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage set error'));
      await StorageService.saveClips([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should catch errors and return empty array when loadClips fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage get error'));
      const loaded = await StorageService.loadClips();
      expect(loaded).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should catch errors when setLaunchMode or getLaunchMode fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      await StorageService.setLaunchMode('crop');
      expect(consoleErrorSpy).toHaveBeenCalled();

      AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      const mode = await StorageService.getLaunchMode();
      expect(mode).toBe('normal');
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should catch errors when setPromptText or getPromptText fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      await StorageService.setPromptText('test');
      expect(consoleErrorSpy).toHaveBeenCalled();

      AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      const text = await StorageService.getPromptText();
      expect(text).toBe('');
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should catch errors when setAutoRemoveInserted or getAutoRemoveInserted fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      await StorageService.setAutoRemoveInserted(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      const val = await StorageService.getAutoRemoveInserted();
      expect(val).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should catch errors when setInsertFontSize or getInsertFontSize fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      await StorageService.setInsertFontSize(44);
      expect(consoleErrorSpy).toHaveBeenCalled();

      AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      const size = await StorageService.getInsertFontSize();
      expect(size).toBe(44);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should catch errors when setCombineInserted or getCombineInserted fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      await StorageService.setCombineInserted(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Mock AsyncStorage error'));
      const val = await StorageService.getCombineInserted();
      expect(val).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
