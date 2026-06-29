// SnClipper/src/services/Clipservice.ts
// Vinod Nair

import {Image} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {StorageService, ClipItem, ClipSubElement} from './StorageService';

export class ClipService {
  private static clips: ClipItem[] = [];
  private static listeners: (() => void)[] = [];
  private static initPromise: Promise<void> | null = null;
  private static initialized: boolean = false;

  /**
   * Ensure service is initialized before performing any operations.
   */
  static async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const loaded = await StorageService.loadClips();
        // Merge loaded clips with any clips added while init was in progress
        this.clips = [...loaded, ...this.clips];
        this.initialized = true;
        await this.updateButton();
      })();
    }
    return this.initPromise;
  }

  /**
   * Get the array of individual clippings.
   */
  static async getClips(): Promise<ClipItem[]> {
    await this.init();
    return this.clips;
  }

  /**
   * Get the array of individual clippings synchronously.
   * Assumes init() has already completed.
   */
  static getClipsSync(): ClipItem[] {
    return this.clips;
  }

  /**
   * Combine all clips into a single text block separated by newlines.
   * Only copies the raw text snippets (excludes article titles).
   */
  static async getAggregateText(
    targetClips: ClipItem[] = this.clips,
    separator: string = '\n\u200B\n',
  ): Promise<string> {
    await this.init();
    return this.getAggregateTextSync(targetClips, separator);
  }

  /**
   * Combine all clips into a single text block separated by newlines synchronously.
   * Assumes init() has already completed.
   */
  static getAggregateTextSync(
    targetClips: ClipItem[] = this.clips,
    separator: string = '\n\u200B\n',
  ): string {
    return targetClips
      .map(c => {
        if (c.text && c.text.trim() !== '') return c.text;
        return '';
      })
      .filter(Boolean)
      .join(separator);
  }

  /**
   * Append a new clip to the end, update storage, and sync system clipboard.
   */
  static async addClip(text: string, articleName: string): Promise<number> {
    await this.init();
    if (!text || text.trim() === '') {
      return this.clips.length;
    }

    // Clean up the text: join hyphenated words at line-breaks,
    // replace newlines with spaces, and collapse multiple spaces/tabs.
    const cleanedText = text
      .replace(/(\w+)-\r?\n\s*(\w+)/g, '$1$2') // Join hyphenated line-breaks
      .replace(/[\r\n]+/g, ' ') // Replace remaining line breaks with space
      .replace(/\s+/g, ' ') // Collapse multiple spaces/tabs into a single space
      .trim();

    const newClip: ClipItem = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      text: cleanedText,
      elements: [{ type: 'text', text: cleanedText }],
      articleName: articleName.trim() || 'Unknown Document',
      timestamp: Date.now(),
    };

    this.clips.push(newClip);

    // Persist
    await StorageService.saveClips(this.clips);

    await this.updateButton();
    this.notifyListeners();
    return this.clips.length;
  }

  /**
   * Add a new image clip, update storage, and notify listeners.
   */
  static async addImageClip(imagePath: string, articleName: string, width?: number, height?: number): Promise<number> {
    await this.init();
    if (!imagePath) {
      return this.clips.length;
    }

    const newClip: ClipItem = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      text: '', // Pure image clip starts with empty text description
      elements: [{ type: 'image', imagePath, width, height } as any],
      articleName: articleName.trim() || 'Unknown Document',
      timestamp: Date.now(),
    };

    this.clips.push(newClip);

    // Persist
    await StorageService.saveClips(this.clips);

    await this.updateButton();
    this.notifyListeners();
    return this.clips.length;
  }

  /**
   * Delete specific clips by their IDs, persist the new list, and update
   * the clipboard and button name.
   */
  static async deleteClips(idsToDelete: string[]): Promise<void> {
    await this.init();
    const clipsToDelete = this.clips.filter(c => idsToDelete.includes(c.id));

    // Clean up corresponding image files from disk immediately
    const { FileUtils } = require('sn-plugin-lib');
    for (const clip of clipsToDelete) {
      if (clip.elements) {
        for (const elem of clip.elements) {
          if (elem.type === 'image' && elem.imagePath) {
            try {
              await FileUtils.deleteFile(elem.imagePath);
            } catch (e) {
              console.error(`Failed to delete image file: ${elem.imagePath}`, e);
            }
          }
        }
      }
    }

    this.clips = this.clips.filter(c => !idsToDelete.includes(c.id));

    // Persist
    await StorageService.saveClips(this.clips);

    await this.updateButton();
    this.notifyListeners();
  }

  /**
   * Merge specific clippings by their IDs in-situ:
   * - Concatenates their text chronologically (oldest first).
   * - Joins unique article names with " / ".
   * - Inherits the position and timestamp of the oldest selected clip.
   */
  static async mergeClips(idsToMerge: string[]): Promise<void> {
    await this.init();
    if (!idsToMerge || idsToMerge.length < 2) {
      throw new Error('Need at least 2 clips to merge.');
    }

    // Find the clips to merge
    const clipsToMerge = this.clips.filter(c => idsToMerge.includes(c.id));
    if (clipsToMerge.length === 0) {
      throw new Error('No matching clips found for merge.');
    }

    // Sort chronologically (oldest first)
    clipsToMerge.sort((a, b) => a.timestamp - b.timestamp);

    // Concatenate text
    // Concatenate text elements chronologically from all sub-elements
    const textParts: string[] = [];
    for (const clip of clipsToMerge) {
      if (clip.elements && clip.elements.length > 0) {
        for (const el of clip.elements) {
          if (el.type === 'text' && el.text) {
            textParts.push(el.text);
          }
        }
      } else if (clip.text) {
        textParts.push(clip.text);
      }
    }
    const mergedText = textParts.join('\n\u200B\n');

    // Concatenate sub-elements sequentially
    const mergedElements: ClipSubElement[] = [];
    for (const clip of clipsToMerge) {
      if (clip.elements && clip.elements.length > 0) {
        mergedElements.push(...clip.elements);
      } else if (clip.text) {
        mergedElements.push({ type: 'text', text: clip.text });
      }
    }

    // Combine unique source document names
    const uniqueSources = Array.from(new Set(clipsToMerge.map(c => c.articleName).filter(Boolean)));
    const mergedArticleName = uniqueSources.join(' / ') || 'Unknown Document';

    // The oldest clip is the first one in our chronologically sorted list
    const oldestClip = clipsToMerge[0];

    // Create the new merged clip
    const mergedClip: ClipItem = {
      id: oldestClip.id,
      text: mergedText,
      elements: mergedElements,
      articleName: mergedArticleName,
      timestamp: oldestClip.timestamp,
    };

    // Reconstruct the clips array:
    // - Replace the oldest clip's slot in-situ with the merged clip.
    // - Remove all other merged clips.
    const updatedClips: ClipItem[] = [];
    let placed = false;

    for (const clip of this.clips) {
      if (idsToMerge.includes(clip.id)) {
        if (clip.id === oldestClip.id) {
          updatedClips.push(mergedClip);
          placed = true;
        }
        // Skip other clips that are being merged (they are deleted)
      } else {
        updatedClips.push(clip);
      }
    }

    if (!placed) {
      updatedClips.push(mergedClip);
    }

    this.clips = updatedClips;

    // Persist
    await StorageService.saveClips(this.clips);

    await this.updateButton();
    this.notifyListeners();

    // Sync system clipboard
    const fullText = await this.getAggregateText();
    const { Clipboard } = require('react-native');
    Clipboard.setString(fullText);
  }

  /**
   * Clear all aggregated text, persist empty state, and empty system clipboard.
   */
  static async clearClips(): Promise<void> {
    await this.init();

    // Clean up all image files from disk immediately to prevent leaks
    const { FileUtils } = require('sn-plugin-lib');
    for (const clip of this.clips) {
      if (clip.elements) {
        for (const elem of clip.elements) {
          if (elem.type === 'image' && elem.imagePath) {
            try {
              await FileUtils.deleteFile(elem.imagePath);
            } catch (e) {
              console.error(`Failed to delete image file: ${elem.imagePath}`, e);
            }
          }
        }
      }
    }

    this.clips = [];
    await StorageService.saveClips(this.clips);

    await this.updateButton();
    this.notifyListeners();
  }

  /**
   * Subscribe React components to clipboard updates.
   */
  static subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Update the Supernote main menu plugin button label dynamically with
   * the clip count.
   */
  static async updateButton(): Promise<void> {
    try {
      const count = this.clips.length;
      const name = count > 0 ? `Clipper (${count})` : 'Clipper';
      await PluginManager.registerButton(1, ['NOTE', 'DOC'], {
        id: 100,
        name: name,
        icon: Image.resolveAssetSource(require('../../assets/icon/icon.png')).uri,
        showType: 1, // Launches full-screen UI (App.tsx)
      });
    } catch (err) {
      console.error('Failed to update button:', err);
    }
  }

  private static notifyListeners(): void {
    this.listeners.forEach(l => l());
  }

  static async setLaunchMode(mode: 'normal' | 'crop' | 'prompt' | 'autoclipped'): Promise<void> {
    await StorageService.setLaunchMode(mode as any);
  }

  static async getLaunchMode(): Promise<'normal' | 'crop' | 'prompt' | 'autoclipped'> {
    return await StorageService.getLaunchMode() as any;
  }

  static async setPromptText(text: string): Promise<void> {
    await StorageService.setPromptText(text);
  }

  static async getPromptText(): Promise<string> {
    return await StorageService.getPromptText();
  }
}
