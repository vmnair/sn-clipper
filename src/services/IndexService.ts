// SnClipper/src/services/IndexService.ts
// Vinod Nair

import { StorageService } from './StorageService';
import { PermissionService } from './PermissionService';
import { pollForTargetPage } from '../utils/pageNav';

export interface HeadingItem {
  id: string; // Stable per-title identity (survives re-scan) used to key user title overrides
  title: string;
  page: number; // 1-indexed page number for display
  style?: number; // Raw SDK style (1: black background, 2: gray-white, 3: gray-black, 4: shadow)
  level?: number; // Adaptive 1-indexed hierarchy level (1, 2, 3, 4)
  numberLabel?: string; // Hierarchical decimal number label (e.g. '1.', '1.1', '1.2', '2.', '2.1')
  y?: number;
  x?: number;
}

export interface GenerateResult {
  success: boolean;
  message?: string;
  needsBlankPage?: boolean; // page 1 has user content; caller should prompt to insert a blank page
  headings?: HeadingItem[]; // headings used to build the ToC (so the caller can persist without re-scanning)
  error?: any;
}

const safeStringify = (obj: any): string => {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj || '');
  }
};

/**
 * Multi-page ToC is DESCOPED for 0.3.0 — design review 2026-09-04.
 *
 * Writing a continuation page means navigating the reader mid-write, and that navigation
 * cancels an in-flight page load while Ratta's native ink renderer is still drawing into
 * the page bitmap. The result is heap corruption inside the firmware:
 *
 *   signal 6 (SIGABRT) ... Scudo ERROR: invalid chunk state when deallocating
 *   librecgnition.so  drawShadow(TrailContainer&, CIMAGE*, ...)
 *
 * The note app dies mid-write, the plugin host is left holding a dead client, and the ToC
 * is half written. We cannot fix it, we could not reproduce it on demand, and so we can
 * never demonstrate its absence — see
 * `design_instance/reports/0.3.0-device-matrix-2026-09-04.md` §2.
 *
 * With the flag off, a ToC longer than one page writes one page and says so via the
 * "Showing first N of M headings" footer — the decline path, which passed on device twice.
 * Everything below the flag (the availability walk, the shortfall dialog, insertNotePage,
 * the page-shift arithmetic, the settle barrier) is PROVEN work and is deliberately kept,
 * not deleted: it re-enables the day Ratta fixes the renderer race. Do not "clean up" the
 * code it guards as unreachable.
 */
const TOC_PAGINATION = false;

/** Live value of the descope flag. Only `setTocPaginationEnabled` may change it. */
let tocPaginationEnabled = TOC_PAGINATION;

/**
 * The shapes of the elements THIS PLUGIN writes onto a ToC page, used to decide whether a
 * page is entirely ours — safe to clear and rewrite — or holds something of the user's.
 *
 * Matching is on element SHAPE and is whole-string anchored. It is never a loose substring
 * over the stringified element: see the `isTocElement` comment for the data-loss bug that
 * rule exists to prevent. A row is recognised by the form we author (a dot leader, a
 * `p. <n>` column, an ↗ link into this same note), not by any word a user might also write.
 *
 * Why this exists: `isTocElement` matches only the header phrase, so on a real ToC page
 * every one of its ~21 rows counted as user content and the mixed-page guard refused every
 * refresh. Device matrix 2026-09-04 §5.
 */
const TOC_ROW_SHAPES: RegExp[] = [
  // Title row: `titleWithLeader` always ends with a space and at least 3 dot leaders.
  /\s\.{3,}$/,
  // Page-number column, written on its own as `p. 17`.
  /^p\.\s*\d+$/,
  // Truncation footer.
  /^Showing first \d+ of \d+ headings$/,
  // Subtitle, from `generatedSubtitle`: "{note}  ·  Generated {date}, {h:mm AM/PM}".
  /\s·\s+Generated\s.+\d{1,2}:\d{2}\s(AM|PM)$/,
];

