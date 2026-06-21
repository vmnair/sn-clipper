// SnClipper/src/services/Clipservice.ts
// Vinod Nair

import {Image} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {StorageService, ClipItem} from './StorageService';

export class ClipService {
  private static clips: ClipItem[] = [];
  private static listeners: (() => void)[] = [];
  private static initPromise: Promise<void> | null = null;
  private static initialized: boolean = false;
  private static isNoteFile: boolean = false;

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
        this.isNoteFile = await StorageService.loadIsNoteFile();
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
    separator: string = '\n\n',
  ): Promise<string> {
    await this.init();
    return targetClips.map(c => c.text).join(separator);
  }

  /**
   * Combine all clips into a single text block separated by newlines synchronously.
   * Assumes init() has already completed.
   */
  static getAggregateTextSync(
    targetClips: ClipItem[] = this.clips,
    separator: string = '\n\n',
  ): string {
    return targetClips.map(c => c.text).join(separator);
  }

  /**
   * Set active file type context (persisted).
   */
  static async setActiveFileType(isNote: boolean): Promise<void> {
    await this.init();
    this.isNoteFile = isNote;
    await StorageService.saveIsNoteFile(isNote);
  }

  /**
   * Get active file type context synchronously.
   * Assumes init() has already completed.
   */
  static getActiveFileTypeSync(): boolean {
    return this.isNoteFile;
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
    const mergedText = clipsToMerge.map(c => c.text).join('\n\n');

    // Combine unique source document names
    const uniqueSources = Array.from(new Set(clipsToMerge.map(c => c.articleName).filter(Boolean)));
    const mergedArticleName = uniqueSources.join(' / ') || 'Unknown Document';

    // The oldest clip is the first one in our chronologically sorted list
    const oldestClip = clipsToMerge[0];

    // Create the new merged clip
    const mergedClip: ClipItem = {
      id: oldestClip.id,
      text: mergedText,
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
  }

  /**
   * Clear all aggregated text, persist empty state, and empty system clipboard.
   */
  static async clearClips(): Promise<void> {
    await this.init();
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
}
