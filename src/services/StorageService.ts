// SnClipper/src/services/StorageService.ts
// Vinod Nair
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ClipSubElement {
  type: 'text' | 'image';
  text?: string;
  imagePath?: string;
  width?: number; // Image pixel width (image elements only), captured at crop time
  height?: number; // Image pixel height (image elements only)
  documentPath?: string; // Absolute path to original source file
  documentPage?: number; // 0-indexed page index in the source file
  articleName?: string;  // Specific document name for this element
}

export interface ClipItem {
  id: string; // Unique identifier
  text: string; // Flat text (concatenated text elements) for backward compatibility, search and copy
  elements: ClipSubElement[]; // Chronological list of sub-elements (text and/or image)
  articleName: string; // Active document title
  timestamp: number; // Timestamp of clip creation
}

// Persisted ToC snapshot. Heading shape mirrors IndexService.HeadingItem, kept structural here
// to avoid a circular import between StorageService and IndexService.
export interface TocHeading {
  id: string;
  title: string;
  page: number;
}
export interface TocState {
  headings: TocHeading[];
  updatedAt: number; // epoch ms of the last successful ToC build
}

const STORAGE_KEY = 'sn_clipper_aggregated_clips';
const AUTO_REMOVE_KEY = 'clipper_auto_remove_inserted';
const INSERT_FONT_SIZE_KEY = 'clipper_insert_font_size';
const COMBINE_INSERTED_KEY = 'clipper_combine_inserted';
const SHOW_SOURCE_KEY = 'clipper_show_source';
const INSERT_SOURCE_LINK_KEY = 'clipper_insert_source_link';
const ENABLE_TOC_KEY = 'clipper_enable_toc';
const ENABLE_KEYWORD_INDEX_KEY = 'clipper_enable_keyword_index';

// Font-size presets for inserted note text. Medium is the historical default (44).
export const INSERT_FONT_SIZES = { small: 32, medium: 44, large: 56 } as const;
export const DEFAULT_INSERT_FONT_SIZE = INSERT_FONT_SIZES.medium;

export class StorageService {
  /**
   * Save custom heading title overrides for a specific note file.
   */
  static async saveHeadingOverrides(notePath: string, overrides: Record<string, string>): Promise<void> {
    try {
      if (!notePath) return;
      await AsyncStorage.setItem(`clipper_heading_overrides_${notePath}`, JSON.stringify(overrides));
    } catch (e) {
      console.error('Failed to save heading overrides:', e);
    }
  }

