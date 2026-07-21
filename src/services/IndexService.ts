// SnClipper/src/services/IndexService.ts
// Vinod Nair

import { PluginManager } from 'sn-plugin-lib';

export interface HeadingItem {
  title: string;
  page: number; // 1-indexed page number
}

export interface KeywordOccurrence {
  keyword: string;
  pages: number[]; // Sorted 1-indexed page numbers
}

const COMMON_STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have',
  'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself',
  'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into',
  'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my',
  'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re',
  'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t',
  'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s',
  'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t',
  'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself',
  'yourselves', 'page', 'note', 'title', 'heading', 'text', 'line', 'link'
]);

export class IndexService {
  /**
   * Fetch all headings / titles across pages of the specified note file.
   */
  static async scanHeadings(notePath: string): Promise<HeadingItem[]> {
    if (!notePath) return [];
    try {
      const totalPagesRes = await PluginManager.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number' ? totalPagesRes : (totalPagesRes?.data || 1);
      
      const pageList = Array.from({ length: totalPages }, (_, i) => i + 1);
      const titlesRes = await PluginManager.getTitles(notePath, pageList);
      
      const headings: HeadingItem[] = [];
      const rawTitles = Array.isArray(titlesRes) ? titlesRes : (titlesRes?.data || []);
      
      for (const item of rawTitles) {
        if (item && item.title) {
          headings.push({
            title: String(item.title).trim(),
            page: typeof item.page === 'number' ? item.page : (parseInt(item.page, 10) || 1),
          });
        }
      }
      
      // Sort chronologically by page
      headings.sort((a, b) => a.page - b.page);
      return headings;
    } catch (e) {
      console.error('Failed to scan headings:', e);
      return [];
    }
  }

  /**
   * Scan keywords from note pages using hybrid extraction:
   * 1. Supernote native keywords (getKeyWords)
   * 2. Text elements / handwriting recognition text (getElements)
   */
  static async scanKeywords(notePath: string): Promise<KeywordOccurrence[]> {
    if (!notePath) return [];
    try {
      const totalPagesRes = await PluginManager.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number' ? totalPagesRes : (totalPagesRes?.data || 1);
      
      const pageList = Array.from({ length: totalPages }, (_, i) => i + 1);
      const keywordMap = new Map<string, Set<number>>();

      // 1. Scan native Supernote keywords
      try {
        const nativeKwRes = await PluginManager.getKeyWords(notePath, pageList);
        const rawNative = Array.isArray(nativeKwRes) ? nativeKwRes : (nativeKwRes?.data || []);
        for (const item of rawNative) {
          const kw = item?.keyword || item?.name || item?.text;
          const pg = typeof item?.page === 'number' ? item.page : parseInt(item?.page, 10);
          if (kw && pg) {
            const cleanKw = String(kw).trim();
            if (cleanKw.length >= 2) {
              if (!keywordMap.has(cleanKw)) {
                keywordMap.set(cleanKw, new Set());
              }
              keywordMap.get(cleanKw)!.add(pg);
            }
          }
        }
      } catch (e) {
        console.warn('Native getKeyWords query returned no data or error:', e);
      }

      // 2. Scan text elements & recognition text on each page
      for (let p = 1; p <= totalPages; p++) {
        try {
          const elementsRes = await PluginManager.getElements(p, notePath);
          const rawElements = Array.isArray(elementsRes) ? elementsRes : (elementsRes?.data || []);
          
          for (const elem of rawElements) {
            let extractedText = '';
            if (typeof elem === 'string') {
              extractedText = elem;
            } else if (elem && typeof elem.text === 'string') {
              extractedText = elem.text;
            } else if (elem && typeof elem.content === 'string') {
              extractedText = elem.content;
            }

            if (extractedText) {
              // Tokenize words
              const tokens = extractedText.split(/[^a-zA-Z0-9_\-\u00C0-\u024F]+/);
              for (const token of tokens) {
                const cleanToken = token.trim();
                const lower = cleanToken.toLowerCase();
                
                // Keep words length >= 3, non-numeric, non-stopword
                if (cleanToken.length >= 3 && isNaN(Number(cleanToken)) && !COMMON_STOP_WORDS.has(lower)) {
                  // Standardize display: capitalize first letter
                  const displayWord = cleanToken.charAt(0).toUpperCase() + cleanToken.slice(1);
                  if (!keywordMap.has(displayWord)) {
                    keywordMap.set(displayWord, new Set());
                  }
                  keywordMap.get(displayWord)!.add(p);
                }
              }
            }
          }
        } catch (e) {
          // Page element scan error (ignorable)
        }
      }

      // Format as sorted array
      const result: KeywordOccurrence[] = [];
      for (const [kw, pageSet] of keywordMap.entries()) {
        const sortedPages = Array.from(pageSet).sort((a, b) => a - b);
        result.push({
          keyword: kw,
          pages: sortedPages,
        });
      }

      // Sort keywords alphabetically
      result.sort((a, b) => a.keyword.localeCompare(b.keyword));
      return result;
    } catch (e) {
      console.error('Failed to scan keywords:', e);
      return [];
    }
  }

