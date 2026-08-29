// SnClipper/src/services/IndexService.ts
// Vinod Nair

import { StorageService } from './StorageService';

export interface HeadingItem {
  id: string; // Stable per-title identity (survives re-scan) used to key user title overrides
  title: string;
  page: number; // 1-indexed page number for display
}

export interface GenerateResult {
  success: boolean;
  message?: string;
  needsBlankPage?: boolean; // page 1 has user content; caller should prompt to insert a blank page
  headings?: HeadingItem[]; // headings used to build the ToC (so the caller can persist without re-scanning)
}

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
  // Match ONLY the full header phrase we actually write ('TABLE OF CONTENTS'). The short
  // terms 'TOC'/'CONTENTS' were removed because this does a substring match over the whole
  // stringified element, so ordinary words — "protocol", "stochastic", "photocopy" (all
  // contain "toc") — were misclassifying a real content page as a stale ToC. That let the
  // refresh path clear (replaceElements → []) the user's actual notes. Never reintroduce
  // loose substrings here: it is the guard that protects against data loss.
  const SEARCH_TERMS = ['TABLE OF CONTENTS', 'TABLE OF CONTENT'];

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
const NON_STROKE_TYPES = new Set([100, 200, 500, 501, 502, 600, 700, 800]);

/**
 * Best-effort bounding box for a page element, tolerating the various shapes the native
 * layer may return (recognition corners, maxX/maxY corner, or an explicit rect).
 */
