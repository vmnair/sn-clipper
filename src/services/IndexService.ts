// SnClipper/src/services/IndexService.ts
// Vinod Nair

import { StorageService } from './StorageService';

export interface HeadingItem {
  id: string; // Stable per-title identity (survives re-scan) used to key user title overrides
  title: string;
  page: number; // 1-indexed page number for display
}

export interface KeywordOccurrence {
  keyword: string;
  pages: number[]; // Sorted 1-indexed page numbers for display
}

export interface GenerateResult {
  success: boolean;
  message?: string;
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

const safeStringify = (obj: any): string => {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj || '');
  }
};

/**
 * Universal case-insensitive element checker for Table of Contents header detection.
 */
const isTocElement = (elem: any): boolean => {
  if (!elem) return false;
  const SEARCH_TERMS = ['TABLE OF CONTENTS', 'TABLE OF CONTENT', 'CONTENTS', 'TOC'];

  const strRep = safeStringify(elem).toUpperCase();
  for (const term of SEARCH_TERMS) {
    if (strRep.includes(term)) return true;
  }

  if (typeof elem === 'string') {
    const upper = elem.toUpperCase();
    return SEARCH_TERMS.some(term => upper.includes(term));
  }

  if (typeof elem === 'object') {
    try {
      for (const key of Object.keys(elem)) {
        const val = elem[key];
        if (typeof val === 'string') {
          const upper = val.toUpperCase();
          if (SEARCH_TERMS.some(term => upper.includes(term))) {
            return true;
          }
        }
      }
    } catch (e) {}
  }
  return false;
};

/**
 * Universal property inspector for title/text extraction.
 */
const extractTitleString = (val: any, depth = 0): string => {
  if (!val || depth > 5) return '';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '[object Object]' || trimmed.length === 0) return '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return '';
    if (trimmed.toLowerCase() === 'others' || /^heading\s*\d+$/i.test(trimmed) || isTocElement(trimmed)) return '';
    return trimmed;
  }
  if (typeof val === 'number') return String(val).trim();
  if (typeof val === 'object') {
    try {
      const priorityKeys = [
        'textBox', 'textContentFull', 'titleName', 'titleText', 'titleContent', 'recognizedText', 'recogText',
        'fullText', 'showText', 'userData', 'title', 'text', 'content', 'name', 'label'
      ];
      for (const k of priorityKeys) {
        if (val[k] !== undefined && val[k] !== null) {
          const res = extractTitleString(val[k], depth + 1);
          if (res) return res;
        }
      }
      const ignoredKeys = new Set(['uuid', 'id', 'predict_name', 'destPath', 'fontPath', 'pngPath']);
      for (const k of Object.keys(val)) {
        if (!ignoredKeys.has(k) && !priorityKeys.includes(k)) {
          const prop = val[k];
          if (typeof prop === 'string') {
            const trimmed = prop.trim();
            if (
              trimmed &&
              trimmed !== '[object Object]' &&
              !trimmed.startsWith('{') &&
              trimmed.toLowerCase() !== 'others' &&
              !/^heading\s*\d+$/i.test(trimmed) &&
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) &&
              !isTocElement(trimmed)
            ) {
              return trimmed;
            }
          }
        }
      }
    } catch (e) {}
  }
  return '';
};

/**
 * 100% Synchronous text extractor for typed text elements.
 */
const getRecognizedTextForElement = (elem: any): string => {
  try {
    if (!elem || typeof elem !== 'object') return '';
    
    // 1. Direct text fields on element
    if (typeof elem.textContentFull === 'string' && elem.textContentFull.trim()) {
      const txt = elem.textContentFull.trim();
      if (txt !== '[object Object]' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txt)) {
        return txt;
      }
    }

    // 2. Nested textBox object (elem.textBox.textContentFull)
    if (elem.textBox && typeof elem.textBox.textContentFull === 'string' && elem.textBox.textContentFull.trim()) {
      const txt = elem.textBox.textContentFull.trim();
      if (txt !== '[object Object]' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txt)) {
        return txt;
      }
    }

    // 3. User data or fullText
    if (typeof elem.userData === 'string' && elem.userData.trim()) {
      const txt = elem.userData.trim();
      if (txt !== '[object Object]' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txt)) {
        return txt;
      }
    }
    if (typeof elem.fullText === 'string' && elem.fullText.trim()) {
      const txt = elem.fullText.trim();
      if (txt !== '[object Object]' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txt)) {
        return txt;
      }
    }
  } catch (e) {}
  return '';
};