/** Every string this element carries that could be its visible text. */
const elementTextCandidates = (elem: any): string[] => {
  const out: string[] = [];
  const push = (v: any) => {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t && t !== '[object Object]') out.push(t);
    }
  };
  if (!elem || typeof elem !== 'object') {
    push(elem);
    return out;
  }
  // Field names vary across element kinds (text boxes vs links), so gather the known
  // text-bearing keys at the top level and one level down rather than guessing one.
  const KEYS = ['textContentFull', 'showText', 'fullText', 'text', 'content', 'userData'];
  for (const k of KEYS) push(elem[k]);
  for (const nest of ['textBox', 'textLink', 'link']) {
    const n = elem[nest];
    if (n && typeof n === 'object') for (const k of KEYS) push(n[k]);
  }
  return out;
};

/**
 * True when this element is one WE wrote as part of a ToC row (not the header, which
 * `isTocElement` covers).
 */
const isTocRowElement = (elem: any, notePath?: string): boolean => {
  if (!elem) return false;
  const candidates = elementTextCandidates(elem);
  if (candidates.length === 0) return false; // a stroke has no text: never ours

  for (const txt of candidates) {
    // The ↗ jump link. Require it to point into this same note when we can tell: an
    // arrow linking somewhere else is not something this ToC wrote.
    if (txt === '↗') {
      const dest = elem.destPath || elem.textLink?.destPath || elem.link?.destPath;
      if (!notePath || !dest || dest === notePath) return true;
      continue;
    }
    if (TOC_ROW_SHAPES.some(re => re.test(txt))) return true;
  }
  return false;
};

export interface TocPageClass {
  isEmpty: boolean;   // nothing on the page at all
  hasToc: boolean;    // our TABLE OF CONTENTS header is present
  hasForeign: boolean; // something that is neither our header nor one of our row shapes
}

/**
 * Page-level classification (design review 2026-09-04, §5 option 1).
 *
 * A page counts as OURS only when the header is present AND every other element matches a
 * row shape we author. Anything else — a handwritten stroke, the user's own text box, our
 * rows with their header deleted — makes the page unusable, and we neither clear nor write
 * it.
 *
 * RESIDUAL RISK, accepted for 0.3.0 (review 2026-09-04b, point 1): a user's own TYPED text
 * box sitting on the ToC page would be classified as ours, and so cleared on refresh, if its
 * text happens to match an anchored shape — ending in " ..." (space + three dots), or being
 * exactly `p. <n>`. It is narrow: handwriting never matches (strokes carry no text and are
 * always foreign), and the box has to be on the ToC page itself. The real fix is the 0.4.0
 * userData-marker investigation, which identifies our rows by a marker we wrote rather than
 * by their shape.
 */