const getElemBBox = (elem: any): { left: number; top: number; right: number; bottom: number } | null => {
  const rr = elem?.recognizeResult;
  if (rr && typeof rr.up_left_point_x === 'number' && typeof rr.down_right_point_x === 'number'
      && (rr.up_left_point_x || rr.down_right_point_x || rr.up_left_point_y || rr.down_right_point_y)) {
    return { left: rr.up_left_point_x, top: rr.up_left_point_y, right: rr.down_right_point_x, bottom: rr.down_right_point_y };
  }
  const r = elem?.textBox?.textRect || elem?.textRect;
  if (r && typeof r.left === 'number') {
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  if (typeof elem?.maxX === 'number' && typeof elem?.maxY === 'number' && (elem.maxX || elem.maxY)) {
    return { left: elem.maxX, top: elem.maxY, right: elem.maxX, bottom: elem.maxY };
  }
  if (typeof elem?.X === 'number' && typeof elem?.Y === 'number') {
    return { left: elem.X, top: elem.Y, right: elem.X, bottom: elem.Y };
  }
  return null;
};

const recognizeTitleStrokes = async (
  titleItem: any,
  pageElements: any[],
  pageSize: { width: number; height: number } | null,
): Promise<string> => {
  try {
    if (!Array.isArray(pageElements) || pageElements.length === 0) return '';
    if (typeof titleItem?.X !== 'number' || typeof titleItem?.Y !== 'number') return '';

    const { PluginCommAPI } = require('sn-plugin-lib');
    if (!PluginCommAPI || typeof PluginCommAPI.recognizeElements !== 'function') return '';

    // Tight padding: the title box is precise, so keep it snug (especially vertically) to avoid
    // pulling in body-text strokes from the lines below the title.
    const padX = 40;
    const padY = 18;
    const left = titleItem.X - padX;
    const right = titleItem.X + (titleItem.width || 100) + padX;
    const top = titleItem.Y - padY;
    const bottom = titleItem.Y + (titleItem.height || 60) + padY;

    const strokes = pageElements.filter((elem: any) => {
      if (!elem) return false;
      if (NON_STROKE_TYPES.has(elem.type)) return false; // keep strokes (type 0) and unknowns
      const box = getElemBBox(elem);
      if (!box) return false;
      // Any overlap between the element box and the (padded) title box.
      return !(box.left > right || box.right < left || box.top > bottom || box.bottom < top);
    });

    if (strokes.length === 0) return '';

    const size = pageSize || { width: 1404, height: 1872 };
    const recRes: any = await PluginCommAPI.recognizeElements(strokes, size);

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

/**
 * Page-size-aware layout geometry for the ToC renderer.
 * All x/y are in the note's pixel coordinate space. Deriving these from the real
 * page size (via PluginFileAPI.getPageSize) is what keeps both portrait and
 * landscape correct and puts every link in one right-margin column.
 */
interface IndexLayout {
  leftMargin: number;
  rightMargin: number;
  linkLeft: number; // left x of the fixed link column (same for every row)
  pageNumLeft: number; // left x of the right-aligned page-number column
  titleRight: number; // right x the (truncatable) title text may occupy
  rowSpacing: number;
  headerTopY: number;
  ruleY: number; // y of the underline rule below the heading
  subtitleY: number; // y of the subtitle line
  firstRowY: number; // y of the first entry row
  rowsPerPage: number; // entries that fit on the page (footer row reserved)
  footerY: number; // y of the "Showing N of M" footer
}

function computeIndexLayout(pageWidth: number, pageHeight: number, fontSize: number): IndexLayout {
  const leftMargin = Math.round(pageWidth * 0.11); // ~150 on a 1404-wide portrait page
  const rightMargin = pageWidth - Math.round(pageWidth * 0.06); // ~1320 portrait
  const linkColW = Math.round(fontSize * 1.4);
  const linkLeft = rightMargin - linkColW; // identical x for every row's ↗
  const pageNumColW = Math.round(fontSize * 3.6); // fits "p. NNN"
  const pageNumLeft = linkLeft - Math.round(fontSize * 0.6) - pageNumColW;
  const titleRight = pageNumLeft - Math.round(fontSize * 0.4);
  const rowSpacing = Math.round(fontSize * 1.6); // roomier than the old *1.5
  const headerTopY = Math.round(pageHeight * 0.09); // ~168 portrait
  const ruleY = headerTopY + Math.round(fontSize * 1.9);
  const subtitleY = ruleY + Math.round(fontSize * 1.1);
  const firstRowY = subtitleY + Math.round(fontSize * 2.0);
  const bottomMargin = Math.round(pageHeight * 0.05);
  const rowsPerPage = Math.max(
    8,
    Math.floor((pageHeight - firstRowY - bottomMargin) / rowSpacing) - 1, // -1 reserves the footer row
  );
  const footerY = firstRowY + rowsPerPage * rowSpacing;
  return {
    leftMargin, rightMargin, linkLeft, pageNumLeft, titleRight,
    rowSpacing, headerTopY, ruleY, subtitleY, firstRowY, rowsPerPage, footerY,
  };
}

/**
 * Truncate a title so "{prefix}{title}" fits the given pixel width, appending an
 * ellipsis when clipped. Width is estimated (no text-measure API on this path);
 * the 0.52 factor is the tuning knob if titles look too tight/loose on device.
 */
function fitTitle(prefix: string, title: string, availableWidth: number, fontSize: number): string {
  const maxChars = Math.max(4, Math.floor(availableWidth / (fontSize * 0.52)));
  const full = `${prefix}${title}`;
  if (full.length <= maxChars) return full;
  return `${full.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * Title + a classic dot leader, sized to stay WITHIN the title element's frame.
 * The dot count is estimated from the fitted title's width (no text-measure API), so
 * right ends are slightly ragged across rows — that is acceptable and, critically,
 * safe: the Supernote note core mishandles text that overflows a fixed-width text box
 * (it drops/garbles the element), so we must never overfill. We deliberately underfill
 * by ~1 dot. `0.30`/`0.52` are the tuning knobs.
 */
function titleWithLeader(prefix: string, title: string, availableWidth: number, fontSize: number): string {
  const charW = fontSize * 0.52; // avg glyph width (same factor as fitTitle)
  const dotW = fontSize * 0.30;  // '.' leader width estimate
  const gapW = fontSize * 0.5;   // space between title and dots
  // Reserve room for at least a few dots so short titles still get a leader.
  const fitted = fitTitle(prefix, title, availableWidth - gapW - dotW * 3, fontSize);
  const usedW = fitted.length * charW + gapW;
  // Underfill by ~1 dot so the text never overruns the frame.
  const dotCount = Math.max(3, Math.floor((availableWidth - usedW - dotW) / dotW));
  return `${fitted} ${'.'.repeat(dotCount)}`;
}

/** A row of box-drawing chars spanning [leftMargin, rightMargin] for the heading rule. */
function ruleText(leftMargin: number, rightMargin: number, fontSize: number): string {
  const count = Math.max(1, Math.floor((rightMargin - leftMargin) / (fontSize * 0.5)));
  return '─'.repeat(count);
}

/** Basename of a note path with the extension stripped, for the subtitle line. */
function noteDisplayName(notePath: string): string {
  const base = (notePath || '').split('/').pop() || 'Note';
  return base.replace(/\.[^.]+$/, '') || 'Note';
}

/**
 * Subtitle shown under the heading: "{note name}  ·  Generated {date}, {h:mm AM/PM}".
 * Time is built by hand rather than via Intl/toLocaleString options, whose support
 * is unreliable under Hermes (plain toLocaleDateString already works in this runtime).
 */
function generatedSubtitle(notePath: string): string {
  const now = new Date();
  const h24 = now.getHours();
  const h12 = (h24 % 12) || 12;
  const mm = now.getMinutes().toString().padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${noteDisplayName(notePath)}  ·  Generated ${now.toLocaleDateString()}, ${h12}:${mm} ${ampm}`;
}

export class IndexService {
  /**
   * Fetch all headings / titles across pages of the specified note file.
   */
  static async scanHeadings(
    notePath: string,
    onPhase?: (phase: 'scanning' | 'recognizing') => void,
  ): Promise<HeadingItem[]> {
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

      // Only treat page 0 as the excluded "ToC page" when it actually contains a ToC header.
      // Before a ToC exists (or after the user deletes it), page 0 is normal content and its
      // titles are real headings that must not be dropped.
      let page0IsToc = false;
      try {
        const p0Res: any = await PluginFileAPI.getElements(0, notePath);
        const p0Elems = Array.isArray(p0Res) ? p0Res : (p0Res?.result || p0Res?.data || []);
        page0IsToc = Array.isArray(p0Elems) && p0Elems.some((e: any) => isTocElement(e));
      } catch (e) {}

      const pageElementsMap = new Map<number, any[]>();
      const pageSizeMap = new Map<number, { width: number; height: number }>();
      const missingTextPages = new Set<number>();

      // A title is on the excluded ToC page only when page 0 truly holds a ToC.
      const isExcludedPage = (rawPg: number) => rawPg === 0 && page0IsToc;

      for (let i = 0; i < rawTitles.length; i++) {
        const item = rawTitles[i];
        if (item) {
          const rawPg = typeof item.page === 'number' ? item.page : (parseInt(item.page, 10) || 0);
          if (!isExcludedPage(rawPg)) {
            const headingText = extractTitleString(item);
            if (!headingText) {
              missingTextPages.add(rawPg);
            }
          }
        }
      }

      if (missingTextPages.size > 0) {
        // Some titles have no typed text — we're about to run handwriting recognition,
        // which is the slow part. Tell the caller so it can update its progress message.
        onPhase?.('recognizing');
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

      // Load user title overrides up front so an unreadable title the user has manually
      // renamed is kept, while unreadable *unnamed* titles are skipped (never auto-named).
      let overrides: Record<string, string> = {};
      try { overrides = (await StorageService.getHeadingOverrides(notePath)) || {}; } catch (e) {}

      for (let i = 0; i < rawTitles.length; i++) {
        const item = rawTitles[i];
        if (!item) continue;

        const rawPg = typeof item.page === 'number' ? item.page : (parseInt(item.page, 10) || 0);

        // Skip titles on page 0 only when page 0 is genuinely a generated ToC page.
        if (isExcludedPage(rawPg)) continue;

        const pageDisplay = rawPg + 1;
        const ord = perPageOrdinal.get(rawPg) || 0;
        perPageOrdinal.set(rawPg, ord + 1);

        // Stable per-title identity for override matching: prefer the title's page position
        // (survives re-scan unless the user moves the title); fall back to per-page ordinal.
        // Assigned before the skip below so id numbering stays stable across scans.
        let id = (typeof item.X === 'number' && typeof item.Y === 'number')
          ? `p${rawPg}_y${Math.round(item.Y)}_x${Math.round(item.X)}`
          : `p${rawPg}_i${ord}`;
        if (usedIds.has(id)) {
          let n = 1;
          const base = id;
          while (usedIds.has(id)) id = `${base}#${n++}`;
        }
        usedIds.add(id);

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

        // No typed text and no recognizable handwriting: skip this title entirely rather
        // than invent a bogus "Heading N" — unless the user has manually named it.
        if (!headingText && !overrides[id]) {
          continue;
        }

        headings.push({
          id,
          title: headingText,
          page: pageDisplay,
        });
      }

      // Apply custom title overrides from user edits (loaded above).
      try {
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
   * Insert or update the Table of Contents on Page 1 with per-row try/catch error boundaries.
   */
  static async generateTocPage(
    notePath: string,
    customFontSize?: number,
    onPhase?: (phase: 'scanning' | 'recognizing') => void,
  ): Promise<GenerateResult> {
    if (!notePath) return { success: false, message: 'No active note open' };
    try {
      const { PluginFileAPI, PluginNoteAPI, PluginCommAPI } = require('sn-plugin-lib');

      const readPage = async (p: number): Promise<any[]> => {
        const r: any = await PluginFileAPI.getElements(p, notePath).catch(() => null);
        return Array.isArray(r) ? r : (r?.result || r?.data || []);
      };
      const readCurrentPage = async (): Promise<number> => {
        const r: any = await PluginCommAPI.getCurrentPageNum().catch(() => null);
        return typeof r?.result === 'number' ? r.result : (typeof r === 'number' ? r : -1);
      };

      // Classify the CURRENT page BEFORE any expensive scan/recognition, so an unusable
      // target is reported instantly. insertText writes to whatever page is current:
      // blank → write here; existing ToC → refresh in place; real content → refuse
      // (never overwrite). We do NOT auto-insert a page — programmatic page insertion
      // corrupts the page shown in the viewer, so the user adds a blank page themselves.
      const NOT_BLANK_MSG =
        'The Table of Contents is written on the current page and never overwrites your notes, open or add a blank page, then tap Build ToC.';

      const startPage = await readCurrentPage();
      if (startPage < 0) {
        return { success: false, message: 'Could not read the current page. Open the note to a blank page where the ToC should go, then tap Build.' };
      }
      const startElems = await readPage(startPage);
      const startHasToc = startElems.some((e: any) => isTocElement(e));
      const startHasContent = startElems.length > 0 && !startHasToc;

      // Real content on this page → stop immediately, before any scanning/recognition.
      if (startHasContent) {
        return { success: false, needsBlankPage: true, message: NOT_BLANK_MSG };
      }

      // Page is writable (blank or an existing ToC) → now run the expensive scan.
      const headings = await this.scanHeadings(notePath, onPhase);
      if (headings.length === 0) {
        return { success: false, message: 'No titles or headings found in this note.' };
      }

      // Existing ToC on this page → refresh in place: clear it now that we know there
      // are headings to write (so a refresh never wipes an old ToC only to write nothing).
      if (startHasToc) {
        try {
          await PluginNoteAPI.saveCurrentNote();
          await PluginFileAPI.replaceElements(notePath, startPage, []);
          await PluginCommAPI.reloadFile();
          const rem = await readPage(startPage);
          if (rem.length > 0) {
            // numInPage is 1-based as of sn-plugin-lib 0.1.65 (deleteElements now rejects 0),
            // so the positional fallback must be i + 1, not i.
            await PluginFileAPI.deleteElements(notePath, startPage, rem.map((e: any, i: number) => (typeof e?.numInPage === 'number' && e.numInPage >= 1 ? e.numInPage : i + 1)));
            await PluginCommAPI.reloadFile();
          }
        } catch (e) { console.warn('clear ToC error:', e); }
      }

      // HARD GUARD: insertText writes to whatever page is CURRENT right now. Only write if
      // that page is empty, so notes are never overwritten (final safety net).
      const target = await readCurrentPage();
      const targetElems = target >= 0 ? await readPage(target) : [1];
      if (target < 0 || targetElems.length > 0) {
        return { success: false, needsBlankPage: true, message: NOT_BLANK_MSG };
      }
      const totalPagesRes: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      const totalPages = typeof totalPagesRes === 'number'
        ? totalPagesRes
        : (typeof totalPagesRes?.result === 'number' ? totalPagesRes.result : (totalPagesRes?.data || 1));

      const fontSize = customFontSize || (await StorageService.getInsertFontSize()) || 36;
      const headerFontSize = fontSize + 6;
      const linkFontSize = Math.round(fontSize * 0.85);
      const subtitleFontSize = Math.max(18, fontSize - 12);

      // Derive the whole layout from the REAL page size so portrait and landscape both
      // fit and every link lands in one right-margin column (mirrors App.tsx getPageSize use).
      let pageWidth = 1404, pageHeight = 1872;
      const sizeRes: any = await PluginFileAPI.getPageSize(notePath, target).catch(() => null);
      if (sizeRes?.success && sizeRes.result) {
        pageWidth = sizeRes.result.width;
        pageHeight = sizeRes.result.height;
      }
      const L = computeIndexLayout(pageWidth, pageHeight, fontSize);

      // Heading, underline rule, and subtitle (note name + date).
      try {
        await PluginNoteAPI.insertText({
          textContentFull: 'TABLE OF CONTENTS',
          textRect: { left: L.leftMargin, top: L.headerTopY, right: L.rightMargin, bottom: L.headerTopY + 70 },
          fontSize: headerFontSize, textAlign: 0, textBold: 1, textItalics: 0,
          textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
        });
        await PluginNoteAPI.insertText({
          textContentFull: ruleText(L.leftMargin, L.rightMargin, fontSize),
          textRect: { left: L.leftMargin, top: L.ruleY, right: L.rightMargin, bottom: L.ruleY + Math.round(fontSize * 0.9) },
          fontSize, textAlign: 0, textBold: 0, textItalics: 0,
          textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
        });
        await PluginNoteAPI.insertText({
          textContentFull: generatedSubtitle(notePath),
          textRect: { left: L.leftMargin, top: L.subtitleY, right: L.rightMargin, bottom: L.subtitleY + Math.round(subtitleFontSize * 1.3) },
          fontSize: subtitleFontSize, textAlign: 0, textBold: 0, textItalics: 1,
          textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
        });
      } catch (e) { console.warn('insertText header error:', e); }

      const displayChunk = headings.slice(0, L.rowsPerPage);
      for (let idx = 0; idx < displayChunk.length; idx++) {
        const h = displayChunk[idx];
        const itemY = L.firstRowY + (idx * L.rowSpacing);

        // 1. Title (truncated with an ellipsis if too long) + gap-filling dot leader — left-aligned.
        const titleText = titleWithLeader(`${idx + 1}. `, h.title, L.titleRight - L.leftMargin, fontSize);
        try {
          await PluginNoteAPI.insertText({
            textContentFull: titleText,
            textRect: { left: L.leftMargin, top: itemY, right: L.titleRight, bottom: itemY + Math.round(fontSize * 1.3) },
            fontSize, textAlign: 0, textBold: 0, textItalics: 0,
            textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
          });
        } catch (e) { console.warn(`insertText row ${idx} error:`, e); }

        // 2. Page number — right-aligned in its own column (textAlign 2 = right).
        try {
          await PluginNoteAPI.insertText({
            textContentFull: `p. ${h.page}`,
            textRect: { left: L.pageNumLeft, top: itemY, right: L.linkLeft - Math.round(fontSize * 0.4), bottom: itemY + Math.round(fontSize * 1.3) },
            fontSize, textAlign: 2, textBold: 0, textItalics: 0,
            textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
          });
        } catch (e) { console.warn(`insertText pagenum ${idx} error:`, e); }

        // 3. Link ↗ — fixed right-margin column, identical x for every row.
        const safeDestPage = Math.min(totalPages - 1, Math.max(0, h.page - 1));
        try {
          await PluginNoteAPI.insertTextLink({
            destPath: notePath, destPage: safeDestPage, style: 0, linkType: 0,
            rect: { left: L.linkLeft, top: itemY, right: L.rightMargin, bottom: itemY + Math.round(linkFontSize * 1.2) },
            fontSize: linkFontSize, fullText: '↗', showText: '↗', isItalic: 0,
          });
        } catch (e) { console.warn(`insertTextLink row ${idx} error:`, e); }
      }

      // Footer noting truncation when the note has more headings than fit on one page.
      if (headings.length > displayChunk.length) {
        const footerFontSize = Math.max(18, fontSize - 12);
        try {
          await PluginNoteAPI.insertText({
            textContentFull: `Showing ${displayChunk.length} of ${headings.length} entries`,
            textRect: { left: L.leftMargin, top: L.footerY, right: L.rightMargin, bottom: L.footerY + Math.round(footerFontSize * 1.3) },
            fontSize: footerFontSize, textAlign: 0, textBold: 0, textItalics: 1,
            textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
          });
        } catch (e) { console.warn('insertText footer error:', e); }
      }

      try {
        await PluginNoteAPI.saveCurrentNote();
        await PluginCommAPI.reloadFile();
      } catch (e) { console.warn('save/reload error:', e); }

      return { success: true, message: `Table of Contents created on page ${target + 1}.`, headings };
    } catch (e: any) {
      console.error('Failed to generate ToC page:', e);
      return { success: false, message: e?.message || 'Failed to generate ToC page' };
    }
  }
}