/**
 * Strict spatial & length classifier to determine if a text element is a valid Heading title.
 * Must lie tightly inside the Title bounding box, be short (< 60 chars), and not be a ToC header.
 */
const isTightHeadingTextForTitle = (elem: any, titleItem: any): string => {
  if (!elem || !titleItem) return '';

  const txt = getRecognizedTextForElement(elem);
  if (!txt) return '';

  // 1. Reject ToC headers ("TABLE OF CONTENTS", "TOC", etc.)
  if (isTocElement(txt)) return '';

  // 2. Reject long clipped paragraphs / digests (headings are short < 60 chars)
  if (txt.length > 60 || txt.includes('\n')) return '';

  // 3. Strict center-point spatial match inside Title bounding box
  if (typeof titleItem.X !== 'number' || typeof titleItem.Y !== 'number') return '';

  let left = 0, top = 0, right = 0, bottom = 0;
  if (elem.textBox && elem.textBox.textRect) {
    left = elem.textBox.textRect.left;
    top = elem.textBox.textRect.top;
    right = elem.textBox.textRect.right;
    bottom = elem.textBox.textRect.bottom;
  } else if (elem.textRect) {
    left = elem.textRect.left;
    top = elem.textRect.top;
    right = elem.textRect.right;
    bottom = elem.textRect.bottom;
  } else if (typeof elem.X === 'number' && typeof elem.Y === 'number') {
    left = elem.X;
    top = elem.Y;
    right = elem.X + (elem.width || 50);
    bottom = elem.Y + (elem.height || 50);
  } else {
    return '';
  }

  const textCenterX = (left + right) / 2;
  const textCenterY = (top + bottom) / 2;

  const titleLeft = titleItem.X - 30;
  const titleTop = titleItem.Y - 30;
  const titleRight = titleItem.X + (titleItem.width || 100) + 30;
  const titleBottom = titleItem.Y + (titleItem.height || 50) + 30;

  const isInside = (
    textCenterX >= titleLeft &&
    textCenterX <= titleRight &&
    textCenterY >= titleTop &&
    textCenterY <= titleBottom
  );

  return isInside ? txt : '';
};

/**
 * Handwriting fallback for heading text: gathers the stroke elements that fall inside a
 * title's bounding box and runs them through Supernote's on-device recognition.
 * Returns '' when recognition is unavailable, no strokes match, or the result is unusable.
 */
const recognizeTitleStrokes = async (
  titleItem: any,
  pageElements: any[],
  pageSize: { width: number; height: number } | null,
): Promise<string> => {
  try {
    if (!pageSize || !Array.isArray(pageElements) || pageElements.length === 0) return '';
    if (typeof titleItem?.X !== 'number' || typeof titleItem?.Y !== 'number') return '';

    const { PluginCommAPI } = require('sn-plugin-lib');
    if (!PluginCommAPI || typeof PluginCommAPI.recognizeElements !== 'function') return '';

    // Expand the title rect generously: a stroke's maxX/maxY is a corner, not a center.
    const pad = 50;
    const left = titleItem.X - pad;
    const right = titleItem.X + (titleItem.width || 100) + pad;
    const top = titleItem.Y - pad;
    const bottom = titleItem.Y + (titleItem.height || 60) + pad;

    const strokes = pageElements.filter((elem: any) => {
      if (!elem || elem.type !== 0) return false; // Element.TYPE_STROKE === 0
      const px = typeof elem.maxX === 'number' ? elem.maxX : (typeof elem.X === 'number' ? elem.X : null);
      const py = typeof elem.maxY === 'number' ? elem.maxY : (typeof elem.Y === 'number' ? elem.Y : null);
      if (px === null || py === null) return false;
      return px >= left && px <= right && py >= top && py <= bottom;
    });

    if (strokes.length === 0) return '';

    const recRes: any = await PluginCommAPI.recognizeElements(strokes, pageSize);
    const rawText: any = typeof recRes === 'string'
      ? recRes
      : (typeof recRes?.result === 'string' ? recRes.result : (recRes?.data || ''));
    if (!rawText || typeof rawText !== 'string') return '';

    // A heading is a single line: take the first non-empty line and sanitize it.
    const firstLine = rawText.split(/[\r\n]+/).map((s: string) => s.trim()).find(Boolean) || '';
    const cleaned = firstLine.trim();
    if (!cleaned || cleaned.length > 80 || isTocElement(cleaned)) return '';
    return cleaned;
  } catch (e) {
    return '';
  }
};

