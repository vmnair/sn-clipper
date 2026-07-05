// SnClipper/src/services/StorageService.ts
// Vinod Nair
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ClipSubElement {
  type: 'text' | 'image';
  text?: string;
  imagePath?: string;
  width?: number; // Image pixel width (image elements only), captured at crop time
  height?: number; // Image pixel height (image elements only)
}

export interface ClipItem {
  id: string; // Unique identifier
  text: string; // Flat text (concatenated text elements) for backward compatibility, search and copy
  elements: ClipSubElement[]; // Chronological list of sub-elements (text and/or image)
  articleName: string; // Active document title
  timestamp: number; // Timestamp of clip creation
}

const STORAGE_KEY = 'sn_clipper_aggregated_clips';
const AUTO_REMOVE_KEY = 'clipper_auto_remove_inserted';

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
        const parsed = JSON.parse(data) as any[];
        return parsed.map(clip => {
          // Migration logic: if elements array is missing, initialize it with a single text element
          if (!clip.elements) {
            clip.elements = [{ type: 'text', text: clip.text || '' }];
          }
          // If flat text is missing (e.g. pure image clip or corrupted state), populate it from text elements
          if (clip.text === undefined) {
            clip.text = clip.elements
              .filter((e: any) => e.type === 'text')
              .map((e: any) => e.text)
              .join('\n\n');
          }
          return clip as ClipItem;
        });
      }
    } catch (e) {
      console.error('Failed to load clips from AsyncStorage:', e);
    }
    return [];
  }

  /**
   * Save the clipper launch mode. AsyncStorage is the durable source of truth (it survives
   * a plugin-process/RN recreation between the background handler setting the mode and the
   * App reading it); the native static is also set, purely so it can emit onLaunchModeChange
   * synchronously to wake an already-mounted App. Every native write goes through here, so
   * the two stay in sync.
   */
  static async setLaunchMode(mode: 'normal' | 'crop' | 'prompt' | 'autoclipped'): Promise<void> {
    try {
      await AsyncStorage.setItem('clipper_launch_mode', mode);
      const { NativeModules } = require('react-native');
      const { ImageCropModule } = NativeModules;
      if (ImageCropModule && typeof ImageCropModule.setLaunchMode === 'function') {
        await ImageCropModule.setLaunchMode(mode);
      }
    } catch (e) {
      console.error('Failed to save launch mode:', e);
    }
  }

  /**
   * Retrieve the clipper launch mode from the durable store.
   */
  static async getLaunchMode(): Promise<'normal' | 'crop' | 'prompt' | 'autoclipped'> {
    try {
      const mode = await AsyncStorage.getItem('clipper_launch_mode');
      return (mode as any) || 'normal';
    } catch (e) {
      console.error('Failed to load launch mode:', e);
    }
    return 'normal';
  }

  /**
   * Save the clipper prompt text context. Persisted to AsyncStorage (durable) and mirrored
   * to the native static so both stay in sync (see setLaunchMode).
   */
  static async setPromptText(text: string): Promise<void> {
    try {
      await AsyncStorage.setItem('clipper_prompt_text', text);
      const { NativeModules } = require('react-native');
      const { ImageCropModule } = NativeModules;
      if (ImageCropModule && typeof ImageCropModule.setPromptText === 'function') {
        await ImageCropModule.setPromptText(text);
      }
    } catch (e) {
      console.error('Failed to save prompt text:', e);
    }
  }

  /**
   * Retrieve the clipper prompt text context from the durable store.
   */
  static async getPromptText(): Promise<string> {
    try {
      const text = await AsyncStorage.getItem('clipper_prompt_text');
      return text || '';
    } catch (e) {
      console.error('Failed to load prompt text:', e);
    }
    return '';
  }

  /**
   * Retrieve whether clips should be removed from Clipper after they are
   * successfully inserted into a note. Defaults to true (on) when unset.
   */
  static async getAutoRemoveInserted(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(AUTO_REMOVE_KEY);
      if (value === null) return true; // default on
      return value === 'true';
    } catch (e) {
      console.error('Failed to load auto-remove setting:', e);
    }
    return true;
  }

  /**
   * Persist whether inserted clips should be removed from Clipper.
   */
  static async setAutoRemoveInserted(value: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(AUTO_REMOVE_KEY, value ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save auto-remove setting:', e);
    }
  }
}
