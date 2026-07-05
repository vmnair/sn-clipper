// SnClipper/src/app.tsx
// Vinod Nair

import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  ToastAndroid,
  Pressable,
  Image,
  AppState,
} from 'react-native';
import { ClipService } from './services/ClipService';
import { ClipItem, StorageService, DEFAULT_INSERT_FONT_SIZE } from './services/StorageService';
import { PluginManager } from 'sn-plugin-lib';
import { HighContrastButton } from './components/HighContrastButton';
import { CropOverlay } from './components/CropOverlay';
import { PromptDialog } from './components/PromptDialog';
import { SearchBar } from './components/SearchBar';
import { FilterPopover } from './components/FilterPopover';
import { SettingsPopover } from './components/SettingsPopover';
import { ClipList } from './components/ClipList';
import { deriveArticleName, isDocFile } from './utils/paths';
import { splitTextToFit } from './utils/text';
// Bundled at build time; versionCode is auto-incremented by buildPlugin.sh before bundling.
const pluginConfig = require('../PluginConfig.json');
const BUILD_LABEL = `v${pluginConfig.versionName} (build ${pluginConfig.versionCode})`;

// Best-effort cleanup of transient capture PNGs orphaned by a crash. Full-screen reader
// shots (reader_shot_*) and temp page renders (temp_crop_page_*) are consumed within
// seconds; saved clip images (clip_*) are kept only while a clip references them. Runs once
// on launch and only touches files older than CAPTURE_STALE_MS, so it can never race an
// in-flight capture or a just-saved clip.
const CAPTURE_STALE_MS = 5 * 60 * 1000;
async function sweepOrphanCaptures(): Promise<void> {
  try {
    const { FileUtils } = require('sn-plugin-lib');
    const dir = await PluginManager.getPluginDirPath();
    if (!dir || !FileUtils || typeof FileUtils.listFiles !== 'function') return;
    const entries = await FileUtils.listFiles(dir);
    if (!Array.isArray(entries)) return;

    const referenced = new Set<string>();
    for (const clip of ClipService.getClipsSync()) {
      for (const el of clip.elements) {
        if (el.type === 'image' && el.imagePath) {
          referenced.add(el.imagePath.substring(el.imagePath.lastIndexOf('/') + 1));
        }
      }
    }

    const now = Date.now();
    for (const entry of entries) {
      const name = entry.substring(entry.lastIndexOf('/') + 1);
      const isReaderShot = name.startsWith('reader_shot_');
      const isTempCrop = name.startsWith('temp_crop_page_');
      const isClip = name.startsWith('clip_');
      if (!isReaderShot && !isTempCrop && !isClip) continue;

      const tsMatch = name.match(/(\d{10,})/); // embedded Date.now() (13 digits)
      const ts = tsMatch ? parseInt(tsMatch[1], 10) : 0;
      const isStale = !ts || now - ts > CAPTURE_STALE_MS;

      if (isClip) {
        if (referenced.has(name) || !isStale) continue; // keep referenced or fresh clips
      } else if (!isStale) {
        continue; // keep a possibly-pending fresh capture
      }

      const full = entry.startsWith('/') ? entry : `${dir}/${name}`;
      try { await FileUtils.deleteFile(full); } catch (e) { /* best-effort */ }
    }
  } catch (e) { /* best-effort */ }
}

// True when a clip contains an image element (a figure). Figures lay out and select
// differently from text (their own page; not copyable or mergeable).
const clipHasImage = (clip: ClipItem): boolean => !!clip.elements?.some((e) => e.type === 'image');

