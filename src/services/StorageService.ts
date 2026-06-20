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
const ACTIVE_FILE_KEY = 'sn_clipper_active_file_is_note';

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

  /**
   * Save whether the active file context is a note file.
   */
  static async saveIsNoteFile(isNote: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(ACTIVE_FILE_KEY, JSON.stringify(isNote));
    } catch (e) {
      console.error('Failed to save active file type to AsyncStorage:', e);
    }
  }

  /**
   * Retrieve whether the active file context is a note file.
   */
  static async loadIsNoteFile(): Promise<boolean> {
    try {
      const data = await AsyncStorage.getItem(ACTIVE_FILE_KEY);
      if (data) {
        return JSON.parse(data) as boolean;
      }
    } catch (e) {
      console.error('Failed to load active file type from AsyncStorage:', e);
    }
    return false;
  }
}