export class IndexService {
  /**
   * Fetch all headings / titles across pages of the specified note file.
   */
  static async scanHeadings(notePath: string): Promise<HeadingItem[]> {
    if (!notePath) return [];
    try {
      const { PluginFileAPI } = require('sn-plugin-lib');
      const totalPagesRes: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number'
        ? totalPagesRes
        : (typeof totalPagesRes?.result === 'number' ? totalPagesRes.result : (totalPagesRes?.data || 1));
      
      const pageList = Array.from({ length: totalPages }, (_, i) => i);
      const titlesRes: any = await PluginFileAPI.getTitles(notePath, pageList);

      const headings: HeadingItem[] = [];
      const rawTitles = Array.isArray(titlesRes) ? titlesRes : (titlesRes?.result || titlesRes?.data || []);

      const pageElementsMap = new Map<number, any[]>();
      const pageSizeMap = new Map<number, { width: number; height: number }>();
      const missingTextPages = new Set<number>();

      for (let i = 0; i < rawTitles.length; i++) {
        const item = rawTitles[i];
        if (item) {
          const rawPg = typeof item.page === 'number' ? item.page : (parseInt(item.page, 10) || 0);
          // Exclude Page 0 (ToC page itself) titles
          if (rawPg > 0) {
            const headingText = extractTitleString(item);
            if (!headingText) {
              missingTextPages.add(rawPg);
            }
          }
        }
      }

      if (missingTextPages.size > 0) {
        const pagesArray = Array.from(missingTextPages);
        const [elementsResults, sizeResults] = await Promise.all([
          Promise.all(pagesArray.map(pg => PluginFileAPI.getElements(pg, notePath).catch(() => null))),
          Promise.all(pagesArray.map(pg => PluginFileAPI.getPageSize(notePath, pg).catch(() => null))),
        ]);
        pagesArray.forEach((pg, idx) => {
          const res: any = elementsResults[idx];
          const elems = Array.isArray(res) ? res : (res?.result || res?.data || []);
          pageElementsMap.set(pg, elems);

          const sz: any = sizeResults[idx];
          const w = typeof sz?.result?.width === 'number' ? sz.result.width : (typeof sz?.width === 'number' ? sz.width : null);
          const h = typeof sz?.result?.height === 'number' ? sz.result.height : (typeof sz?.height === 'number' ? sz.height : null);
          if (w && h) pageSizeMap.set(pg, { width: w, height: h });
        });
      }

      const perPageOrdinal = new Map<number, number>();
      const usedIds = new Set<string>();
      let headingCounter = 1;
      for (let i = 0; i < rawTitles.length; i++) {
        const item = rawTitles[i];
        if (!item) continue;

        const rawPg = typeof item.page === 'number' ? item.page : (parseInt(item.page, 10) || 0);

        // Skip titles found on Page 0 (the ToC page itself)
        if (rawPg === 0) continue;

        const pageDisplay = rawPg + 1;
        const ord = perPageOrdinal.get(rawPg) || 0;
        perPageOrdinal.set(rawPg, ord + 1);

        let headingText = extractTitleString(item);

        // Strict spatial & length classifier (typed text boxes inside the title box)
        if (!headingText && pageElementsMap.has(rawPg)) {
          const rawElements = pageElementsMap.get(rawPg) || [];
          for (const elem of rawElements) {
            const matchedTxt = isTightHeadingTextForTitle(elem, item);
            if (matchedTxt) {
              headingText = matchedTxt;
              break;
            }
          }
        }

        // Handwriting fallback: recognize the title's strokes into text.
        if (!headingText && pageElementsMap.has(rawPg)) {
          const recognized = await recognizeTitleStrokes(
            item,
            pageElementsMap.get(rawPg) || [],
            pageSizeMap.get(rawPg) || null,
          );
          if (recognized) headingText = recognized;
        }

        if (!headingText) {
          headingText = `Heading ${headingCounter}`;
        }

        // Stable per-title identity for override matching: prefer the title's page position
        // (survives re-scan unless the user moves the title); fall back to per-page ordinal.
        let id = (typeof item.X === 'number' && typeof item.Y === 'number')
          ? `p${rawPg}_y${Math.round(item.Y)}_x${Math.round(item.X)}`
          : `p${rawPg}_i${ord}`;
        if (usedIds.has(id)) {
          let n = 1;
          const base = id;
          while (usedIds.has(id)) id = `${base}#${n++}`;
        }
        usedIds.add(id);

        headings.push({
          id,
          title: headingText,
          page: pageDisplay,
        });
        headingCounter++;
      }

      // Merge custom title overrides from user edits
      try {
        const overrides = await StorageService.getHeadingOverrides(notePath);
        for (const h of headings) {
          if (overrides[h.id]) {
            h.title = overrides[h.id];
          }
        }
      } catch (e) {}

      headings.sort((a, b) => a.page - b.page);
      return headings;
    } catch (e) {
      console.error('Failed to scan headings:', e);
      return [];
    }
  }

