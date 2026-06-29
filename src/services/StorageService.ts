// SnClipper/src/services/StorageService.ts
// Vinod Nair
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ClipSubElement {
  type: 'text' | 'image';
  text?: string;
  imagePath?: string;
}

export interface ClipItem {
  id: string; // Unique identifier
  text: string; // Flat text (concatenated text elements) for backward compatibility, search and copy
  elements: ClipSubElement[]; // Chronological list of sub-elements (text and/or image)
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
   * Save the clipper launch mode to storage.
   */
  static async setLaunchMode(mode: 'normal' | 'crop' | 'prompt' | 'autoclipped'): Promise<void> {
    try {
      const { NativeModules } = require('react-native');
      const { ImageCropModule } = NativeModules;
      if (ImageCropModule && typeof ImageCropModule.setLaunchMode === 'function') {
        await ImageCropModule.setLaunchMode(mode);
      } else {
        await AsyncStorage.setItem('clipper_launch_mode', mode);
      }
    } catch (e) {
      console.error('Failed to save launch mode:', e);
    }
  }

  /**
   * Retrieve the clipper launch mode.
   */
  static async getLaunchMode(): Promise<'normal' | 'crop' | 'prompt' | 'autoclipped'> {
    try {
      const { NativeModules } = require('react-native');
      const { ImageCropModule } = NativeModules;
      if (ImageCropModule && typeof ImageCropModule.getLaunchMode === 'function') {
        const mode = await ImageCropModule.getLaunchMode();
        return (mode as any) || 'normal';
      } else {
        const mode = await AsyncStorage.getItem('clipper_launch_mode');
        return (mode as any) || 'normal';
      }
    } catch (e) {
      console.error('Failed to load launch mode:', e);
    }
    return 'normal';
  }

  /**
   * Save the clipper prompt text context.
   */
  static async setPromptText(text: string): Promise<void> {
    try {
      const { NativeModules } = require('react-native');
      const { ImageCropModule } = NativeModules;
      if (ImageCropModule && typeof ImageCropModule.setPromptText === 'function') {
        await ImageCropModule.setPromptText(text);
      } else {
        await AsyncStorage.setItem('clipper_prompt_text', text);
      }
    } catch (e) {
      console.error('Failed to save prompt text:', e);
    }
  }

  /**
   * Retrieve the clipper prompt text context.
   */
  static async getPromptText(): Promise<string> {
    try {
      const { NativeModules } = require('react-native');
      const { ImageCropModule } = NativeModules;
      if (ImageCropModule && typeof ImageCropModule.getPromptText === 'function') {
        return await ImageCropModule.getPromptText();
      } else {
        const text = await AsyncStorage.getItem('clipper_prompt_text');
        return text || '';
      }
    } catch (e) {
      console.error('Failed to load prompt text:', e);
    }
    return '';
  }
}