  /**
   * Load custom heading title overrides for a specific note file.
   */
  static async getHeadingOverrides(notePath: string): Promise<Record<string, string>> {
    try {
      if (!notePath) return {};
      const data = await AsyncStorage.getItem(`clipper_heading_overrides_${notePath}`);
      if (data) {
        const parsed = JSON.parse(data) as Record<string, string>;
        // Keep only current per-title id keys (e.g. "p1_y107_x272"). Legacy builds keyed
        // overrides by page number ("2"), which no longer match a heading and must be dropped
        // so stale edits don't shadow freshly recognized titles.
        const cleaned: Record<string, string> = {};
        let dropped = false;
        for (const key of Object.keys(parsed)) {
          if (/^p\d+_/.test(key)) {
            cleaned[key] = parsed[key];
          } else {
            dropped = true;
          }
        }
        if (dropped) {
          await AsyncStorage.setItem(`clipper_heading_overrides_${notePath}`, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    } catch (e) {
      console.error('Failed to load heading overrides:', e);
    }
    return {};
  }

  /**
   * Persist a snapshot of the last-built Table of Contents for a note (its headings and the
   * time it was generated), so the ToC tab can show state without re-scanning on open.
   */
  static async setTocState(notePath: string, state: TocState): Promise<void> {
    try {
      if (!notePath) return;
      await AsyncStorage.setItem(`clipper_toc_state_${notePath}`, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save ToC state:', e);
    }
  }

  /**
   * Load the last-built Table of Contents snapshot for a note, or null if none exists.
   */
  static async getTocState(notePath: string): Promise<TocState | null> {
    try {
      if (!notePath) return null;
      const data = await AsyncStorage.getItem(`clipper_toc_state_${notePath}`);
      if (data) {
        const parsed = JSON.parse(data) as TocState;
        if (parsed && Array.isArray(parsed.headings) && typeof parsed.updatedAt === 'number') {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load ToC state:', e);
    }
    return null;
  }

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
          // Move parent-level document tracking fields (legacy clips) to first sub-element
          if (clip.documentPath && clip.elements.length > 0) {
            clip.elements[0].documentPath = clip.documentPath;
            if (clip.documentPage !== undefined) {
              clip.elements[0].documentPage = clip.documentPage;
            }
            if (clip.articleName) {
              clip.elements[0].articleName = clip.articleName;
            }
            delete clip.documentPath;
            delete clip.documentPage;
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
   * Save the clipper launch mode.
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
   * Save the clipper prompt text context.
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

  /**
   * Retrieve the font size (px) used for text inserted into notes. Defaults to Medium.
   */
  static async getInsertFontSize(): Promise<number> {
    try {
      const value = await AsyncStorage.getItem(INSERT_FONT_SIZE_KEY);
      const parsed = value ? parseInt(value, 10) : NaN;
      if (Object.values(INSERT_FONT_SIZES).includes(parsed as any)) return parsed;
    } catch (e) {
      console.error('Failed to load insert font size:', e);
    }
    return DEFAULT_INSERT_FONT_SIZE;
  }

  /**
   * Persist the font size (px) used for text inserted into notes.
   */
  static async setInsertFontSize(size: number): Promise<void> {
    try {
      await AsyncStorage.setItem(INSERT_FONT_SIZE_KEY, String(size));
    } catch (e) {
      console.error('Failed to save insert font size:', e);
    }
  }

  /**
   * Whether inserted text clips are combined into a single text box (default false).
   */
  static async getCombineInserted(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(COMBINE_INSERTED_KEY);
      if (value === null) return false;
      return value === 'true';
    } catch (e) {
      console.error('Failed to load combine-inserted setting:', e);
    }
    return false;
  }

  /**
   * Persist whether inserted text clips are combined into a single text box.
   */
  static async setCombineInserted(value: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(COMBINE_INSERTED_KEY, value ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save combine-inserted setting:', e);
    }
  }

  /**
   * Whether clip cards show the source document + jump icon (default true).
   */
  static async getShowSourceInClipper(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(SHOW_SOURCE_KEY);
      if (value === null) return true;
      return value === 'true';
    } catch (e) {
      console.error('Failed to load show-source setting:', e);
    }
    return true;
  }

  /**
   * Persist whether clip cards show the source document + jump icon.
   */
  static async setShowSourceInClipper(value: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(SHOW_SOURCE_KEY, value ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save show-source setting:', e);
    }
  }

  /**
   * Whether a source link (↗) is added under clips when inserting into a note (default true).
   */
  static async getInsertSourceLink(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(INSERT_SOURCE_LINK_KEY);
      if (value === null) return true;
      return value === 'true';
    } catch (e) {
      console.error('Failed to load insert-source-link setting:', e);
    }
    return true;
  }

  /**
   * Persist whether a source link is added under clips when inserting into a note.
   */
  static async setInsertSourceLink(value: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(INSERT_SOURCE_LINK_KEY, value ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save insert-source-link setting:', e);
    }
  }

  /**
   * Retrieve whether Table of Contents feature is enabled (default false — opt-in).
   */
  static async getEnableToc(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(ENABLE_TOC_KEY);
      if (value === null) return false;
      return value === 'true';
    } catch (e) {
      console.error('Failed to load enable-toc setting:', e);
    }
    return false;
  }

  /**
   * Persist whether Table of Contents feature is enabled.
   */
  static async setEnableToc(value: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(ENABLE_TOC_KEY, value ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save enable-toc setting:', e);
    }
  }

  /**
   * Retrieve whether Keyword Index feature is enabled (default true).
   */
  static async getEnableKeywordIndex(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(ENABLE_KEYWORD_INDEX_KEY);
      if (value === null) return true;
      return value === 'true';
    } catch (e) {
      console.error('Failed to load enable-keyword-index setting:', e);
    }
    return true;
  }

  /**
   * Persist whether Keyword Index feature is enabled.
   */
  static async setEnableKeywordIndex(value: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(ENABLE_KEYWORD_INDEX_KEY, value ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save enable-keyword-index setting:', e);
    }
  }
}