  /**
   * Scan keywords from note pages using hybrid extraction.
   */
  static async scanKeywords(notePath: string): Promise<KeywordOccurrence[]> {
    if (!notePath) return [];
    try {
      const { PluginFileAPI } = require('sn-plugin-lib');
      const totalPagesRes: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number'
        ? totalPagesRes
        : (typeof totalPagesRes?.result === 'number' ? totalPagesRes.result : (totalPagesRes?.data || 1));
      
      const pageList = Array.from({ length: totalPages }, (_, i) => i);
      const keywordMap = new Map<string, Set<number>>();

      // 1. Scan native Supernote keywords
      try {
        const nativeKwRes: any = await PluginFileAPI.getKeyWords(notePath, pageList);
        const rawNative = Array.isArray(nativeKwRes) ? nativeKwRes : (nativeKwRes?.result || nativeKwRes?.data || []);
        for (const item of rawNative) {
          const kw = extractTitleString(item);
          const pg = typeof item?.page === 'number' ? item.page : parseInt(item?.page, 10);
          if (kw && pg !== undefined && !isNaN(pg) && pg > 0 && !isTocElement(kw)) {
            const cleanKw = kw.trim();
            if (cleanKw.length >= 2) {
              const displayPg = pg + 1; // 1-indexed display
              if (!keywordMap.has(cleanKw)) {
                keywordMap.set(cleanKw, new Set());
              }
              keywordMap.get(cleanKw)!.add(displayPg);
            }
          }
        }
      } catch (e) {
        console.warn('getKeyWords error:', e);
      }

      // 2. Scan text elements & recognition text on each page in parallel (excluding Page 0)
      const nonTocPages = pageList.filter(p => p > 0);
      const elementsResults = await Promise.all(
        nonTocPages.map(pg => PluginFileAPI.getElements(pg, notePath).catch(() => null))
      );

      for (let idx = 0; idx < nonTocPages.length; idx++) {
        const p = nonTocPages[idx];
        const elementsRes: any = elementsResults[idx];
        const rawElements = Array.isArray(elementsRes) ? elementsRes : (elementsRes?.result || elementsRes?.data || []);
        
        for (const elem of rawElements) {
          const extractedText = getRecognizedTextForElement(elem);

          if (extractedText && !isTocElement(extractedText)) {
            const tokens = extractedText.split(/[^a-zA-Z0-9_\-\u00C0-\u024F]+/);
            for (const token of tokens) {
              const cleanToken = token.trim();
              const lower = cleanToken.toLowerCase();
              
              if (cleanToken.length >= 3 && isNaN(Number(cleanToken)) && !COMMON_STOP_WORDS.has(lower)) {
                const displayWord = cleanToken.charAt(0).toUpperCase() + cleanToken.slice(1);
                if (!keywordMap.has(displayWord)) {
                  keywordMap.set(displayWord, new Set());
                }
                keywordMap.get(displayWord)!.add(p + 1);
              }
            }
          }
        }
      }

      const result: KeywordOccurrence[] = [];
      for (const [kw, pageSet] of keywordMap.entries()) {
        const sortedPages = Array.from(pageSet).sort((a, b) => a - b);
        result.push({
          keyword: kw,
          pages: sortedPages,
        });
      }

      result.sort((a, b) => a.keyword.localeCompare(b.keyword));
      return result;
    } catch (e) {
      console.error('Failed to scan keywords:', e);
      return [];
    }
  }

