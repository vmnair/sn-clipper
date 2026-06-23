// SnClipper/src/services/StorageService.ts
// Vinod Nair
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ClipItem {
  id: string; // Unique identifier
  text: string; // Snippet text content
  articleName: string; // Active document title
  timestamp: number; // Timestamp of clip creation
}

const STORAGE_KEY = 'sn_clipper_aggregated_clips';

export class StorageService {
  /**
   * Save the accumulated clips list to storage.
   */
  static async saveClips(clips: ClipItem[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clips));
    } catch (e) {
      console.error('Failed to save clips to AsyncStorage:', e);
    }
  }

  /**
   * Retrieve the accumulated clips list.
   */
  static async loadClips(): Promise<ClipItem[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        return JSON.parse(data) as ClipItem[];
      }
    } catch (e) {
      console.error('Failed to load clips from AsyncStorage:', e);
    }
    return [];
  }

}