  /**
   * Insert or update the Table of Contents page at Page 1 of the note file.
   */
  static async generateTocPage(notePath: string): Promise<boolean> {
    if (!notePath) return false;
    try {
      const headings = await this.scanHeadings(notePath);
      if (headings.length === 0) return false;

      // Insert new page at position 1
      try {
        await PluginManager.insertNotePage({
          notePath,
          page: 1,
          template: '',
        });
      } catch (e) {
        console.warn('Page insertion call note page 1:', e);
      }

      // Build ToC Text Content & Links
      let textContent = '========================================\n';
      textContent += '           TABLE OF CONTENTS            \n';
      textContent += '========================================\n\n';

      const pageLinkTargets: { page: number; y: number }[] = [];
      let currentY = 120;
      const lineHeight = 40;

      headings.forEach((h, idx) => {
        const num = `${idx + 1}. `;
        const titleText = h.title;
        const pageLabel = ` ........ p. ${h.page}`;
        textContent += `${num}${titleText}${pageLabel}\n`;
        pageLinkTargets.push({ page: h.page, y: currentY });
        currentY += lineHeight;
      });

      // Insert Text Box at Page 1
      try {
        await PluginManager.insertText({
          notePath,
          page: 1,
          text: textContent,
          fontSize: 32,
          x: 40,
          y: 40,
          width: 1300,
          height: Math.max(200, currentY + 100),
        });
      } catch (e) {
        console.warn('insertText call error:', e);
      }

      // Insert Native Links to pages
      for (const target of pageLinkTargets) {
        try {
          await PluginManager.insertTextLink({
            notePath,
            page: 1,
            destPath: notePath,
            destPage: target.page,
            x: 1200,
            y: target.y,
            width: 80,
            height: 36,
          });
        } catch (e) {
          console.warn('insertTextLink error:', e);
        }
      }

      await PluginManager.saveCurrentNote();
      await PluginManager.reloadFile();
      return true;
    } catch (e) {
      console.error('Failed to generate ToC page:', e);
      return false;
    }
  }

  /**
   * Insert or update the Keyword Index page at the last page of the note file.
   */
  static async generateIndexPage(notePath: string): Promise<boolean> {
    if (!notePath) return false;
    try {
      const keywords = await this.scanKeywords(notePath);
      if (keywords.length === 0) return false;

      const totalPagesRes = await PluginManager.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number' ? totalPagesRes : (totalPagesRes?.data || 1);
      const targetPageNum = totalPages + 1;

      // Insert new page at end of note
      try {
        await PluginManager.insertNotePage({
          notePath,
          page: targetPageNum,
          template: '',
        });
      } catch (e) {
        console.warn('Page insertion call at end of note:', e);
      }

      // Build Index Text Content & Links
      let textContent = '========================================\n';
      textContent += '             KEYWORD INDEX              \n';
      textContent += '========================================\n\n';

      let currentGroup = '';
      const linkTargets: { page: number; y: number }[] = [];
      let currentY = 120;
      const lineHeight = 40;

      keywords.forEach((kw) => {
        const firstLetter = kw.keyword.charAt(0).toUpperCase();
        if (firstLetter !== currentGroup) {
          currentGroup = firstLetter;
          textContent += `\n--- [ ${currentGroup} ] ---\n`;
          currentY += lineHeight * 1.5;
        }

        const pagesStr = kw.pages.join(', ');
        const lineStr = `${kw.keyword} ........ p. ${pagesStr}`;
        textContent += `${lineStr}\n`;

        // Link target for primary (first) page occurrence
        if (kw.pages.length > 0) {
          linkTargets.push({ page: kw.pages[0], y: currentY });
        }
        currentY += lineHeight;
      });

      // Insert Text Box at targetPageNum
      try {
        await PluginManager.insertText({
          notePath,
          page: targetPageNum,
          text: textContent,
          fontSize: 32,
          x: 40,
          y: 40,
          width: 1300,
          height: Math.max(200, currentY + 100),
        });
      } catch (e) {
        console.warn('insertText call error:', e);
      }

      // Insert Native Links to pages
      for (const target of linkTargets) {
        try {
          await PluginManager.insertTextLink({
            notePath,
            page: targetPageNum,
            destPath: notePath,
            destPage: target.page,
            x: 1200,
            y: target.y,
            width: 80,
            height: 36,
          });
        } catch (e) {
          console.warn('insertTextLink error:', e);
        }
      }

      await PluginManager.saveCurrentNote();
      await PluginManager.reloadFile();
      return true;
    } catch (e) {
      console.error('Failed to generate Index page:', e);
      return false;
    }
  }
}