  /**
   * Insert or update the Table of Contents on Page 1 with per-row try/catch error boundaries.
   */
  static async generateTocPage(notePath: string, customFontSize?: number): Promise<GenerateResult> {
    if (!notePath) return { success: false, message: 'No active note open' };
    try {
      const { PluginFileAPI, PluginNoteAPI, PluginCommAPI } = require('sn-plugin-lib');

      const headings = await this.scanHeadings(notePath);
      if (headings.length === 0) {
        return { success: false, message: 'No titles or headings found in this note.' };
      }

      const totalPagesRes: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number'
        ? totalPagesRes
        : (typeof totalPagesRes?.result === 'number' ? totalPagesRes.result : (totalPagesRes?.data || 1));

      // Check Page 0 elements safely
      try {
        const elementsRes: any = await PluginFileAPI.getElements(0, notePath);
        const rawElements = Array.isArray(elementsRes) ? elementsRes : (elementsRes?.result || elementsRes?.data || []);
        
        let hasTocHeader = false;
        for (const elem of rawElements) {
          if (isTocElement(elem)) {
            hasTocHeader = true;
            break;
          }
        }

        // If Page 0 has non-ToC elements (user handwritten notes), prompt user to insert a blank page
        if (rawElements.length > 0 && !hasTocHeader) {
          return {
            success: false,
            message: 'Page 1 contains existing notes. Please insert a blank page at the beginning of your notebook (Pages -> + Add Page) before generating the Table of Contents.',
          };
        }
      } catch (e) {}

      // Clear old elements on Page 0 so old ToC lines are erased cleanly
      try {
        await PluginFileAPI.replaceElements(notePath, 0, []);
      } catch (e) {
        console.warn('replaceElements error on ToC page 0:', e);
      }

      const fontSize = customFontSize || (await StorageService.getInsertFontSize()) || 36;
      const rowSpacing = Math.round(fontSize * 1.5);
      const availableVerticalSpace = 1440;
      const headingsPerPage = Math.max(10, Math.floor(availableVerticalSpace / rowSpacing));

      const pageHeaderTitle = 'TABLE OF CONTENTS';
      const headerTopY = 160;
      const headerFontSize = fontSize + 6;

      // Write Title Header
      try {
        await PluginNoteAPI.insertText({
          textContentFull: pageHeaderTitle,
          textRect: { left: 200, top: headerTopY, right: 1160, bottom: headerTopY + 70 },
          fontSize: headerFontSize,
          textAlign: 0,
          textBold: 1,
          textItalics: 0,
          textFrameWidthType: 0,
          textFrameStyle: 0,
          textEditable: 1,
        });
      } catch (e) {
        console.warn('insertText header error:', e);
      }

      // Write Heading Rows with per-row isolated error boundaries
      const firstHeadingY = 260;
      const linkFontSize = Math.round(fontSize * 0.85);
      const displayChunk = headings.slice(0, headingsPerPage);

      for (let idx = 0; idx < displayChunk.length; idx++) {
        const h = displayChunk[idx];
        const itemY = firstHeadingY + (idx * rowSpacing);

        const num = `${idx + 1}. `;
        const lineText = `${num}${h.title} ........ p. ${h.page}`;

        // Text Box for Row idx
        try {
          await PluginNoteAPI.insertText({
            textContentFull: lineText,
            textRect: { left: 200, top: itemY, right: 1160, bottom: itemY + Math.round(fontSize * 1.3) },
            fontSize,
            textAlign: 0,
            textBold: 0,
            textItalics: 0,
            textFrameWidthType: 0,
            textFrameStyle: 0,
            textEditable: 1,
          });
        } catch (e) {
          console.warn(`insertText row ${idx} error:`, e);
        }

        // Link Icon (↗) for Row idx with SAFE BOUNDS
        const safeDestPage = Math.min(totalPages - 1, Math.max(0, h.page - 1));
        try {
          await PluginNoteAPI.insertTextLink({
            destPath: notePath,
            destPage: safeDestPage,
            style: 0,
            linkType: 0,
            rect: { left: 1180, top: itemY, right: 1260, bottom: itemY + Math.round(linkFontSize * 1.2) },
            fontSize: linkFontSize,
            fullText: '↗',
            showText: '↗',
            isItalic: 0,
          });
        } catch (e) {
          console.warn(`insertTextLink row ${idx} error:`, e);
        }
      }

      try {
        await PluginNoteAPI.saveCurrentNote();
        await PluginCommAPI.reloadFile();
      } catch (e) {
        console.warn('save/reload error:', e);
      }

      return { success: true, message: 'Table of Contents created successfully!' };
    } catch (e: any) {
      console.error('Failed to generate ToC page:', e);
      return { success: false, message: e?.message || 'Failed to generate ToC page' };
    }
  }