const classifyTocPage = (elems: any[], notePath?: string): TocPageClass => {
  const list = Array.isArray(elems) ? elems : [];
  let hasToc = false;
  let hasForeign = false;
  for (const e of list) {
    if (isTocElement(e)) { hasToc = true; continue; }
    if (isTocRowElement(e, notePath)) continue;
    hasForeign = true;
  }
  return { isEmpty: list.length === 0, hasToc, hasForeign };
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
  const headerTopY = Math.round(pageHeight * 0.08); // ~150 portrait
  const subtitleY = headerTopY + Math.round(fontSize * 1.6); // ~208 portrait
  const firstRowY = subtitleY + Math.round(fontSize * 2.2); // ~287 portrait (ample clear space)
  const bottomMargin = Math.round(pageHeight * 0.05);
  const rowsPerPage = Math.max(
    8,
    Math.floor((pageHeight - firstRowY - bottomMargin) / rowSpacing) - 1, // -1 reserves the footer row
  );
  const footerY = firstRowY + rowsPerPage * rowSpacing;
  return {
    leftMargin, rightMargin, linkLeft, pageNumLeft, titleRight,
    rowSpacing, headerTopY, subtitleY, firstRowY, rowsPerPage, footerY,
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
   * Turn the descoped multi-page machinery back on.
   *
   * TEST LEVER ONLY. The pagination unit tests are kept green against the machinery they
   * cover (design review 2026-09-04), so they need a way to reach it; nothing in the app
   * calls this. Re-enabling for real means flipping `TOC_PAGINATION`, and only once Ratta
   * has fixed the renderer race that made it unsafe.
   */
  static setTocPaginationEnabled(on: boolean): void {
    tocPaginationEnabled = on;
  }

  /** Restore the shipped default. Pairs with `setTocPaginationEnabled` in test teardown. */
  static resetTocPagination(): void {
    tocPaginationEnabled = TOC_PAGINATION;
  }

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

      // ---- §7 instrumentation ---------------------------------------------------------
      // The same note scanned three times on device returned 24, 24 then 16 headings
      // (device matrix 2026-09-04 §7). Silently losing a third of a user's headings is
      // worse than failing, so every scan now accounts for where each title went:
      // resolved by typed text, by the tight spatial classifier, by handwriting
      // recognition, by a user override — or dropped. Grep logcat for `ToC-scan:`.
      const tally = { raw: 0, excluded: 0, typed: 0, tight: 0, recognized: 0, override: 0, dropped: 0 };
      const droppedPages: number[] = [];

      // Load user title overrides up front so an unreadable title the user has manually
      // renamed is kept, while unreadable *unnamed* titles are skipped (never auto-named).
      let overrides: Record<string, string> = {};
      try { overrides = (await StorageService.getHeadingOverrides(notePath)) || {}; } catch (e) {}

      for (let i = 0; i < rawTitles.length; i++) {
        const item = rawTitles[i];
        if (!item) continue;
        tally.raw++;

        const rawPg = typeof item.page === 'number' ? item.page : (parseInt(item.page, 10) || 0);

        // Skip titles on page 0 only when page 0 is genuinely a generated ToC page.
        if (isExcludedPage(rawPg)) { tally.excluded++; continue; }

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
        let resolvedBy: keyof typeof tally | null = headingText ? 'typed' : null;

        // Strict spatial & length classifier (typed text boxes inside the title box)
        if (!headingText && pageElementsMap.has(rawPg)) {
          const rawElements = pageElementsMap.get(rawPg) || [];
          for (const elem of rawElements) {
            const matchedTxt = isTightHeadingTextForTitle(elem, item);
            if (matchedTxt) {
              headingText = matchedTxt;
              resolvedBy = 'tight';
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
          if (recognized) { headingText = recognized; resolvedBy = 'recognized'; }
        }

        // No typed text and no recognizable handwriting: skip this title entirely rather
        // than invent a bogus "Heading N" — unless the user has manually named it.
        if (!headingText && !overrides[id]) {
          tally.dropped++;
          if (!droppedPages.includes(pageDisplay)) droppedPages.push(pageDisplay);
          continue;
        }
        tally[resolvedBy || 'override']++;

        const rawStyle = typeof item.style === 'number' ? item.style : (parseInt(item.style, 10) || 1);

        headings.push({
          id,
          title: headingText,
          page: pageDisplay,
          style: rawStyle,
          y: typeof item.Y === 'number' ? item.Y : 0,
          x: typeof item.X === 'number' ? item.X : 0,
        });
      }

      // One line per scan, so a run that loses headings can be compared against one that
      // did not without re-instrumenting. `dropped` is the number that matters.
      console.log(
        `ToC-scan: pages=${totalPages} rawTitles=${tally.raw} excluded=${tally.excluded} ` +
        `typed=${tally.typed} tight=${tally.tight} recognized=${tally.recognized} ` +
        `override=${tally.override} dropped=${tally.dropped}` +
        (tally.dropped > 0 ? ` droppedOnPages=[${droppedPages.join(',')}]` : '') +
        ` needingRecognition=${missingTextPages.size}`,
      );

      // Apply custom title overrides from user edits (loaded above).
      try {
        for (const h of headings) {
          if (overrides[h.id]) {
            h.title = overrides[h.id];
          }
        }
      } catch (e) {}

      // Sort in visual reading order: page ascending, top-to-bottom (Y), left-to-right (X).
      headings.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        if ((a.y ?? 0) !== (b.y ?? 0)) return (a.y ?? 0) - (b.y ?? 0);
        return (a.x ?? 0) - (b.x ?? 0);
      });

      // Adaptive style mapping by usage: rank styles in order of first appearance.
      // The style of the first heading encountered becomes level 1; each additional distinct
      // style becomes the next level in order of first appearance. If a note uses only 1 style,
      // all headings stay flat at level 1.
      const encounteredStyles: number[] = [];
      for (const h of headings) {
        const s = typeof h.style === 'number' && h.style > 0 ? h.style : 1;
        if (!encounteredStyles.includes(s)) {
          encounteredStyles.push(s);
        }
        h.level = encounteredStyles.indexOf(s) + 1;
      }

      // Hierarchical decimal numbering (global across all ToC pages):
      // Level 1: '1.', '2.', '3.' (with trailing dot)
      // Deeper levels: '1.1', '1.2', '2.1', '1.1.1' (no trailing dot)
      // Counters reset whenever a higher-level heading appears.
      const counters: number[] = [];
      for (const h of headings) {
        let level = h.level || 1;
        // Clamp level skips: a heading can never sit more than one level deeper than
        // the structure actually present above it. Without this, a level-3 heading
        // under a level-1 parent (no level-2 between) leaves a hole in the counter
        // array and join('.') renders "2..1".
        if (level > counters.length + 1) level = counters.length + 1;
        h.level = level; // keep the indent consistent with the printed label
        counters[level - 1] = (counters[level - 1] || 0) + 1;
        counters.length = level; // reset all deeper counters
        h.numberLabel = counters.join('.') + (level === 1 ? '.' : '');
      }

      return headings;
    } catch (e) {
      console.error('Failed to scan headings:', e);
      return [];
    }
  }

  /**
   * Insert or update the Table of Contents on Page 1 with per-row try/catch error boundaries.
   */
  /**
   * Build or refresh the Table of Contents.
   *
   * `onNeedPages` is asked ONCE per run, only when the headings need more pages than are
   * already available, and only for the shortfall. Returning false is a normal outcome:
   * the ToC is written as far as it fits and says so. The callback exists because the
   * decision is the user's and the dialog lives in the UI layer, not here.
   */
  static async generateTocPage(
    notePath: string,
    customFontSize?: number,
    onPhase?: (phase: 'scanning' | 'recognizing') => void,
    onNeedPages?: (pagesNeeded: number) => Promise<boolean>,
    onFewerHeadings?: (found: number, previous: number) => Promise<boolean>,
  ): Promise<GenerateResult> {
    if (!notePath) return { success: false, message: 'No active note open' };
    try {
      const { PluginFileAPI, PluginNoteAPI, PluginCommAPI, PluginManager, FileUtils } = require('sn-plugin-lib');

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
      const MIXED_PAGE_MSG =
        'This ToC page also contains your own content; refreshing would delete it. Move your content off this page, or delete the old ToC by hand, then try again.';

      const startPage = await readCurrentPage();
      if (startPage < 0) {
        return { success: false, message: 'Could not read the current page. Open the note to a blank page where the ToC should go, then tap Build.' };
      }
      const startElems = await readPage(startPage);
      // Page-level classification, not element-by-element (design review 2026-09-04 §5).
      // Testing each element against `isTocElement` alone judged every ToC ROW to be user
      // content — only the header carries the phrase — so the mixed-page guard below
      // refused every single refresh. A page is ours when the header is there and
      // everything else matches a row shape we author.
      //
      // A mixed page is still refused: the clear used to remove the user's elements along
      // with our rows, a latent data-deletion path (review 2026-09-03c Q2). Selective
      // row-level refresh around user annotations is 0.4.0 work.
      const startCls = classifyTocPage(startElems, notePath);
      const startHasToc = startCls.hasToc;
      const startIsOurs = startCls.hasToc && !startCls.hasForeign;

      // Anything on this page that is not entirely our own ToC → stop immediately, before
      // any scanning or recognition.
      if (!startCls.isEmpty && !startIsOurs) {
        return {
          success: false,
          needsBlankPage: true,
          message: startHasToc ? MIXED_PAGE_MSG : NOT_BLANK_MSG,
        };
      }

      // Page is writable (blank or an existing ToC) → now run the expensive scan.
      const headings = await this.scanHeadings(notePath, onPhase);
      if (headings.length === 0) {
        return { success: false, message: 'No titles or headings found in this note.' };
      }

      // Heading loss is not always visible: on device the same note scanned 24, 24, then
      // 16 headings, and the short result looked like a perfectly good ToC (device matrix
      // 2026-09-04 §7). Until the cause is known, turn the silent loss into a choice —
      // asked BEFORE the clear below, so declining leaves the existing ToC untouched.
      let lastBuiltCount = 0;
      try {
        const last = await StorageService.getTocLastBuild(notePath);
        lastBuiltCount = last?.count || 0;
      } catch (e) {}
      if (lastBuiltCount > 0 && headings.length < lastBuiltCount && onFewerHeadings) {
        let proceed = true;
        try { proceed = await onFewerHeadings(headings.length, lastBuiltCount); } catch (e) { proceed = false; }
        if (!proceed) {
          return {
            success: false,
            message: `Kept the existing Table of Contents. This scan found ${headings.length} headings; the last build found ${lastBuiltCount}.`,
          };
        }
      }

      // Existing ToC on this page → refresh in place: clear it now that we know there
      // are headings to write (so a refresh never wipes an old ToC only to write nothing).
      // Wipe one page's elements. Returns a failure result to propagate, or null on success.
      const clearPageElements = async (p: number): Promise<GenerateResult | null> => {
        try {
          await PluginNoteAPI.saveCurrentNote();
          const repRes: any = await PluginFileAPI.replaceElements(notePath, p, []);
          if (repRes && repRes.success === false && PermissionService.isPermissionError(repRes)) {
            return {
              success: false,
              error: repRes.error || repRes,
              message: PermissionService.messageForError(repRes) || 'Permission denied while clearing ToC.',
            };
          }
          await PluginCommAPI.reloadFile();
          const rem = await readPage(p);
          if (rem.length > 0) {
            // numInPage is 1-based as of sn-plugin-lib 0.1.65 (deleteElements now rejects 0),
            // so the positional fallback must be i + 1, not i.
            const delRes: any = await PluginFileAPI.deleteElements(notePath, p, rem.map((e: any, i: number) => (typeof e?.numInPage === 'number' && e.numInPage >= 1 ? e.numInPage : i + 1)));
            if (delRes && delRes.success === false && PermissionService.isPermissionError(delRes)) {
              return {
                success: false,
                error: delRes.error || delRes,
                message: PermissionService.messageForError(delRes) || 'Permission denied while deleting ToC elements.',
              };
            }
            await PluginCommAPI.reloadFile();
          }
        } catch (e: any) {
          if (PermissionService.isPermissionError(e)) {
            return {
              success: false,
              error: e.error || e,
              message: PermissionService.messageForError(e) || 'Permission denied while modifying ToC.',
            };
          }
          console.warn('clear ToC error:', e);
        }
        return null;
      };

      // Read the page count before clearing so the forward scan below is bounded. An
      // unbounded walk would hang if every page reported ToC elements.
      const totalPagesRes0: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      const totalPagesEarly = typeof totalPagesRes0 === 'number'
        ? totalPagesRes0
        : (typeof totalPagesRes0?.result === 'number' ? totalPagesRes0.result : (totalPagesRes0?.data || 1));

      // ---- Everything that INFORMS a decision is read here, before the first write -----
      //
      // Measured on device (Chauvet 3.29.44_beta): once anything has been written this
      // session, getElements(p) serves a STALE layout for any page that is not the current
      // one — it returned the just-written neighbour's exact element count for a blank page,
      // and saveCurrentNote + reloadFile did NOT refresh it. A guard that re-reads after
      // writing is therefore not a safety net, it is a coin flip; here it landed on
      // "silently drop the continuation chunk". So the target page, the pages that may be
      // reused, and the ToC pages to clear are all decided now, on a fresh layout, and the
      // write loop trusts that plan. Pages this run creates are blank by construction and
      // are never read at all. See reports/0.3.0-item-9-device-pass-2026-09-03.md.

      // HARD GUARD (per review 2026-09-03b decision 2): insertText writes to whatever page
      // is CURRENT, so that page must hold nothing but a ToC of ours. That check already
      // happened above, before scanHeadings — and it needs no re-verification: startPage is
      // the current page, and a read of the current page is the one read the stale-layout
      // defect never corrupts. `startPage < 0` was likewise rejected there.
      //
      // (The navigate-then-read pattern from 2026-09-03b remains the right way to confirm a
      // refusal on a NON-current page. There is no such check today, so it has no caller;
      // it was removed rather than left as unreachable code — review 2026-09-03d.)
      const target = startPage;

      const fontSizePre = customFontSize || (await StorageService.getInsertFontSize()) || 36;
      let pageWidthPre = 1404, pageHeightPre = 1872;
      const sizeResPre: any = await PluginFileAPI.getPageSize(notePath, target).catch(() => null);
      if (sizeResPre?.success && sizeResPre.result) {
        pageWidthPre = sizeResPre.result.width;
        pageHeightPre = sizeResPre.result.height;
      }
      const rowsPerPage = computeIndexLayout(pageWidthPre, pageHeightPre, fontSizePre).rowsPerPage;
      // Descope gate (see TOC_PAGINATION). Capping the need at one page here is what makes
      // the rest fall into place: the shortfall becomes 0, so no dialog is raised and
      // insertNotePage is never called, and the write loop runs a single iteration so the
      // reader is never navigated mid-write. The overflow is reported by the footer.
      const pagesNeeded = tocPaginationEnabled
        ? Math.max(1, Math.ceil(headings.length / rowsPerPage))
        : 1;

      // Which following pages are reusable, and which hold an old ToC we should clear.
      // Both decided here so neither is polluted by our own writes.
      const tocPagesToClear: number[] = startIsOurs ? [startPage] : [];
      let pagesAvailable = 1;        // the ToC page itself
      let writePlanClosed = false;   // set once user content is seen: never write past it

      // Two different questions are answered by this one walk, and they stop at different
      // points (review 2026-09-03c Q1):
      //
      //  - WHERE MAY WE WRITE? Only blank or reclaimable pages that run consecutively from
      //    the ToC page. The plan closes at the first page holding any user element and
      //    never reopens.
      //  - WHAT MUST WE CLEAR? Every page that is ENTIRELY our own ToC, wherever it sits —
      //    including past user content. A stale continuation page is not merely untidy: it
      //    carries live-looking jump links with wrong page numbers.
      //
      // Mixed pages (our rows plus user elements) are left completely alone: not cleared,
      // not written. Selective row-level deletion is 0.4.0 work, not something to add to
      // the data-destruction path at the end of a release.
      //
      // The clearing sweep is limited to a refresh (startHasToc). Building a fresh ToC on a
      // blank page has no "old ToC of ours" to tidy, and sweeping the whole note in that
      // case could wipe a second ToC the user built deliberately elsewhere. Narrower than
      // "wherever they sit" reads literally; see the report for the reasoning.
      for (let p = target + 1; p < totalPagesEarly; p++) {
        const els = await readPage(p);
        const cls = classifyTocPage(els, notePath);

        // Blank page: reusable.
        if (cls.isEmpty) {
          if (!writePlanClosed && pagesAvailable < pagesNeeded) pagesAvailable++;
          continue;
        }

        // Entirely our own ToC page.
        if (cls.hasToc && !cls.hasForeign) {
          if (startIsOurs) {
            tocPagesToClear.push(p);
            if (!writePlanClosed && pagesAvailable < pagesNeeded) pagesAvailable++;
          } else {
            writePlanClosed = true; // someone else's ToC; leave it and do not write past it
          }
          continue;
        }

        // The user's content, a mixed page, or ToC rows whose header is gone. Never write
        // past here, and never clear it — but keep walking for stale ToC pages beyond.
        writePlanClosed = true;
      }

      // ---- First write happens below this line; no read after it decides anything ------
      //
      // Accepted risk (review 2026-09-03b): the old ToC is cleared before the new one is
      // written, so a failure between the two leaves the page blank. The content is
      // regenerated rather than the user's, the modal blocks interaction while this runs,
      // and deciding everything up front shrinks the window to the writes themselves.
      for (const tp of tocPagesToClear) {
        const err = await clearPageElements(tp);
        if (err) return err;
      }

      const totalPages = totalPagesEarly;

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

      // ---- Work out how many pages this ToC needs, and get them ----------------------
      //
      // insertText writes to whatever page is CURRENT, so a multi-page ToC is written one
      // page at a time: fill the current page, move to the next, fill that. Pages that
      // already follow the ToC and are blank get used as-is; only the shortfall is created,
      // and only with the user's consent.
      // rowsPerPage / pagesNeeded / pagesAvailable were all decided before the first
      // write, above. Nothing is re-read here on purpose.

      let pagesCreated = 0;
      const shortfall = pagesNeeded - pagesAvailable;
      if (shortfall > 0 && onNeedPages) {
        let approved = false;
        try { approved = await onNeedPages(shortfall); } catch (e) { approved = false; }
        if (approved) {
          // insertNotePage needs `template` to be a real image file on disk. A style name
          // from getNotePageTemplate fails with code 802 — that error was once mistaken for
          // the API being unimplemented; see reports/0.3.0-insertNotePage-retest-2026-09-03.md.
          // Render the ToC page's own background once and reuse it for every page added.
          let tplPng = '';
          try {
            const dir = await PluginManager.getPluginDirPath();
            if (dir) {
              tplPng = `${dir}/tpl_${Date.now()}.png`;
              await PluginFileAPI.generateNoteTemplatePng(notePath, target, tplPng);
            }
          } catch (e) { console.warn('generateNoteTemplatePng error:', e); }

          for (let k = 0; k < shortfall && tplPng; k++) {
            try {
              // Insert AT the index just past the ToC pages so the continuation stays with
              // the ToC rather than landing at the end of the note.
              const at = target + pagesAvailable;
              const insRes: any = await PluginFileAPI.insertNotePage({ notePath, page: at, template: tplPng });
              if (!insRes || insRes.success === false) {
                if (PermissionService.isPermissionError(insRes)) {
                  return {
                    success: false,
                    error: insRes.error || insRes,
                    message: PermissionService.messageForError(insRes) || 'Permission denied while adding a page.',
                  };
                }
                break; // stop asking for more; write what we can
              }
              await PluginNoteAPI.saveCurrentNote();
              await PluginCommAPI.reloadFile();
              pagesAvailable++;
              pagesCreated++;
            } catch (e) { console.warn('insertNotePage error:', e); break; }
          }
          try { await FileUtils.deleteFile(tplPng); } catch (e) { /* swept later if this fails */ }
        }
      }

      // Inserting pages after the ToC pushes every later page down, which would leave every
      // scanned heading pointing one page short. Shift them before anything is written.
      if (pagesCreated > 0) {
        for (const h of headings) {
          if ((h.page - 1) > target) h.page += pagesCreated;
        }
      }
      const totalPagesNow = totalPages + pagesCreated;

      const pagesToWrite = Math.min(pagesNeeded, pagesAvailable);

      // ---- Write the ToC, one page at a time -----------------------------------------
      let written = 0;
      for (let c = 0; c < pagesToWrite; c++) {
        const pageIndex = target + c;

        if (c > 0) {
          // Move the reader before writing, and confirm it actually arrived — insertText
          // would otherwise pile the next chunk onto the page still on screen.
          //
          // 8s, not the insert flow's 3-4s: a page was very likely just created here, and
          // insertNotePage + saveCurrentNote + reloadFile on a large note can leave the
          // reader catching up for several seconds. Measured on a 56MB / 57-page note,
          // 4s expired before it arrived and the continuation chunk was silently skipped.
          const settled = await pollForTargetPage(pageIndex, 8000);
          if (!settled) {
            console.warn(`ToC: reader did not reach page ${pageIndex}; stopped after ${written} rows`);
            break;
          }
          // Deliberately NO empty-check here. This page was either recorded as blank on a
          // fresh layout before any write, or created by this run. Re-reading it now would
          // return a stale layout and falsely report it occupied, which is exactly what
          // silently dropped the continuation chunk on build 340.
        }

        try {
          await PluginNoteAPI.insertText({
            textContentFull: c === 0 ? 'TABLE OF CONTENTS' : 'TABLE OF CONTENTS (cont.)',
            textRect: { left: L.leftMargin, top: L.headerTopY, right: L.rightMargin, bottom: L.headerTopY + Math.round(headerFontSize * 1.3) },
            fontSize: headerFontSize, textAlign: 0, textBold: 1, textItalics: 0,
            textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
          });
          if (c === 0) {
            await PluginNoteAPI.insertText({
              textContentFull: generatedSubtitle(notePath),
              textRect: { left: L.leftMargin, top: L.subtitleY, right: L.rightMargin, bottom: L.subtitleY + Math.round(subtitleFontSize * 1.3) },
              fontSize: subtitleFontSize, textAlign: 0, textBold: 0, textItalics: 1,
              textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
            });
          }
        } catch (e) { console.warn('insertText header error:', e); }

        const chunk = headings.slice(c * rowsPerPage, (c + 1) * rowsPerPage);
        for (let idx = 0; idx < chunk.length; idx++) {
          const h = chunk[idx];
          const itemY = L.firstRowY + (idx * L.rowSpacing);

          // 1. Title (truncated with an ellipsis if too long) + gap-filling dot leader — left-aligned with level indentation.
          const level = h.level || 1;
          const indentStep = Math.round(fontSize * 0.8); // ~28px indent per level at font 36
          const rowLeftMargin = L.leftMargin + (level - 1) * indentStep;
          const availableTitleWidth = L.titleRight - rowLeftMargin;
          // numberLabel is computed globally before chunking, so numbering stays continuous
          // across pages rather than restarting at 1 on each.
          const prefix = h.numberLabel ? `${h.numberLabel} ` : '';
          const titleText = titleWithLeader(prefix, h.title, availableTitleWidth, fontSize);
          try {
            await PluginNoteAPI.insertText({
              textContentFull: titleText,
              textRect: { left: rowLeftMargin, top: itemY, right: L.titleRight, bottom: itemY + Math.round(fontSize * 1.3) },
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
          const safeDestPage = Math.min(totalPagesNow - 1, Math.max(0, h.page - 1));
          try {
            await PluginNoteAPI.insertTextLink({
              destPath: notePath, destPage: safeDestPage, style: 0, linkType: 0,
              rect: { left: L.linkLeft, top: itemY, right: L.rightMargin, bottom: itemY + Math.round(linkFontSize * 1.2) },
              fontSize: linkFontSize, fullText: '↗', showText: '↗', isItalic: 0,
            });
          } catch (e) { console.warn(`insertTextLink row ${idx} error:`, e); }
        }

        written += chunk.length;

        // Footer only on the last page written, and only if headings were left out.
        const isLastWritten = (c === pagesToWrite - 1) || (written >= headings.length);
        if (isLastWritten && written < headings.length) {
          const footerFontSize = Math.max(18, fontSize - 12);
          try {
            await PluginNoteAPI.insertText({
              textContentFull: `Showing first ${written} of ${headings.length} headings`,
              textRect: { left: L.leftMargin, top: L.footerY, right: L.rightMargin, bottom: L.footerY + Math.round(footerFontSize * 1.3) },
              fontSize: footerFontSize, textAlign: 0, textBold: 0, textItalics: 1,
              textFrameWidthType: 0, textFrameStyle: 0, textEditable: 1,
            });
          } catch (e) { console.warn('insertText footer error:', e); }
        }

        // Save AND reload before touching the next page. Without the reload the note app
        // keeps serving a stale page layout: measured on device, getElements(pageIndex)
        // returned the element count of the page we had just written rather than the
        // (empty) next page, so the page-empty guard tripped and the continuation chunk
        // was silently dropped. The same stale-layout trap produced a blank ToC page
        // during the original ToC work.
        try {
          await PluginNoteAPI.saveCurrentNote();
          await PluginCommAPI.reloadFile();
        } catch (e) { /* saved again below */ }

        if (written >= headings.length) break;
      }

      try {
        await PluginNoteAPI.saveCurrentNote();
        await PluginCommAPI.reloadFile();
      } catch (e) { console.warn('save/reload error:', e); }

      const pagesWritten = Math.max(1, Math.ceil(written / rowsPerPage));
      const where = pagesWritten > 1
        ? `pages ${target + 1}-${target + pagesWritten}`
        : `page ${target + 1}`;
      // When pagination is descoped, adding a page does NOT get the user the rest — the
      // cap is deliberate — so the old "add a page, then Refresh" advice would be a lie.
      const message = written < headings.length
        ? (tocPaginationEnabled
          ? `Table of Contents on ${where} — showing first ${written} of ${headings.length} headings. Add a page after it, then Refresh for the rest.`
          : `Table of Contents on ${where} — showing first ${written} of ${headings.length} headings. One page is the limit in this release.`)
        : `Table of Contents created on ${where}.`;

      // Baseline for the next build's heading-loss check. Records what the SCAN found, not
      // what fitted on the page: a one-page cap is a display limit, not a lost heading.
      try { await StorageService.setTocLastBuild(notePath, headings.length); } catch (e) {}

      return { success: true, message, headings };
    } catch (e: any) {
      console.error('Failed to generate ToC page:', e);
      return { success: false, message: e?.message || 'Failed to generate ToC page' };
    }
  }
}
