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


});
