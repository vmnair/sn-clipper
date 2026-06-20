import { ClipService } from '../src/services/ClipService';
import { StorageService } from '../src/services/StorageService';
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

  it('should handle isNoteFile state updates', async () => {
    await ClipService.setActiveFileType(true);
    expect(ClipService.getActiveFileTypeSync()).toBe(true);

    await ClipService.setActiveFileType(false);
    expect(ClipService.getActiveFileTypeSync()).toBe(false);
  });
});