export default function App() {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isNoteFile, setIsNoteFile] = useState(false);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentPageNum, setCurrentPageNum] = useState<number>(0);

  // Cropping States
  const [isCropping, setIsCropping] = useState(false);
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [cropLoading, setCropLoading] = useState(false);
  const [cropPagePath, setCropPagePath] = useState<string | null>(null);
  const [cropImageSize, setCropImageSize] = useState({ width: 1404, height: 1872 });

  // Search, Filter & Sort States
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [activeSourceFilter, setActiveSourceFilter] = useState<string | null>(null); // null = All Sources
  const [activeSortMode, setActiveSortMode] = useState<'oldest' | 'newest'>('newest');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [promptText, setPromptText] = useState('');

  // Settings (persisted). Auto-remove: delete clips from Clipper once they have
  // been successfully inserted into a note. Defaults on.
  const [autoRemoveInserted, setAutoRemoveInserted] = useState(true);
  // Font size (px) for text inserted into notes. Defaults to Medium (44).
  const [insertFontSize, setInsertFontSize] = useState<number>(DEFAULT_INSERT_FONT_SIZE);
  // Combine inserted text clips into a single text box (default on).
  const [combineInserted, setCombineInserted] = useState(true);

  // A plugin button press (e.g. the reader's selection-popup "Clip" entry) fires
  // while the reader page is still on screen, so we screenshot it right then. The
  // crop flow prefers this crisp, WYSIWYG capture over generateDocImage — which is
  // essential for reflowable EPUB, whose re-rendered pagination never matches the
  // reader. Holds { promise, ts }; consumed once by handleStartCropping.
  const pendingReaderShot = useRef<{ promise: Promise<any>; ts: number; path: string } | null>(null);
  // Cached plugin dir so the button-press listener can build the shot path without
  // an async round-trip that would delay the capture.
  const pluginDirRef = useRef<string | null>(null);

  useEffect(() => {
    // Sync current list from Storage on open
    ClipService.init().then(() => {
      setClips(ClipService.getClipsSync());
      // One-time cleanup of capture PNGs orphaned by a prior crash.
      sweepOrphanCaptures();
    });

    // Load persisted settings
    StorageService.getAutoRemoveInserted().then(setAutoRemoveInserted);
    StorageService.getInsertFontSize().then(setInsertFontSize);
    StorageService.getCombineInserted().then(setCombineInserted);

    // Check active file context (Note vs Document)
    const runContextCheck = async () => {
      try {
        const { PluginCommAPI, PluginDocAPI } = require('sn-plugin-lib');
        
        const launchMode = await ClipService.getLaunchMode();
        if (launchMode === 'autoclipped') {
          await ClipService.setLaunchMode('normal');
          const { BackHandler } = require('react-native');
          BackHandler.exitApp();
          return;
        }

        if (launchMode === 'prompt') {
          await ClipService.setLaunchMode('normal');
          setIsCropping(false);
          const text = await ClipService.getPromptText();
          if (text && text.trim().length > 0) {
            setPromptText(text);
            setShowPromptDialog(true);
          } else {
            const { BackHandler } = require('react-native');
            BackHandler.exitApp();
          }
          
          // Still load active file path so we can crop if user chooses Image
          const fileRes = await PluginCommAPI.getCurrentFilePath();
          if (fileRes.success && fileRes.result) {
            const filePath = fileRes.result;
            setCurrentFilePath(filePath);
            setIsNoteFile(!isDocFile(filePath));

            let pageNum = 0;
            const pageRes = await PluginCommAPI.getCurrentPageNum();
            if (pageRes.success && pageRes.result !== undefined && pageRes.result !== null) {
              pageNum = pageRes.result;
              setCurrentPageNum(pageNum);
            }
          }
          return;
        }

        // The 'prompt' (and 'autoclipped') modes have already returned above, so here
        // launchMode is 'normal' or 'crop': always clear any stale prompt dialog state.
        setShowPromptDialog(false);
        setPromptText('');

        if (launchMode !== 'crop') {
          setIsCropping(false);
        }

        const fileRes = await PluginCommAPI.getCurrentFilePath();
        if (fileRes.success && fileRes.result) {
          const filePath = fileRes.result;
          setCurrentFilePath(filePath);
          setIsNoteFile(!isDocFile(filePath));

          let pageNum = 0;
          const pageRes = await PluginCommAPI.getCurrentPageNum();
          if (pageRes.success && pageRes.result !== undefined && pageRes.result !== null) {
            pageNum = pageRes.result;
            setCurrentPageNum(pageNum);
          }

          if (launchMode === 'crop') {
            await ClipService.setLaunchMode('normal');
            setIsCropping(true);
            const textRes = await PluginDocAPI.getLastSelectedText() as any;
            if (textRes && textRes.success && textRes.result && textRes.result.trim().length > 0) {
              setSelectionText(textRes.result);
            } else {
              await handleStartCropping(filePath, pageNum);
            }
          }
        } else {
          setIsNoteFile(true); // Default to note file context
        }
      } catch (e) {
        console.error('Failed to query file path context:', e);
        setIsNoteFile(true);
      }
    };

    // Coalesce overlapping context checks. Launch mode is a single shared value that is
    // consumed read-then-reset (e.g. 'prompt' -> 'normal'); mount, AppState 'active', and
    // the synchronous onLaunchModeChange emit can all fire near-simultaneously and race that
    // read/reset (dropping a prompt or crop). This guard runs one check at a time and, if a
    // trigger arrives mid-run, re-runs exactly once afterwards so no mode change is lost.
    let contextCheckBusy = false;
    let contextCheckPending = false;
    const checkContext = async () => {
      if (contextCheckBusy) { contextCheckPending = true; return; }
      contextCheckBusy = true;
      try {
        do {
          contextCheckPending = false;
          await runContextCheck();
        } while (contextCheckPending);
      } finally {
        contextCheckBusy = false;
      }
    };
    checkContext();

    const handleAppStateChange = (nextAppState: any) => {
      if (nextAppState === 'active') {
        checkContext();
      }
    };
    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    // Reactively refresh UI when background actions add elements
    const unsubscribe = ClipService.subscribe(() => {
      setClips([...ClipService.getClipsSync()]);
    });

    const { NativeModules, DeviceEventEmitter } = require('react-native');
    const { ImageCropModule } = NativeModules;
    if (ImageCropModule && typeof ImageCropModule.registerAsForeground === 'function') {
      ImageCropModule.registerAsForeground().catch((err: any) => console.error(err));
    }

    // Cache the plugin dir up front so the button-press listener can screenshot
    // without an async round-trip (which would let the reader be covered first).
    PluginManager.getPluginDirPath().then((dir: string | null | undefined) => { if (dir) pluginDirRef.current = dir; }).catch(() => {});

    let subscription: any = null;
    if (DeviceEventEmitter && typeof DeviceEventEmitter.addListener === 'function') {
      subscription = DeviceEventEmitter.addListener('onLaunchModeChange', (mode: string) => {
        if (mode === 'prompt') {
          checkContext();
        }
      });
    }

    // When any plugin button is pressed the reader page is still on screen, so grab
    // a screenshot of it immediately. The crop flow (handleStartCropping) consumes
    // this for a crisp, WYSIWYG capture instead of re-rendering via generateDocImage
    // (which mis-paginates reflowable EPUB). Store the promise so the crop can await
    // the capture rather than race it.
    let btnSub: any = null;
    try {
      btnSub = PluginManager.registerButtonListener({
        onButtonPress: (e: any) => {
          // Only the reader selection "Clip" entry (id 300) fires while the reader page is
          // still visible — that's the one worth screenshotting. The SDK dispatches every
          // button event to every listener (and replays the last event to newly-registered
          // listeners for ~1s), so without this guard opening Clipper (id 100) would capture
          // the plugin UI and leave orphaned PNGs. index.js owns the id-300 clip logic.
          if (!e || e.id !== 300) return;
          const dir = pluginDirRef.current;
          if (dir && ImageCropModule && typeof ImageCropModule.captureScreen === 'function') {
            // Delete the previous unconsumed capture so presses that don't lead to a
            // crop don't accumulate orphaned full-screen PNGs.
            const prev = pendingReaderShot.current;
            if (prev && prev.path) {
              try { require('sn-plugin-lib').FileUtils.deleteFile(prev.path).catch(() => {}); } catch (e) {}
            }
            // Unique filename per capture: RN/Fresco caches images by URI, so a fixed
            // path would keep showing the previously cached page after switching docs.
            const path = `${dir}/reader_shot_${Date.now()}.png`;
            pendingReaderShot.current = { promise: ImageCropModule.captureScreen(path), ts: Date.now(), path };
          }
        },
      } as any);
    } catch (e) { console.error('registerButtonListener failed', e); }

    return () => {
      unsubscribe();
      appStateSub.remove();
      if (subscription) {
        subscription.remove();
      }
      if (btnSub && typeof btnSub.remove === 'function') {
        btnSub.remove();
      }
    };
  }, []);

  // Harvest unique document filenames from clips list
  const uniqueSources = useMemo(() => {
    const sources = clips.map((c) => c.articleName).filter(Boolean);
    return Array.from(new Set(sources));
  }, [clips]);

  // Memoized Filter & Sort Selector
  const processedClips = useMemo(() => {
    let list = [...clips];

    // 1. Filter by Search Query
    if (isSearchVisible && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.text.toLowerCase().includes(query) ||
          c.articleName.toLowerCase().includes(query)
      );
    }

    // 2. Filter by Source
    if (activeSourceFilter) {
      list = list.filter((c) => c.articleName === activeSourceFilter);
    }

    // 3. Sort Order
    if (activeSortMode === 'newest') {
      list.sort((a, b) => b.timestamp - a.timestamp);
    } else if (activeSortMode === 'oldest') {
      list.sort((a, b) => a.timestamp - b.timestamp);
    }

    return list;
  }, [clips, searchQuery, isSearchVisible, activeSourceFilter, activeSortMode]);

  const handleCardPress = (id: string) => {
    if (!isSelectionMode) return;
    toggleSelect(id);
  };

  const handleCardLongPress = (id: string) => {
    if (isSelectionMode) return;
    setIsSelectionMode(true);
    setSelectedIds([id]);
  };

  const toggleSelect = (id: string) => {
    let updated = [...selectedIds];
    if (updated.includes(id)) {
      updated = updated.filter((item) => item !== id);
    } else {
      // A figure can only be selected on its own (it inserts alone on its own page, and can't
      // be copied or merged), so figures and text never mix in a selection.
      const addingClip = clips.find((c) => c.id === id);
      const addingImage = addingClip ? clipHasImage(addingClip) : false;
      const selectionHasImageNow = clips.some((c) => selectedIds.includes(c.id) && clipHasImage(c));
      if (addingImage && selectedIds.length > 0) {
        ToastAndroid.show('A figure can only be selected on its own.', ToastAndroid.SHORT);
        return;
      }
      if (!addingImage && selectionHasImageNow) {
        ToastAndroid.show('Deselect the figure to select text.', ToastAndroid.SHORT);
        return;
      }
      updated.push(id);
    }

    setSelectedIds(updated);
    if (updated.length === 0) {
      setIsSelectionMode(false);
    }
  };

  const handleCopyAllVisible = () => {
    const text = ClipService.getAggregateTextSync(processedClips);
    if (text) {
      const { Clipboard } = require('react-native');
      Clipboard.setString(text);
      ToastAndroid.show('Visible clips copied!', ToastAndroid.SHORT);
    } else {
      ToastAndroid.show('No clips to copy!', ToastAndroid.SHORT);
    }
  };

  const handleCopySelected = () => {
    const selectedClips = clips.filter((c) => selectedIds.includes(c.id));
    const text = ClipService.getAggregateTextSync(selectedClips);
    
    if (text) {
      const { Clipboard } = require('react-native');
      Clipboard.setString(text);
      ToastAndroid.show(`${selectedIds.length} clip(s) copied!`, ToastAndroid.SHORT);
      handleCancel();
    }
  };

  const handleDeleteSelected = async () => {
    await ClipService.deleteClips(selectedIds);
    ToastAndroid.show(`${selectedIds.length} clip(s) deleted!`, ToastAndroid.SHORT);
    handleCancel();
  };

  // A selection is mergeable only when it's 2+ clips that are ALL text (no images) — a page
  // can't lay out an image alongside text, so text+image clips are disallowed.
  const selectionHasImage = useMemo(
    () => clips.some((c) => selectedIds.includes(c.id) && clipHasImage(c)),
    [clips, selectedIds]
  );
  const canMerge = selectedIds.length >= 2 && !selectionHasImage;

  const handleMergeSelected = async () => {
    if (selectedIds.length < 2) {
      ToastAndroid.show('Select at least 2 clips to merge!', ToastAndroid.SHORT);
      return;
    }
    if (selectionHasImage) {
      ToastAndroid.show('Only text clips can be merged.', ToastAndroid.SHORT);
      return;
    }
    try {
      await ClipService.mergeClips(selectedIds);
      ToastAndroid.show(`${selectedIds.length} clip(s) merged!`, ToastAndroid.SHORT);
      handleCancel();
    } catch (e: any) {
      ToastAndroid.show(`Merge failed: ${e.message}`, ToastAndroid.SHORT);
    }
  };

  // Number of selected clips that are actually merged (have >1 element) and can be unmerged.
  const unmergeableCount = useMemo(
    () => clips.filter((c) => selectedIds.includes(c.id) && c.elements && c.elements.length > 1).length,
    [clips, selectedIds]
  );

  const handleUnmergeSelected = async () => {
    const targets = clips.filter((c) => selectedIds.includes(c.id) && c.elements && c.elements.length > 1);
    if (targets.length === 0) {
      ToastAndroid.show('Select a merged clip to unmerge.', ToastAndroid.SHORT);
      return;
    }
    let pieces = 0;
    for (const c of targets) {
      pieces += await ClipService.unmergeClip(c.id);
    }
    ToastAndroid.show(`Unmerged into ${pieces} clip(s).`, ToastAndroid.SHORT);
    handleCancel();
  };

  const handleClearAll = async () => {
    await ClipService.clearClips();
    ToastAndroid.show('Clipboard cleared!', ToastAndroid.SHORT);
    handleCancel();
  };

  const handleCancel = () => {
    setSelectedIds([]);
    setIsSelectionMode(false);
  };

  const handleClose = () => {
    PluginManager.closePluginView();
  };

  const toggleSearch = () => {
    if (isSearchVisible) {
      setSearchQuery('');
    }
    setIsSearchVisible(!isSearchVisible);
  };

  // -------------------------------------------------------------
  // Custom Page Cropping Logic & Coordinates Scaling
  // -------------------------------------------------------------

  const handleStartCropping = async (targetPath?: string, targetPage?: number) => {
    const file = targetPath || currentFilePath;
    const pg = targetPage !== undefined ? targetPage : currentPageNum;
    if (!file) {
      ToastAndroid.show('No active document to crop.', ToastAndroid.SHORT);
      return;
    }
    setIsCropping(true);
    setCropLoading(true);

    // Prefer a fresh reader screenshot taken when the user pressed the selection
    // "Clip" button — it's the exact, crisp page (correct font, WYSIWYG) and works
    // for reflowable EPUB where generateDocImage mis-paginates. Falls through to the
    // re-render path only if no recent capture is available or it fails.
    const shot = pendingReaderShot.current;
    pendingReaderShot.current = null;
    if (shot) {
      if (Date.now() - shot.ts < 30000) {
        try {
          const cap = await shot.promise;
          if (cap && cap.path && cap.width && cap.height) {
            setCropPagePath(cap.path);
            setCropImageSize({ width: cap.width, height: cap.height });
            setCropLoading(false);
            return;
          }
        } catch (e) { /* fall through to generateDocImage */ }
      }
      // Shot was stale or unusable — delete the abandoned capture so it doesn't linger.
      try { const { FileUtils } = require('sn-plugin-lib'); FileUtils.deleteFile(shot.path).catch(() => {}); } catch (e) {}
    }

    // Drop any capture left over from a previous aborted session before making a new one.
    if (cropPagePath) {
      const { FileUtils } = require('sn-plugin-lib');
      FileUtils.deleteFile(cropPagePath).catch(() => {});
    }

    try {
      const { PluginFileAPI, PluginDocAPI } = require('sn-plugin-lib');
      const pluginDir = await PluginManager.getPluginDirPath();
      if (!pluginDir) {
        ToastAndroid.show('Storage error: Cannot access plugin folder.', ToastAndroid.SHORT);
        setIsCropping(false);
        setCropLoading(false);
        return;
      }

      const tempPath = `${pluginDir}/temp_crop_page_${Date.now()}.png`;
      const isNote = file.endsWith('.note') || file.endsWith('.not') || !file.includes('.');

      // Fetch the page size once and reuse it for both the capture and the crop scaling.
      let pageSize = { width: 1404, height: 1872 };
      const sizeRes = await PluginFileAPI.getPageSize(file, pg);
      if (sizeRes.success && sizeRes.result) {
        pageSize = sizeRes.result;
      }

      let success = false;
      if (isNote) {
        const genRes = await PluginFileAPI.generateNotePng({
          notePath: file,
          page: pg,
          times: 1,
          pngPath: tempPath,
          type: 1
        });
        success = genRes && genRes.success;
      } else {
        const genRes = await PluginDocAPI.generateDocImage(
          file,
          pg,
          tempPath,
          pageSize
        );
        success = genRes && genRes.success;
      }

      if (success) {
        setCropPagePath(tempPath);
        setCropImageSize(pageSize);
        setCropLoading(false);
      } else {
        ToastAndroid.show('Capture failed: Failed to screenshot page.', ToastAndroid.SHORT);
        setIsCropping(false);
        setCropLoading(false);
      }
    } catch (err: any) {
      ToastAndroid.show(`Capture error: ${err.message}`, ToastAndroid.SHORT);
      setIsCropping(false);
      setCropLoading(false);
    }
  };

  // Receives the selection in image-space pixels from CropOverlay, performs the
  // native crop, stores the resulting image clip, and returns to the document.
  const runCropSave = async (rect: { x: number; y: number; width: number; height: number }) => {
    if (!cropPagePath) return;
    try {
      const { NativeModules, ToastAndroid } = require('react-native');
      const { ImageCropModule } = NativeModules;
      if (!ImageCropModule) {
        ToastAndroid.show('Crop failed: ImageCropModule is not registered.', ToastAndroid.SHORT);
        return;
      }

      const pluginDir = await PluginManager.getPluginDirPath();
      const destPath = `${pluginDir}/clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.png`;

      const success = await ImageCropModule.cropImage(
        cropPagePath,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        destPath
      );

      if (success) {
        // Clean up the temporary full-page capture only once the crop has succeeded,
        // so a failed crop leaves the source intact and the user can retry.
        const { FileUtils } = require('sn-plugin-lib');
        try {
          await FileUtils.deleteFile(cropPagePath);
        } catch (err) {
          console.error('Failed to delete temp crop page:', err);
        }

        const articleName = deriveArticleName(currentFilePath);
        const count = await ClipService.addImageClip(destPath, articleName, rect.width, rect.height);
        ToastAndroid.show(`Region cropped! (${count} clips aggregated)`, ToastAndroid.SHORT);
        setIsCropping(false);
        // Automatically close plugin view to return back to the document
        PluginManager.closePluginView();
      } else {
        ToastAndroid.show('Crop failed. Please try again.', ToastAndroid.SHORT);
      }
    } catch (err: any) {
      ToastAndroid.show(`Crop failed: ${err.message}`, ToastAndroid.SHORT);
    }
  };

  const handleCancelCropping = () => {
    setIsCropping(false);
    // Don't leave the full-page capture (potentially sensitive document content) on disk
    // when the user abandons the crop.
    if (cropPagePath) {
      const { FileUtils } = require('sn-plugin-lib');
      FileUtils.deleteFile(cropPagePath).catch((err: any) =>
        console.error('Failed to delete temp crop page on cancel:', err)
      );
      setCropPagePath(null);
    }
    PluginManager.closePluginView();
  };

  const handleClipSelectionAsText = async () => {
    if (!selectionText) return;
    try {
      const articleName = deriveArticleName(currentFilePath);
      const count = await ClipService.addClip(selectionText, articleName);
      ToastAndroid.show(`Clipped text! (${count} clips aggregated)`, ToastAndroid.SHORT);
      setSelectionText(null);
      setIsCropping(false);
      const { PluginManager } = require('sn-plugin-lib');
      PluginManager.closePluginView();
    } catch (err: any) {
      ToastAndroid.show(`Clipping failed: ${err.message}`, ToastAndroid.SHORT);
    }
  };

  const handleClipSelectionAsImage = async () => {
    setSelectionText(null);
    if (currentFilePath) {
      await handleStartCropping(currentFilePath, currentPageNum);
    }
  };

  const handleCancelSelectionModal = () => {
    setSelectionText(null);
    setIsCropping(false);
    const { PluginManager } = require('sn-plugin-lib');
    PluginManager.closePluginView();
  };

  const handleInsertVisible = async () => {
    await runInsertClips(processedClips);
  };

  const handleInsertSelected = async () => {
    const selectedClips = clips.filter((c) => selectedIds.includes(c.id));
    selectedClips.sort((a, b) => a.timestamp - b.timestamp);
    await runInsertClips(selectedClips);
    handleCancel();
  };

  const runInsertClips = async (clipsToInsert: ClipItem[]) => {
    if (clipsToInsert.length === 0) return;
    try {
      const { PluginCommAPI, PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');
      
      const fileRes = await PluginCommAPI.getCurrentFilePath();
      if (!fileRes.success || !fileRes.result) {
        ToastAndroid.show('Insert failed: No active file.', ToastAndroid.SHORT);
        return;
      }
      const notePath = fileRes.result;
      const pageRes = await PluginCommAPI.getCurrentPageNum();
      const page = (pageRes.success && pageRes.result !== undefined && pageRes.result !== null) ? pageRes.result : 0;

      await PluginNoteAPI.saveCurrentNote();

      let pageWidth = 1404;
      let pageHeight = 1872;
      const sizeRes = await PluginFileAPI.getPageSize(notePath, page);
      if (sizeRes.success && sizeRes.result) {
        pageWidth = sizeRes.result.width;
        pageHeight = sizeRes.result.height;
      }

      // 1. Get existing page elements to calculate starting Y coordinate (Append feature),
      // and snapshot their ids so we can identify newly-inserted images afterwards
      // (insertImage returns { result: true } with no uuid, so we diff before/after).
      let currentY = 100;
      // Layout metrics derived from the chosen insert font size. lineHeight/charsPerLine
      // ESTIMATE how much text fits (fit/split decisions and where the next box starts).
      // Uniform inter-clip spacing comes from combining text into ONE box separated by a
      // blank line (see the combine branch) rather than from precise height estimates; `gap`
      // is the blank space between separately-inserted boxes (~0.6 line).
      const fontSize = insertFontSize;
      const lineHeight = Math.round(fontSize * 1.35);
      const gap = Math.round(lineHeight * 0.6);
      const beforeIds = new Set<string>();
      // Count images already on this page (from a previous insert) so the one-figure-per-page
      // cap accounts for them — otherwise a second figure would overlap the existing one.
      let existingImageCount = 0;

      const elementsRes = await PluginFileAPI.getElements(page, notePath) as any;
      if (elementsRes && elementsRes.success && Array.isArray(elementsRes.result)) {
        for (const el of elementsRes.result) {
          if (el.uuid) beforeIds.add(el.uuid);
          if (el.status !== undefined && el.status !== 0) {
            continue;
          }
          let elBottom = 0;
          if (el.type === 500 || el.type === 501 || el.type === 502) { // Text Box types
            if (el.textBox && el.textBox.textRect) {
              elBottom = el.textBox.textRect.bottom;
            }
          } else if (el.type === 200) { // Picture/Image type
            existingImageCount++;
            if (el.picture && el.picture.rect) {
              elBottom = el.picture.rect.bottom;
            }
          }
          if (elBottom <= 0 && el.maxY) {
            elBottom = el.maxY;
          }
          if (elBottom > currentY) {
            currentY = elBottom;
          }
        }

      }
      // Start slightly below the bottom-most element
      if (currentY > 100) {
        currentY += gap;
      }

      // Flatten clips into an ordered list of element "items", tagging each with its clip id
      // so we can tell which clips were fully inserted (safe to remove) vs. deferred.
      const items: { clipId: string; type: 'text' | 'image'; text?: string; imagePath?: string }[] = [];
      const elemCountByClip: Record<string, number> = {};
      for (const clip of clipsToInsert) {
        for (const el of clip.elements) {
          items.push({ clipId: clip.id, type: el.type, text: el.text, imagePath: el.imagePath });
          elemCountByClip[clip.id] = (elemCountByClip[clip.id] || 0) + 1;
        }
      }

      const maxWidth = pageWidth - 200;
      // Approx characters per line for the chosen font (proportional font ~0.55·fontSize wide).
      const charsPerLine = Math.max(1, Math.floor(maxWidth / (fontSize * 0.55)));
      const estimateTextHeight = (t: string) => Math.max(1, Math.ceil((t || '').length / charsPerLine)) * lineHeight;
      const insertTextBox = async (content: string, top: number, height: number) => {
        await PluginNoteAPI.insertText({
          textContentFull: content,
          textRect: { left: 100, top, right: 100 + maxWidth, bottom: top + height },
          fontSize,
          textAlign: 0,
          textBold: 0,
          textItalics: 0,
          textFrameWidthType: 0,
          textFrameStyle: 0,
          textEditable: 1,
        });
      };

      const insertedCountByClip: Record<string, number> = {};
      const splitRemainder: Record<string, string> = {}; // clipId -> un-inserted tail of a split clip
      const MIN_SPLIT_LINES = 3;
      let imagesInserted = existingImageCount;
      let outOfSpace = false;    // text didn't fit; more on the next page
      let imageLimitHit = false; // a figure was deferred (needs its own empty page)
      let splitOccurred = false; // a single clip was split across pages
      let attemptedInserts = 0;
      // A figure is always alone on its page (the SDK centers images and can't reposition
      // them, so text would overlap). Once a page has any content, a figure is deferred.
      let pageHasContent = currentY > 100 || existingImageCount > 0;

      let i = 0;
      while (i < items.length) {
        const item = items[i];

        if (item.type === 'image') {
          if (pageHasContent || imagesInserted >= 1) { imageLimitHit = true; break; }
          if (item.imagePath) {
            await PluginNoteAPI.insertImage(item.imagePath);
            await PluginNoteAPI.saveCurrentNote();
            imagesInserted++;
            attemptedInserts++;
            insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;
            pageHasContent = true;
            await new Promise(r => setTimeout(r, 300));
            i++;
          } else {
            i++;
          }
          // The figure owns the page; whatever remains continues on the next page.
          if (i < items.length) {
            if (items[i].type === 'image') imageLimitHit = true;
            else outOfSpace = true;
          }
          break;
        }

        // Empty/whitespace-only text elements carry no content — count them as "inserted"
        // (so their clip can still be removed) but don't create a blank text box for them.
        if (!item.text || !item.text.trim()) { insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1; i++; continue; }

        const availHeight = (pageHeight - gap) - currentY;

        if (combineInserted) {
          // Combine consecutive whole text items that fit into a single text box, separated
          // by one blank line. Spacing is then a literal blank line — uniform, not dependent
          // on the (fixed-height-box) height estimate.
          const group: typeof items = [];
          let groupHeight = 0;
          let j = i;
          while (j < items.length && items[j].type === 'text' && items[j].text) {
            const h = estimateTextHeight(items[j].text as string);
            const addH = h + (group.length ? lineHeight : 0); // blank line between clips
            if (group.length === 0) {
              if (h > availHeight) break; // first item alone doesn't fit → split/defer below
            } else if (groupHeight + addH > availHeight) {
              break;
            }
            group.push(items[j]);
            groupHeight += addH;
            j++;
          }
          if (group.length > 0) {
            const combined = group.map((g) => g.text).join('\n\n');
            await insertTextBox(combined, currentY, groupHeight);
            attemptedInserts++;
            group.forEach((g) => { insertedCountByClip[g.clipId] = (insertedCountByClip[g.clipId] || 0) + 1; });
            currentY += groupHeight + gap;
            pageHasContent = true;
            i = j;
            await new Promise(r => setTimeout(r, 300));
            // One combined box per page: whatever remains continues on the next page.
            if (i < items.length) {
              if (items[i].type === 'image') imageLimitHit = true; // figure needs its own page
              else outOfSpace = true;
            }
            break;
          }
          // group empty → the single item is taller than the remaining space; fall through.
        }

        // Single text item: fits whole, or split across pages, or defer to a fresh page.
        const t = item.text;
        const estH = estimateTextHeight(t);
        if (estH <= availHeight) {
          await insertTextBox(t, currentY, estH);
          attemptedInserts++;
          insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;
          currentY += estH + gap;
          pageHasContent = true;
          i++;
          await new Promise(r => setTimeout(r, 300));
          if (combineInserted) break; // combine handles multi-item via the group; be safe
          continue; // separate mode: keep stacking boxes on this page
        } else {
          const linesThatFit = Math.floor(availHeight / lineHeight);
          if (linesThatFit < MIN_SPLIT_LINES) { outOfSpace = true; break; } // start fresh next page
          const charBudget = linesThatFit * charsPerLine;
          const [chunk, remainder] = splitTextToFit(t, charBudget);
          if (!chunk) { outOfSpace = true; break; }
          await insertTextBox(chunk, currentY, linesThatFit * lineHeight);
          attemptedInserts++;
          if (remainder) { splitRemainder[item.clipId] = remainder; splitOccurred = true; }
          await PluginNoteAPI.saveCurrentNote();
          await new Promise(r => setTimeout(r, 300));
          break; // page full
        }
      }

      // Persist any remaining (text) inserts. Images were saved individually above.
      await PluginNoteAPI.saveCurrentNote();

      // Verify how many new elements actually persisted, so we NEVER remove clip content
      // that didn't land in the note (image inserts can silently drop).
      let persistedNew = 0;
      try {
        const verify = await PluginFileAPI.getElements(page, notePath) as any;
        if (verify && verify.success && Array.isArray(verify.result)) {
          persistedNew = verify.result.filter((el: any) => el.uuid && !beforeIds.has(el.uuid)).length;
        }
      } catch (e) { /* best-effort */ }

      const allPersisted = attemptedInserts > 0 && persistedNew >= attemptedInserts;
      if (allPersisted && autoRemoveInserted) {
        // Now it's safe to remove inserted content from Clipper. Per clip:
        //  - split: drop the fully-inserted leading elements and keep only the un-inserted
        //    tail of the split text element (so re-inserting continues, not duplicates);
        //  - fully inserted: delete;
        //  - partially inserted (later elements deferred): trim the inserted leading prefix.
        const fullyInsertedIds: string[] = [];
        for (const c of clipsToInsert) {
          const inserted = insertedCountByClip[c.id] || 0;
          const total = elemCountByClip[c.id] || 0;
          const remainder = splitRemainder[c.id];
          if (remainder) {
            await ClipService.trimInsertedElements(c.id, inserted, remainder);
          } else if (total > 0 && inserted === total) {
            fullyInsertedIds.push(c.id);
          } else if (inserted > 0) {
            await ClipService.trimInsertedElements(c.id, inserted);
          }
        }
        if (fullyInsertedIds.length > 0) await ClipService.deleteClips(fullyInsertedIds);
      }

      if (splitOccurred) {
        ToastAndroid.show(
          'Clip too long for one page — inserted part. Turn to a new page, then Insert again to continue.',
          ToastAndroid.LONG
        );
        // Return to the note so the user can add a page for the remainder.
        PluginManager.closePluginView();
      } else if (outOfSpace) {
        // Covers "text filled the page" and "a figure was placed and more clips remain" —
        // either way the rest continues on a new page, so return to the note to navigate.
        ToastAndroid.show(
          'More clips remain. Turn to a new page, then Insert again to continue.',
          ToastAndroid.LONG
        );
        PluginManager.closePluginView();
      } else if (imageLimitHit) {
        // Checked before the generic persist failure: when the only remaining content is a
        // deferred image, nothing is attempted (attemptedElems === 0 → allPersisted false),
        // which would otherwise mis-report as a persistence failure.
        ToastAndroid.show(
          'Figures go on their own page. Turn to a blank page, then Insert to place the figure.',
          ToastAndroid.LONG
        );
        // Return to the note so the user can add a page for the remaining figure(s).
        PluginManager.closePluginView();
      } else if (!allPersisted) {
        ToastAndroid.show('Some clips could not be inserted; they are kept in Clipper.', ToastAndroid.LONG);
      } else {
        ToastAndroid.show(
          autoRemoveInserted ? 'Clips inserted successfully!' : 'Clips inserted (kept in Clipper)',
          ToastAndroid.SHORT
        );
        // Return to the document to show the newly inserted content.
        PluginManager.closePluginView();
      }
    } catch (e: any) {
      ToastAndroid.show(`Insert failed: ${e.message}`, ToastAndroid.SHORT);
    }
  };

  if (isCropping) {
    return (
      <View style={styles.cropRoot}>
        <CropOverlay
          pagePath={cropPagePath}
          imageSize={cropImageSize}
          loading={cropLoading}
          onCancel={handleCancelCropping}
          onSave={runCropSave}
        />

        {selectionText !== null && (
          <PromptDialog
            description="You selected text. How would you like to clip this selection?"
            imageLabel="Clip as Image"
            textLabel="Clip as Text"
            primaryAction="text"
            onClipImage={handleClipSelectionAsImage}
            onClipText={handleClipSelectionAsText}
            onCancel={handleCancelSelectionModal}
          />
        )}
      </View>
    );
  }

  if (showPromptDialog) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PromptDialog
          text={promptText}
          imageLabel="Clip Region"
          textLabel="Clip Text"
          primaryAction="image"
          onClipImage={async () => {
            setShowPromptDialog(false);
            await ClipService.setPromptText('');
            await handleStartCropping(currentFilePath || undefined, currentPageNum);
          }}
          onClipText={async () => {
            setShowPromptDialog(false);
            await ClipService.setPromptText('');
            await ClipService.addClip(promptText, deriveArticleName(currentFilePath));
            ToastAndroid.show('Clipped as Text!', ToastAndroid.SHORT);
            const { PluginManager } = require('sn-plugin-lib');
            PluginManager.closePluginView();
          }}
          onCancel={async () => {
            setShowPromptDialog(false);
            await ClipService.setPromptText('');
            const { PluginManager } = require('sn-plugin-lib');
            PluginManager.closePluginView();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={styles.headerLeft}>
              <Pressable onPress={handleClose} style={styles.iconButton} testID="header-close-btn">
                <Image source={require('../assets/icon/clear.png')} style={styles.iconImage} />
              </Pressable>
            </View>
            <Text style={styles.title}>Clipper</Text>
            <View style={styles.headerIcons}>
              {/* Region capture is done from the reader: highlight text → the "Clip"
                  entry in the selection popup. That path screenshots the live reader
                  page (crisp, correct for EPUB); an in-Clipper button cannot (the
                  reader isn't on screen) so it was removed. */}
              <Pressable onPress={toggleSearch} style={styles.iconButton} testID="search-btn">
                <Image source={require('../assets/icon/search.png')} style={styles.iconImage} />
              </Pressable>
              <Pressable onPress={() => setIsPopoverOpen(true)} style={styles.iconButton} testID="filter-btn">
                <Image source={require('../assets/icon/filter.png')} style={styles.iconImage} />
              </Pressable>
              <Pressable onPress={() => setIsSettingsOpen(true)} style={styles.iconButton} testID="settings-btn">
                <Image source={require('../assets/icon/settings.png')} style={styles.iconImage} />
              </Pressable>
            </View>
          </View>
          <View style={styles.headerSubtitleRow}>
            <Text style={styles.subtitle}>
              {isSelectionMode 
                ? `${selectedIds.length} of ${processedClips.length} clip(s) selected` 
                : `${processedClips.length} clip(s) visible`}
            </Text>
            {(activeSourceFilter !== null || (isSearchVisible && searchQuery.trim() !== '')) && (
              <View style={styles.headerChips}>
                {isSearchVisible && searchQuery.trim() !== '' && (
                  <Pressable
                    onPress={() => setSearchQuery('')}
                    style={styles.headerChip}
                  >
                    <Text style={styles.headerChipText} numberOfLines={1}>Search: "{searchQuery}"</Text>
                    <Image source={require('../assets/icon/clear.png')} style={styles.headerChipClearImage} />
                  </Pressable>
                )}
                {activeSourceFilter !== null && (
                  <Pressable
                    onPress={() => setActiveSourceFilter(null)}
                    style={styles.headerChip}
                  >
                    <Text style={styles.headerChipText} numberOfLines={1}>Source: {activeSourceFilter}</Text>
                    <Image source={require('../assets/icon/clear.png')} style={styles.headerChipClearImage} />
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Toggleable Search Bar */}
        {isSearchVisible && (
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClear={() => setSearchQuery('')}
          />
        )}

        {/* Scrollable list of clippings */}
        <ClipList
          data={processedClips}
          totalCount={clips.length}
          selectedIds={selectedIds}
          isSelectionMode={isSelectionMode}
          onCardPress={handleCardPress}
          onCardLongPress={handleCardLongPress}
        />

        {/* Footer Actions Area */}
        <View style={styles.footer}>
          {!isSelectionMode ? (
            <View style={styles.btnRow}>
              <HighContrastButton label="Copy Visible" onPress={handleCopyAllVisible} disabled={processedClips.length === 0} />
              {isNoteFile && (
                <HighContrastButton label="Insert into open Note" onPress={handleInsertVisible} disabled={processedClips.length === 0} />
              )}
              <HighContrastButton label="Clear All" onPress={handleClearAll} disabled={clips.length === 0} />
            </View>
          ) : (
            <>
              {isNoteFile ? (
                <>
                  <View style={styles.btnRow}>
                    <HighContrastButton label="Copy Selected" onPress={handleCopySelected} disabled={selectionHasImage} />
                    <HighContrastButton label="Insert into open Note" onPress={handleInsertSelected} />
                    <HighContrastButton label="Merge Selected" onPress={handleMergeSelected} disabled={!canMerge} />
                  </View>
                  <View style={styles.btnRow}>
                    <HighContrastButton label="Delete Selected" onPress={handleDeleteSelected} />
                    <HighContrastButton label="Unmerge" onPress={handleUnmergeSelected} disabled={unmergeableCount === 0} />
                    <HighContrastButton label="Cancel" onPress={handleCancel} />
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.btnRow}>
                    <HighContrastButton label="Copy Selected" onPress={handleCopySelected} disabled={selectionHasImage} />
                    <HighContrastButton label="Merge Selected" onPress={handleMergeSelected} disabled={!canMerge} />
                    <HighContrastButton label="Delete Selected" onPress={handleDeleteSelected} />
                  </View>
                  <View style={styles.btnRow}>
                    <HighContrastButton label="Unmerge" onPress={handleUnmergeSelected} disabled={unmergeableCount === 0} />
                    <HighContrastButton label="Cancel" onPress={handleCancel} />
                  </View>
                </>
              )}
            </>
          )}
        </View>

        <Text style={styles.buildLabel}>{BUILD_LABEL}</Text>
      </View>

      {/* Local Filter & Sort Popover Menu */}
      {isPopoverOpen && (
        <FilterPopover
          sortMode={activeSortMode}
          onSortChange={(mode) => {
            setActiveSortMode(mode);
            setIsPopoverOpen(false);
          }}
          activeSourceFilter={activeSourceFilter}
          sources={uniqueSources}
          onSourceChange={(source) => {
            setActiveSourceFilter(source);
            setIsPopoverOpen(false);
          }}
          onClose={() => setIsPopoverOpen(false)}
        />
      )}

      {/* Settings Popover Menu */}
      {isSettingsOpen && (
        <SettingsPopover
          autoRemoveInserted={autoRemoveInserted}
          onAutoRemoveChange={(value) => {
            setAutoRemoveInserted(value);
            StorageService.setAutoRemoveInserted(value);
          }}
          combineInserted={combineInserted}
          onCombineChange={(value) => {
            setCombineInserted(value);
            StorageService.setCombineInserted(value);
          }}
          insertFontSize={insertFontSize}
          onInsertFontSizeChange={(size) => {
            setInsertFontSize(size);
            StorageService.setInsertFontSize(size);
          }}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    padding: 16,
    flexDirection: 'column',
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 8,
  },
  headerLeft: {
    position: 'absolute',
    left: 0,
    zIndex: 10,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
    minHeight: 64,
  },
  headerIcons: {
    position: 'absolute',
    right: 0,
    flexDirection: 'row',
    gap: 16,
    zIndex: 10,
  },
  iconButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    height: 64,
  },
  iconImage: {
    width: 48,
    height: 48,
    resizeMode: 'contain',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
  },
  subtitle: {
    fontSize: 18,
    color: '#666666',
    textAlign: 'center',
    width: '100%',
  },
  headerSubtitleRow: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    width: '100%',
  },
  headerChips: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  headerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#000000',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#000000',
    gap: 6,
  },
  headerChipText: {
    fontSize: 12,
    color: '#ffffff',
  },
  headerChipClearImage: {
    width: 12,
    height: 12,
    tintColor: '#ffffff',
  },
  footer: {
    flexDirection: 'column',
    gap: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  // Root wrapper for crop mode: holds the CropOverlay plus the (absolute) selection modal.
  cropRoot: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  buildLabel: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'right',
    marginTop: 6,
  },
});