  /**
   * Insert or update the Keyword Index page.
   */
  static async generateIndexPage(notePath: string, customFontSize?: number): Promise<GenerateResult> {
    if (!notePath) return { success: false, message: 'No active note open' };
    try {
      const { PluginFileAPI, PluginNoteAPI, PluginCommAPI } = require('sn-plugin-lib');

      const keywords = await this.scanKeywords(notePath);
      if (keywords.length === 0) {
        return { success: false, message: 'No keywords found in this note.' };
      }

      const totalPagesRes: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number'
        ? totalPagesRes
        : (typeof totalPagesRes?.result === 'number' ? totalPagesRes.result : (totalPagesRes?.data || 1));

      const fontSize = customFontSize || (await StorageService.getInsertFontSize()) || 36;
      const rowSpacing = Math.round(fontSize * 1.5);
      const availableVerticalSpace = 1440;
      const keywordsPerPage = Math.max(10, Math.floor(availableVerticalSpace / rowSpacing));

      const pageHeaderTitle = 'KEYWORD INDEX';
      const headerTopY = 160;
      const headerFontSize = fontSize + 6;
      try {
        await PluginNoteAPI.insertText({
          textContentFull: pageHeaderTitle,
          textRect: { left: 200, top: headerTopY, right: 1160, bottom: headerTopY + 70 },
          fontSize: headerFontSize,
          textAlign: 0,
          textBold: 1,
          textItalics: 0,
          textFrameWidthType: 0,
          textFrameStyle: 0,
          textEditable: 1,
        });
      } catch (e) {
        console.warn('insertText index header error:', e);
      }

      const firstHeadingY = 260;
      const linkFontSize = Math.round(fontSize * 0.85);
      let currentGroup = '';
      let rowIdx = 0;
      const displayChunk = keywords.slice(0, keywordsPerPage);

      for (let idx = 0; idx < displayChunk.length; idx++) {
        const kw = displayChunk[idx];
        const firstLetter = kw.keyword.charAt(0).toUpperCase();

        if (firstLetter !== currentGroup) {
          currentGroup = firstLetter;
          const groupY = firstHeadingY + (rowIdx * rowSpacing);
          try {
            await PluginNoteAPI.insertText({
              textContentFull: `--- [ ${currentGroup} ] ---`,
              textRect: { left: 200, top: groupY, right: 1160, bottom: groupY + Math.round(fontSize * 1.3) },
              fontSize: fontSize - 2,
              textAlign: 0,
              textBold: 1,
              textItalics: 1,
              textFrameWidthType: 0,
              textFrameStyle: 0,
              textEditable: 1,
            });
          } catch (e) {}
          rowIdx++;
        }

        const itemY = firstHeadingY + (rowIdx * rowSpacing);
        const pagesStr = kw.pages.join(', ');
        const lineStr = `${kw.keyword} ........ p. ${pagesStr}`;

        // Text Box for Index row
        try {
          await PluginNoteAPI.insertText({
            textContentFull: lineStr,
            textRect: { left: 200, top: itemY, right: 1160, bottom: itemY + Math.round(fontSize * 1.3) },
            fontSize,
            textAlign: 0,
            textBold: 0,
            textItalics: 0,
            textFrameWidthType: 0,
            textFrameStyle: 0,
            textEditable: 1,
          });
        } catch (e) {}

        // Link Icon for Index row with safe destPage bounds
        if (kw.pages.length > 0) {
          const safeDestPage = Math.min(totalPages - 1, Math.max(0, kw.pages[0] - 1));
          try {
            await PluginNoteAPI.insertTextLink({
              destPath: notePath,
              destPage: safeDestPage,
              style: 0,
              linkType: 0,
              rect: { left: 1180, top: itemY, right: 1260, bottom: itemY + Math.round(linkFontSize * 1.2) },
              fontSize: linkFontSize,
              fullText: '↗',
              showText: '↗',
              isItalic: 0,
            });
          } catch (e) {}
        }

        rowIdx++;
      }

      try {
        await PluginNoteAPI.saveCurrentNote();
        await PluginCommAPI.reloadFile();
      } catch (e) {}

      return { success: true, message: 'Keyword Index created successfully!' };
    } catch (e: any) {
      console.error('Failed to generate Index page:', e);
      return { success: false, message: e?.message || 'Failed to generate Index page' };
    }
  }
}
