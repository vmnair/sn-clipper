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
  ScrollView,
  FlatList,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { ClipService } from './services/ClipService';
import { ClipItem, ClipSubElement, StorageService, DEFAULT_INSERT_FONT_SIZE } from './services/StorageService';
import { PluginManager } from 'sn-plugin-lib';
import { HighContrastButton } from './components/HighContrastButton';
import { CropOverlay } from './components/CropOverlay';
import { PromptDialog } from './components/PromptDialog';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { SearchBar } from './components/SearchBar';
import { FilterPopover } from './components/FilterPopover';
import { SettingsPopover } from './components/SettingsPopover';
import { IndexService, HeadingItem, KeywordOccurrence } from './services/IndexService';
import { ClipList } from './components/ClipList';
import { deriveArticleName, isDocFile } from './utils/paths';
import { splitTextToFit, countWrappedLines, measureWrappedText } from './utils/text';
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

    const now = Date.now();
    for (const entry of entries) {
      const name = entry.substring(entry.lastIndexOf('/') + 1);
      // Only sweep TRANSIENT captures (reader screenshots / temp crop pages) that were orphaned
      // by a crash mid-capture. NEVER touch clip_* files — those are user data (the backing
      // images of image clips), already deleted by ClipService.deleteClips when a clip is
      // removed. Sweeping them here previously deleted LIVE clip images whenever the clip list
      // was momentarily empty at mount, leaving blank-image clips (data loss).
      const isTransient = name.startsWith('reader_shot_') || name.startsWith('temp_crop_page_');
      if (!isTransient) continue;

      const tsMatch = name.match(/(\d{10,})/); // embedded Date.now() (13 digits)
      const ts = tsMatch ? parseInt(tsMatch[1], 10) : 0;
      const isStale = !ts || now - ts > CAPTURE_STALE_MS;
      if (!isStale) continue; // keep a possibly-pending fresh capture

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
  // Combine inserted text clips into a single text box (default off — separate keeps a
  // per-clip inline source link, matching the plugin's per-document referencing purpose).
  const [combineInserted, setCombineInserted] = useState(false);
  // Source-reference toggles (both default on). Source is always captured; these only
  // gate the two display surfaces: the Clipper card jump icon, and the inserted-note link.
  const [showSourceInClipper, setShowSourceInClipper] = useState(true);
  const [insertSourceLink, setInsertSourceLink] = useState(true);
  const [enableToc, setEnableToc] = useState(false);
  const [enableKeywordIndex, setEnableKeywordIndex] = useState(false);

  // Tab State: 'clips' | 'toc' | 'index'
  const [activeTab, setActiveTab] = useState<'clips' | 'toc' | 'index'>('clips');
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [keywords, setKeywords] = useState<KeywordOccurrence[]>([]);
  const [isGeneratingToc, setIsGeneratingToc] = useState(false);
  const [tocUpdatedAt, setTocUpdatedAt] = useState<number | null>(null);
  const [isScanningIndex, setIsScanningIndex] = useState(false);
  const [indexSearchQuery, setIndexSearchQuery] = useState('');

  const [editingHeading, setEditingHeading] = useState<HeadingItem | null>(null);
  const [editTitleInput, setEditTitleInput] = useState<string>('');

  // If the active tab gets disabled in Settings, fall back to the Clips tab so its content
  // doesn't linger on screen after the feature is turned off.
  useEffect(() => {
    if (activeTab === 'toc' && !enableToc) setActiveTab('clips');
    if (activeTab === 'index' && !enableKeywordIndex) setActiveTab('clips');
  }, [enableToc, enableKeywordIndex, activeTab]);

  const handleOpenEditHeadingModal = (h: HeadingItem) => {
    setEditingHeading(h);
    setEditTitleInput(h.title);
  };

  const handleSaveHeadingTitle = async () => {
    if (!editingHeading || !currentFilePath) return;
    try {
      const trimmed = editTitleInput.trim();
      const overrides = await StorageService.getHeadingOverrides(currentFilePath);
      if (trimmed) {
        overrides[editingHeading.id] = trimmed;
        await StorageService.saveHeadingOverrides(currentFilePath, overrides);
        setHeadings(prev => prev.map(h => h.id === editingHeading.id ? { ...h, title: trimmed } : h));
        setEditingHeading(null);
        ToastAndroid.show('Heading title updated!', ToastAndroid.SHORT);
      } else {
        // Clearing the field removes the override and reverts to the detected/recognized title.
        delete overrides[editingHeading.id];
        await StorageService.saveHeadingOverrides(currentFilePath, overrides);
        setEditingHeading(null);
        const items = await IndexService.scanHeadings(currentFilePath);
        setHeadings(items);
        ToastAndroid.show('Reverted to detected title.', ToastAndroid.SHORT);
      }
    } catch (e) {
      ToastAndroid.show('Failed to save title', ToastAndroid.SHORT);
    }
  };



  // True while an insert is running — disables the Insert button so rapid taps can't kick off
  // a second concurrent insert (which would duplicate content). insertingRef guards re-entry
  // synchronously (before the state update lands).
  const [isInserting, setIsInserting] = useState(false);
  const insertingRef = useRef(false);

  // False until the first context check resolves the launch mode. We hold back the dashboard
  // render until then so a prompt/crop launch never flashes the dashboard first (the "glimpse
  // of Clipper" before the prompt dialog).
  const [contextResolved, setContextResolved] = useState(false);

  // Confirmation Dialog States (for deleted/broken source links)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmDescription, setConfirmDescription] = useState('');
  const [confirmConfirmLabel, setConfirmConfirmLabel] = useState('Confirm');
  const [confirmCancelLabel, setConfirmCancelLabel] = useState('Cancel');
  const [onConfirmCallback, setOnConfirmCallback] = useState<{ fn: () => void } | null>(null);

  // A plugin button press (e.g. the reader's selection-popup "Clip" entry) fires
  // while the reader page is still on screen, so we screenshot it right then. The
  // crop flow prefers this crisp, WYSIWYG capture over generateDocImage — which is
  // essential for reflowable EPUB, whose re-rendered pagination never matches the
  // reader. Holds { promise, ts }; consumed once by handleStartCropping.
  const pendingReaderShot = useRef<{ promise: Promise<any>; ts: number; path: string } | null>(null);
  // Cached plugin dir so the button-press listener can build the shot path without
  // an async round-trip that would delay the capture.
  const pluginDirRef = useRef<string | null>(null);
  // True while a launch-mode 'prompt' dialog is active for this launch. Guards against a
  // follow-up context check (e.g. AppState 'active') reading the already-consumed 'normal'
  // launch mode and dismissing the just-shown prompt (the flash-then-disappear regression).
  const promptActiveRef = useRef(false);

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
    StorageService.getShowSourceInClipper().then(setShowSourceInClipper);
    StorageService.getInsertSourceLink().then(setInsertSourceLink);
    StorageService.getEnableToc().then(setEnableToc);
    // Keyword Index is on hold: keep it disabled regardless of any previously persisted value so
    // the Index tab stays hidden (its Settings toggle has been removed).

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
            promptActiveRef.current = true;
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
        // launchMode is 'normal' or 'crop'. Clear stale prompt state — but NOT when a prompt
        // is active for this launch: a follow-up check (AppState 'active') sees the already-
        // consumed 'normal' mode and would otherwise dismiss the just-shown prompt.
        if (!promptActiveRef.current) {
          setShowPromptDialog(false);
          setPromptText('');
        }

        if (launchMode !== 'crop') {
          setIsCropping(false);
        }

        const fileRes = await PluginCommAPI.getCurrentFilePath();
        if (fileRes.success && fileRes.result) {
          const filePath = fileRes.result;
          setCurrentFilePath(filePath);
          setIsNoteFile(!isDocFile(filePath));

          // Restore the last-built ToC snapshot so the ToC tab shows its state (count + last
          // updated time) without re-scanning the note on open.
          StorageService.getTocState(filePath).then(state => {
            if (state) {
              setHeadings(state.headings);
              setTocUpdatedAt(state.updatedAt);
            }
          });

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
      } finally {
        // The launch mode is now known — safe to render the dashboard (or the prompt/crop view
        // already shown above). Runs on every path so we never get stuck on the placeholder.
        setContextResolved(true);
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

  const filteredKeywords = useMemo(() => {
    if (!indexSearchQuery.trim()) return keywords;
    const q = indexSearchQuery.toLowerCase();
    return keywords.filter((k) => k.keyword.toLowerCase().includes(q));
  }, [keywords, indexSearchQuery]);

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
      // Figures and text can be selected together — Insert now stacks mixed content, Copy
      // copies the text parts (images skipped), and Merge stays disabled for figures.
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
  // Whether the selection contains any copyable text (a mixed image+text selection does;
  // an image-only selection does not). Copy is enabled only when there is text to copy.
  const selectionHasText = useMemo(
    () => clips.some((c) => selectedIds.includes(c.id) && !!c.elements && c.elements.some((e) => e.type === 'text' && !!e.text && e.text.trim().length > 0)),
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

  const handleOpenSource = async (clip: ClipItem, element: ClipSubElement, elementIndex: number) => {
    if (!element.documentPath) return;
    try {
      const { FileUtils, PluginCommAPI } = require('sn-plugin-lib');
      const exists = await FileUtils.exists(element.documentPath);
      if (!exists) {
        setConfirmTitle('Broken Source Link');
        setConfirmDescription(
          `The original document "${element.articleName || clip.articleName}" has been deleted. Would you like to remove the source link from this clipping? (The highlight text will be kept).`
        );
        setConfirmConfirmLabel('Remove Link');
        setConfirmCancelLabel('Keep Link');
        setOnConfirmCallback({
          fn: async () => {
            await ClipService.removeLinkFromElement(clip.id, elementIndex);
            setShowConfirmDialog(false);
            ToastAndroid.show('Source link removed.', ToastAndroid.SHORT);
          },
        });
        setShowConfirmDialog(true);
        return;
      }

      // Skip a redundant relaunch when the reader is already on the target file+page.
      const fileRes = await PluginCommAPI.getCurrentFilePath();
      const pageRes = await PluginCommAPI.getCurrentPageNum();
      if (fileRes.success && fileRes.result && pageRes.success && pageRes.result !== undefined && pageRes.result !== null) {
        const normalizePath = (p: string) => p.startsWith('file://') ? p.substring(7) : p;
        const targetPath = normalizePath(element.documentPath);
        const currentPath = normalizePath(fileRes.result);
        const targetPage = element.documentPage ?? 0;
        const currentPage = pageRes.result;

        if (targetPath === currentPath && targetPage === currentPage) {
          ToastAndroid.show('Already on this page.', ToastAndroid.SHORT);
          PluginManager.closePluginView();
          return;
        }
      }

      const { NativeModules } = require('react-native');
      await NativeModules.ImageCropModule.openFileDirectly(element.documentPath, element.documentPage ?? 0);
      PluginManager.closePluginView();
    } catch (err: any) {
      ToastAndroid.show(`Failed to open source document: ${err.message}`, ToastAndroid.SHORT);
    }
  };

  const handleJumpToNotePage = async (pageNumber: number) => {
    if (!currentFilePath) return;
    try {
      const pageIndex = Math.max(0, pageNumber - 1);
      const { NativeModules } = require('react-native');
      if (NativeModules.ImageCropModule && typeof NativeModules.ImageCropModule.openFileDirectly === 'function') {
        await NativeModules.ImageCropModule.openFileDirectly(currentFilePath, pageIndex);
      }
      PluginManager.closePluginView();
    } catch (err: any) {
      ToastAndroid.show(`Failed to jump to page: ${err.message}`, ToastAndroid.SHORT);
    }
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
        const count = await ClipService.addImageClip(
          destPath,
          articleName,
          rect.width,
          rect.height,
          currentFilePath || undefined,
          currentPageNum
        );
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
      const count = await ClipService.addClip(
        selectionText,
        articleName,
        currentFilePath || undefined,
        currentPageNum
      );
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
    if (insertingRef.current) return; // ignore re-entrant taps while an insert is in progress
    insertingRef.current = true;
    setIsInserting(true);
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

      // Read settings FRESH from storage (not the in-memory state, which may not have finished
      // its async load yet — right after a plugin update, an early insert could otherwise use
      // the default "auto-remove ON" and delete clips against the user's saved "off").
      const autoRemove = await StorageService.getAutoRemoveInserted();
      const combine = await StorageService.getCombineInserted();
      const linkSource = await StorageService.getInsertSourceLink();

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
      // Matches the note renderer's actual line pitch (measured ≈1.18·fontSize on device);
      // an oversized value made link/icon positions drift lower with each wrapped line.
      const lineHeight = Math.round(fontSize * 1.2);
      const gap = Math.round(lineHeight * 0.6);
      // Text boxes render their glyphs inset from the frame's left edge; images draw
      // edge-to-edge. To line images up with text (and clear the note's left toolbar), inset the
      // image left by this much. Scaled to the font (calibrated on Manta: font 44 → ~26px inset,
      // ≈0.6·fontSize) so it tracks the user's font choice; may need per-device tuning (e.g. Nomad).
      const imageLeftInset = Math.round(fontSize * 0.6);
      const MIN_SPLIT_LINES = 3;
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
          } else if (el.type === 100) { // Title/Heading type
            if (el.title) {
              elBottom = el.title.Y + el.title.height;
            }
          } else if (el.type === 0) { // Stroke / handwriting type
            continue; // Ignore stroke elements entirely
          } else if (el.type === 600) { // Text-link (our ↗ jump icon) — its extent is
            continue; // already covered by the text box it sits on; and its maxY is bogus.
          }
          if (elBottom <= 0 && el.maxY) {
            // Fallback for non-stroke types that have maxY but no computed bottom
            elBottom = el.maxY;
          }
          // Sanity clamp: some element types report a garbage maxY far past the page
          // (e.g. link elements report maxY≈16224 on a 2560-tall page). Never let such a
          // value push the start-Y off the page, which would make everything "not fit".
          if (elBottom > currentY && elBottom <= pageHeight) {
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
      const items: {
        clipId: string;
        type: 'text' | 'image';
        text?: string;
        imagePath?: string;
        width?: number;
        height?: number;
        documentPath?: string;
        documentPage?: number;
        articleName?: string;
      }[] = [];
      const elemCountByClip: Record<string, number> = {};
      for (const clip of clipsToInsert) {
        for (const el of clip.elements) {
          items.push({
            clipId: clip.id,
            type: el.type,
            text: el.text,
            imagePath: el.imagePath,
            width: el.width,
            height: el.height,
            documentPath: el.documentPath,
            documentPage: el.documentPage,
            articleName: el.articleName || clip.articleName
          });
          elemCountByClip[clip.id] = (elemCountByClip[clip.id] || 0) + 1;
        }
      }

      const maxWidth = pageWidth - 200;
      // Approx characters per line for the chosen font (proportional font ~0.5·fontSize wide,
      // calibrated to the device: a full line ≈78 chars at font 44 / maxWidth 1720).
      const charsPerLine = Math.max(1, Math.floor(maxWidth / (fontSize * 0.5)));
      // Word-wrap-aware line count (see countWrappedLines) — naive char-packing under-counts
      // and clipped the last line of longer clips.
      const estimateTextLines = (t: string) => countWrappedLines(t, charsPerLine);
      // Height the text content actually occupies. Link placement and the fit/pagination
      // checks use this; the inserted box gets a small extra pad (below) so descenders on the
      // last line aren't clipped.
      const estimateTextHeight = (linesCount: number) => linesCount * lineHeight;
      const boxDescenderPad = Math.round(lineHeight * 0.35);
      const insertTextBox = async (content: string, top: number, height: number) => {
        await PluginNoteAPI.insertText({
          textContentFull: content,
          // Pad the box slightly beyond the estimated content height so the last line's
          // descenders (and minor estimation error) are never clipped. The extra space is
          // invisible (no frame) and links/next content are placed off the content height.
          textRect: { left: 100, top, right: 100 + maxWidth, bottom: top + height + boxDescenderPad },
          fontSize,
          textAlign: 0,
          textBold: 0,
          textItalics: 0,
          textFrameWidthType: 0,
          textFrameStyle: 0,
          textEditable: 1,
        });
      };

      const fontSizeLink = Math.round(fontSize * 0.8);
      const linkHeight = Math.round(fontSizeLink * 1.35);
      const linkSpace = linkHeight + gap;
      const linkGap = Math.round(lineHeight * 0.2); // tight, uniform gap between text and its link
      const JUMP_ICON = '↗';
      const iconWidth = Math.round(fontSizeLink * 1.4);
      const charWidthPx = fontSize * 0.5; // avg glyph advance; must match the charsPerLine factor above

      const { FileUtils } = require('sn-plugin-lib');

      // Insert the small tappable jump icon with its right edge at the page's right margin.
      // `topY` is the icon's top. destPath/destPage/linkType are preserved so tapping performs
      // the same source jump as before — only the label (now just an icon) and size changed.
      const performInsertJumpIcon = async (destPath: string, destPage: number, topY: number) => {
        const linkType = destPath.endsWith('.note') || destPath.endsWith('.not')
          ? (destPage !== undefined ? 0 : 1)
          : 2;
        const right = 100 + maxWidth;
        await PluginNoteAPI.insertTextLink({
          destPath,
          destPage: destPage || 0,
          style: 0, // solid underline
          linkType,
          rect: { left: right - iconWidth, top: topY, right, bottom: topY + linkHeight },
          fontSize: fontSizeLink,
          fullText: JUMP_ICON,
          showText: JUMP_ICON,
          isItalic: 0,
        });
      };

      // Full-width labeled link for Combine mode, where clips are merged into one box and the
      // links stack at the end — a bare icon would give no clue which source it points to, so
      // we show "[name, p. N ↗]" (name truncated) for context.
      const performInsertLabeledLink = async (destPath: string, destPage: number, articleNameStr: string, topY: number) => {
        const pageNum = destPage !== undefined ? destPage + 1 : 1;
        const cleanName = (articleNameStr || 'Unknown Document').replace(/\.[^/.]+$/, ''); // strip extension
        const shortenedName = cleanName.length > 24 ? cleanName.substring(0, 23) + '…' : cleanName;
        const labelText = `[${shortenedName}, p. ${pageNum} ↗]`;
        const linkType = destPath.endsWith('.note') || destPath.endsWith('.not')
          ? (destPage !== undefined ? 0 : 1)
          : 2;
        await PluginNoteAPI.insertTextLink({
          destPath,
          destPage: destPage || 0,
          style: 0, // solid underline
          linkType,
          rect: { left: 100, top: topY, right: 100 + maxWidth, bottom: topY + linkHeight },
          fontSize: fontSizeLink,
          fullText: labelText,
          showText: labelText,
          isItalic: 0,
        });
      };

      // Place the jump icon on the clip's last text line at the right margin when there's
      // room; if the last line reaches too far right, drop the icon onto its own right-aligned
      // line just below (so it never overlaps text). The first source is the inline one; any
      // extra unique sources (rare) stack on their own lines. Returns the Y to continue from.
      const placeJumpIconForBlock = async (
        boxTop: number,
        lines: number,
        lastLineChars: number,
        links: { path: string; page: number }[],
      ): Promise<number> => {
        const contentBottom = boxTop + lines * lineHeight;
        const [primary, ...rest] = links;
        const lastLineTop = boxTop + (lines - 1) * lineHeight;
        const lastWordRight = 100 + Math.round(lastLineChars * charWidthPx);
        const iconLeft = (100 + maxWidth) - iconWidth;
        const fitsInline = lastWordRight + Math.round(charWidthPx) <= iconLeft;
        let y: number;
        if (fitsInline) {
          await performInsertJumpIcon(primary.path, primary.page, lastLineTop + Math.round((lineHeight - linkHeight) / 2));
          y = contentBottom; // icon consumed no extra line
        } else {
          const iconTop = contentBottom + linkGap;
          await performInsertJumpIcon(primary.path, primary.page, iconTop);
          y = iconTop + linkHeight;
        }
        for (const link of rest) {
          const iconTop = y + linkGap;
          await performInsertJumpIcon(link.path, link.page, iconTop);
          y = iconTop + linkHeight;
        }
        return y + gap;
      };

      const getUniqueLinksSync = (groupItems: typeof items) => {
        const keys = new Set<string>();
        for (const item of groupItems) {
          if (item.documentPath) {
            keys.add(`${item.documentPath}#${item.documentPage || 0}`);
          }
        }
        return keys.size;
      };

      const getValidLinksForGroup = async (groupItems: typeof items) => {
        const uniqueLinksMap = new Map<string, { path: string; page: number; articleName: string }>();
        for (const item of groupItems) {
          if (item.documentPath) {
            const exists = await FileUtils.exists(item.documentPath);
            if (exists) {
              const key = `${item.documentPath}#${item.documentPage || 0}`;
              uniqueLinksMap.set(key, {
                path: item.documentPath,
                page: item.documentPage || 0,
                articleName: item.articleName || 'Unknown Document',
              });
            } else {
              // Silently clean up metadata in storage
              try {
                const matchClip = clips.find(c => c.id === item.clipId);
                if (matchClip && matchClip.elements) {
                  const elemIdx = matchClip.elements.findIndex(
                    el => el.documentPath === item.documentPath && el.documentPage === item.documentPage
                  );
                  if (elemIdx !== -1) {
                    await ClipService.removeLinkFromElement(matchClip.id, elemIdx);
                  }
                }
              } catch (e) {
                // Ignore silent cleanup errors
              }
            }
          }
        }
        return Array.from(uniqueLinksMap.values());
      };

      // Insert an image and position it at the given rect. Supernote's insertImage centers the
      // image by default; the recipe to place it: insert → save → getLastElement → recreate the
      // element's backing PNG (deleted after save, else code 1211) from our clip image →
      // modifyElements with pageNum/layerNum set (else code 107) + the target rect → save.
      // Returns whether the reposition succeeded (false = image left centered as a fallback).
      // Places the image at (100, top), fitting it within (maxW, maxH) while preserving aspect.
      // CRITICAL: the size is derived from the element's OWN natural rect and NEVER upscaled —
      // asking the note to render an image larger than its source PNG makes its OpenCV resize
      // read past the image bounds and crash the note app (cv::Exception ROI assertion).
      // Returns the placed height on success, or null (image left centered) on failure.
      const insertPositionedImage = async (
        imagePath: string,
        top: number,
        maxW: number,
        maxH: number,
      ): Promise<number | null> => {
        await PluginNoteAPI.insertImage(imagePath);
        await PluginNoteAPI.saveCurrentNote();
        try {
          const lastRes = await PluginFileAPI.getLastElement() as any;
          const el = (lastRes && lastRes.result) ? lastRes.result : null;
          if (el && el.type === 200 && el.picture && el.picture.rect) {
            const r = el.picture.rect;
            const natW = r.right - r.left, natH = r.bottom - r.top;
            if (natW <= 0 || natH <= 0) return null;
            // Never scale above 1 (no upscale) → the target never exceeds the source PNG.
            const scale = Math.min(maxW / natW, maxH / natH, 1);
            const targetW = Math.max(1, Math.round(natW * scale));
            const targetH = Math.max(1, Math.round(natH * scale));
            const picturePath = el.picture.picturePath;
            if (picturePath && !(await FileUtils.exists(picturePath))) {
              try { await FileUtils.copyFile(imagePath, picturePath); } catch (e) { /* fall through */ }
            }
            // Inset the image left to align with the text's visual left (see imageLeftInset).
            const imgLeft = 100 + imageLeftInset;
            const modified = {
              ...el, pageNum: page, layerNum: 0,
              picture: { ...el.picture, rect: { left: imgLeft, top, right: imgLeft + targetW, bottom: top + targetH } },
            };
            const modRes = await PluginFileAPI.modifyElements(notePath, page, [modified]) as any;
            await PluginNoteAPI.saveCurrentNote();
            return (modRes && modRes.success) ? targetH : null;
          }
        } catch (e) { /* best-effort: image stays centered */ }
        return null;
      };

      const insertedCountByClip: Record<string, number> = {};
      const splitRemainder: Record<string, string> = {}; // clipId -> un-inserted tail of a split clip
      let imagesInserted = existingImageCount;
      let outOfSpace = false;    // content didn't fit; more on the next page
      let splitOccurred = false; // a single clip was split across pages
      let attemptedInserts = 0;
      // Images are positioned (insertPositionedImage) and stack like text; content is deferred
      // to a new page only when it doesn't fit the remaining space.
      let pageHasContent = currentY > 100 || existingImageCount > 0;

      let i = 0;
      while (i < items.length) {
        const item = items[i];

        if (item.type === 'image') {
          if (!item.imagePath) {
            insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;
            i++;
            continue;
          }
          const linkReserve = (item.documentPath && linkSource) ? linkSpace : 0;
          const availHeight = (pageHeight - gap) - currentY;
          const fullPageAvail = (pageHeight - gap) - 100;
          // Rough pre-check (stored crop dims, may be missing) to decide defer-vs-place BEFORE
          // inserting. The ACTUAL size comes from the element's natural rect in
          // insertPositionedImage (which never upscales), so this is only a hint.
          const guessW = item.width && item.width > 0 ? item.width : Math.round(maxWidth * 0.6);
          const guessH = item.height && item.height > 0 ? item.height : Math.round(maxWidth * 0.45);
          const guessFitW = Math.min(maxWidth, guessW);
          const guessFitH = Math.round(guessH * (guessFitW / guessW));
          // If it won't fit the remaining space and the page already has content, move to a new page.
          if (pageHasContent && guessFitH + linkReserve > availHeight) {
            outOfSpace = true;
            break;
          }
          const top = currentY;
          const maxH = Math.max(1, (pageHasContent ? availHeight : fullPageAvail) - linkReserve);
          // Reduce by the left inset so a full-width image's right edge still lands at the
          // text's right margin (100 + maxWidth).
          const placedH = await insertPositionedImage(item.imagePath, top, maxWidth - imageLeftInset, maxH);
          attemptedInserts++;
          insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;
          imagesInserted++;
          pageHasContent = true;
          await new Promise(r => setTimeout(r, 300));
          i++;
          if (placedH === null) {
            // Reposition failed → the image is centered; don't stack more onto this page.
            if (i < items.length) outOfSpace = true;
            break;
          }
          currentY = top + placedH;
          // Source jump icon under the image, right-aligned (when enabled).
          if (item.documentPath && linkSource) {
            const validLinks = await getValidLinksForGroup([item]);
            if (validLinks.length > 0) {
              const iconTop = currentY + linkGap;
              await performInsertJumpIcon(validLinks[0].path, validLinks[0].page, iconTop);
              currentY = iconTop + linkHeight;
            }
          }
          currentY += gap;
          continue; // images stack like text
        }

        // Empty/whitespace-only text elements carry no content — count them as "inserted"
        // (so their clip can still be removed) but don't create a blank text box for them.
        if (!item.text || !item.text.trim()) { insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1; i++; continue; }

        const availHeight = (pageHeight - gap) - currentY;

        if (combine) {
          // Combine consecutive whole text items that fit into a single text box, separated
          // by one blank line. Spacing is then a literal blank line — uniform, not dependent
          // on the (fixed-height-box) height estimate.
          const group: typeof items = [];
          let groupLines = 0;
          let j = i;
          while (j < items.length && items[j].type === 'text' && items[j].text) {
            const tempGroup = [...group, items[j]];
            const tempCombined = tempGroup.map((g) => g.text).join('\n\n');
            const tempGroupLines = estimateTextLines(tempCombined);
            const tempGroupHeight = estimateTextHeight(tempGroupLines);
            const linkCount = getUniqueLinksSync(tempGroup);
            const totalBlockHeight = tempGroupHeight + (linkCount * linkSpace);
            if (group.length === 0) {
              if (totalBlockHeight > availHeight) break; // first item alone doesn't fit → split/defer below
            } else if (totalBlockHeight > availHeight) {
              break;
            }
            group.push(items[j]);
            groupLines = tempGroupLines;
            j++;
          }
          if (group.length > 0) {
            const combined = group.map((g) => g.text).join('\n\n');
            const combinedWrap = measureWrappedText(combined, charsPerLine);
            const groupHeight = combinedWrap.lines * lineHeight;
            await insertTextBox(combined, currentY, groupHeight);
            attemptedInserts++;
            group.forEach((g) => { insertedCountByClip[g.clipId] = (insertedCountByClip[g.clipId] || 0) + 1; });

            const validLinks = linkSource ? await getValidLinksForGroup(group) : [];
            if (validLinks.length > 0) {
              // Combine mode: stack labeled links after the box so each is identifiable.
              let ny = currentY + groupHeight + linkGap;
              for (const link of validLinks) {
                await performInsertLabeledLink(link.path, link.page, link.articleName, ny);
                ny += linkSpace;
              }
              currentY = ny;
            } else {
              currentY = currentY + groupHeight + gap;
            }
            pageHasContent = true;
            i = j;
            await new Promise(r => setTimeout(r, 300));
            // One combined box per page: whatever remains continues on the next page.
            if (i < items.length) {
              outOfSpace = true;
            }
            break;
          }
          // group empty → the single item is taller than the remaining space; fall through.
        }

        // Single text item: fits whole, or split across pages, or defer to a fresh page.
        const t = item.text;
        const wrap = measureWrappedText(t, charsPerLine);
        const estLines = wrap.lines;
        const estH = estLines * lineHeight;
        const singleLinkCount = item.documentPath ? 1 : 0;
        const totalSingleHeight = estH + (singleLinkCount * linkSpace);
        if (totalSingleHeight <= availHeight) {
          await insertTextBox(t, currentY, estH);
          attemptedInserts++;
          insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;

          let linksInserted = false;
          if (item.documentPath && linkSource) {
            const validLinks = await getValidLinksForGroup([item]);
            if (validLinks.length > 0) {
              // Icon on the last text line at the right margin (no extra line → even spacing).
              currentY = await placeJumpIconForBlock(currentY, estLines, wrap.lastLineChars, validLinks);
              linksInserted = true;
            }
          }
          if (!linksInserted) currentY = currentY + estH + gap;
          pageHasContent = true;
          i++;
          await new Promise(r => setTimeout(r, 300));
          if (combine) break; // combine handles multi-item via the group; be safe
          continue; // separate mode: keep stacking boxes on this page
        } else {
          // When auto-remove is OFF the clip is kept intact, so we can't trim it down to the
          // un-inserted remainder — splitting would leave the whole clip in Clipper and
          // re-inserting on the next page would duplicate the chunk. Defer the WHOLE clip to a
          // fresh page instead, as long as it fits on one (a clip taller than a full page has
          // no choice but to split).
          const fullPageAvail = (pageHeight - gap) - 100;
          if (!autoRemove && totalSingleHeight <= fullPageAvail) {
            outOfSpace = true;
            break;
          }
          const linesThatFit = Math.floor((availHeight - (item.documentPath ? linkSpace : 0)) / lineHeight);
          if (linesThatFit < MIN_SPLIT_LINES) { outOfSpace = true; break; } // start fresh next page
          // Leave headroom for word-wrap waste so the chunk actually wraps within linesThatFit.
          const charBudget = Math.floor(linesThatFit * charsPerLine * 0.9);
          const [chunk, remainder] = splitTextToFit(t, charBudget);
          if (!chunk) { outOfSpace = true; break; }
          const chunkWrap = measureWrappedText(chunk, charsPerLine);
          const chunkH = chunkWrap.lines * lineHeight;
          await insertTextBox(chunk, currentY, chunkH);
          attemptedInserts++;
          if (remainder) { splitRemainder[item.clipId] = remainder; splitOccurred = true; }

          if (item.documentPath && linkSource) {
            const validLinks = await getValidLinksForGroup([item]);
            if (validLinks.length > 0) {
              currentY = await placeJumpIconForBlock(currentY, chunkWrap.lines, chunkWrap.lastLineChars, validLinks);
            } else {
              currentY = currentY + chunkH + gap;
            }
          } else {
            currentY = currentY + chunkH + gap;
          }
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
      if (allPersisted && autoRemove) {
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
      } else if (!allPersisted) {
        ToastAndroid.show('Some clips could not be inserted; they are kept in Clipper.', ToastAndroid.LONG);
      } else {
        ToastAndroid.show(
          autoRemove ? 'Clips inserted successfully!' : 'Clips inserted (kept in Clipper)',
          ToastAndroid.SHORT
        );
        // Return to the document to show the newly inserted content.
        PluginManager.closePluginView();
      }
    } catch (e: any) {
      ToastAndroid.show(`Insert failed: ${e.message}`, ToastAndroid.SHORT);
    } finally {
      insertingRef.current = false;
      setIsInserting(false);
    }
  };

  // Handlers for Table of Contents & Keyword Index

  // Scan the note and write/refresh the ToC page. `insertBlankFirst` prepends a blank page first
  // (used after the user confirms, when page 1 already has content).
  const runTocBuild = async (insertBlankFirst: boolean) => {
    if (!currentFilePath) {
      ToastAndroid.show('No active note file open', ToastAndroid.SHORT);
      return;
    }
    setIsGeneratingToc(true);
    try {
      const res = await IndexService.generateTocPage(currentFilePath, insertFontSize, { insertBlankFirst });

      // Page 1 has user content — ask before inserting a blank front page.
      if (res.needsBlankPage) {
        setIsGeneratingToc(false);
        setConfirmTitle('Page 1 has content');
        setConfirmDescription('Page 1 of this note already contains writing. Insert a blank page at the front for the Table of Contents?');
        setConfirmConfirmLabel('Insert Blank Page');
        setConfirmCancelLabel('Cancel');
        setOnConfirmCallback({
          fn: async () => {
            setShowConfirmDialog(false);
            await runTocBuild(true);
          },
        });
        setShowConfirmDialog(true);
        return;
      }

      if (res.success) {
        const items = res.headings || [];
        const updatedAt = Date.now();
        await StorageService.setTocState(currentFilePath, { headings: items, updatedAt });
        setHeadings(items);
        setTocUpdatedAt(updatedAt);
        ToastAndroid.show(res.message || 'Table of Contents created!', ToastAndroid.LONG);
        PluginManager.closePluginView();
      } else {
        ToastAndroid.show(res.message || 'Failed to generate ToC page', ToastAndroid.LONG);
      }
    } catch (e: any) {
      ToastAndroid.show('Failed to generate ToC page', ToastAndroid.LONG);
    } finally {
      setIsGeneratingToc(false);
    }
  };

  const handleBuildToc = () => { runTocBuild(false); };

  const handleRefreshIndex = async () => {
    if (!currentFilePath) {
      ToastAndroid.show('No active note file open', ToastAndroid.SHORT);
      return;
    }
    setIsScanningIndex(true);
    try {
      const items = await IndexService.scanKeywords(currentFilePath);
      setKeywords(items);
      if (items.length === 0) {
        ToastAndroid.show('No keywords found in this note', ToastAndroid.SHORT);
      }
    } catch (e: any) {
      ToastAndroid.show('Failed to scan keywords', ToastAndroid.SHORT);
    } finally {
      setIsScanningIndex(false);
    }
  };

  const handleGenerateIndexPage = async () => {
    if (!currentFilePath) {
      ToastAndroid.show('No active note file open', ToastAndroid.SHORT);
      return;
    }
    setIsScanningIndex(true);
    try {
      const res = await IndexService.generateIndexPage(currentFilePath, insertFontSize);
      if (res.success) {
        ToastAndroid.show(res.message || 'Keyword Index generated at Last Page!', ToastAndroid.LONG);
        PluginManager.closePluginView();
      } else {
        ToastAndroid.show(res.message || 'Failed to generate Keyword Index page', ToastAndroid.LONG);
      }
    } catch (e: any) {
      ToastAndroid.show('Failed to generate Keyword Index page', ToastAndroid.LONG);
    } finally {
      setIsScanningIndex(false);
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
            promptActiveRef.current = false;
            setShowPromptDialog(false);
            await ClipService.setPromptText('');
            await handleStartCropping(currentFilePath || undefined, currentPageNum);
          }}
          onClipText={async () => {
            promptActiveRef.current = false;
            setShowPromptDialog(false);
            await ClipService.setPromptText('');
            await ClipService.addClip(
              promptText,
              deriveArticleName(currentFilePath),
              currentFilePath || undefined,
              currentPageNum
            );
            ToastAndroid.show('Clipped as Text!', ToastAndroid.SHORT);
            const { PluginManager } = require('sn-plugin-lib');
            PluginManager.closePluginView();
          }}
          onCancel={async () => {
            promptActiveRef.current = false;
            setShowPromptDialog(false);
            await ClipService.setPromptText('');
            const { PluginManager } = require('sn-plugin-lib');
            PluginManager.closePluginView();
          }}
        />
      </SafeAreaView>
    );
  }

  // Hold back the dashboard until the launch mode is known, so a prompt/crop launch shows the
  // dialog directly instead of flashing the (possibly still-loading) dashboard first.
  if (!contextResolved) {
    return <SafeAreaView style={styles.safeArea} />;
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
        </View>

        {/* Navigation Bar (Tabs) */}
        {(enableToc || enableKeywordIndex) && (
          <View style={styles.navTabBar}>
            <Pressable
              onPress={() => setActiveTab('clips')}
              style={[styles.navTab, activeTab === 'clips' && styles.navTabActive]}
            >
              <Text style={[styles.navTabText, activeTab === 'clips' && styles.navTabTextActive]}>
                📋 Clips ({clips.length})
              </Text>
            </Pressable>
            {enableToc && (
              <Pressable
                onPress={() => setActiveTab('toc')}
                style={[styles.navTab, activeTab === 'toc' && styles.navTabActive]}
              >
                <Text style={[styles.navTabText, activeTab === 'toc' && styles.navTabTextActive]}>
                  📖 ToC ({headings.length})
                </Text>
              </Pressable>
            )}
            {enableKeywordIndex && (
              <Pressable
                onPress={() => {
                  setActiveTab('index');
                  if (keywords.length === 0) handleRefreshIndex();
                }}
                style={[styles.navTab, activeTab === 'index' && styles.navTabActive]}
              >
                <Text style={[styles.navTabText, activeTab === 'index' && styles.navTabTextActive]}>
                  🏷️ Index ({keywords.length})
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Tab 1: Clips View */}
        {activeTab === 'clips' && (
          <>
            {/* Subtitle / Status row */}
            <View style={styles.headerSubtitleRow}>
              <Text style={styles.subtitle}>
                {isSelectionMode 
                  ? `${selectedIds.length} of ${processedClips.length} clip(s) selected` 
                  : `${processedClips.length} clip(s) visible`}
              </Text>
              {(activeSourceFilter !== null || (isSearchVisible && searchQuery.trim() !== '')) && (
                <View style={styles.headerChips}>
                  {isSearchVisible && searchQuery.trim() !== '' && (
                    <Pressable onPress={() => setSearchQuery('')} style={styles.headerChip}>
                      <Text style={styles.headerChipText} numberOfLines={1}>Search: "{searchQuery}"</Text>
                      <Image source={require('../assets/icon/clear.png')} style={styles.headerChipClearImage} />
                    </Pressable>
                  )}
                  {activeSourceFilter !== null && (
                    <Pressable onPress={() => setActiveSourceFilter(null)} style={styles.headerChip}>
                      <Text style={styles.headerChipText} numberOfLines={1}>Source: {activeSourceFilter}</Text>
                      <Image source={require('../assets/icon/clear.png')} style={styles.headerChipClearImage} />
                    </Pressable>
                  )}
                </View>
              )}
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
              onOpenSource={handleOpenSource}
              showSource={showSourceInClipper}
            />

            {/* Footer Actions Area */}
            <View style={styles.footer}>
              {!isSelectionMode ? (
                <View style={styles.btnRow}>
                  <HighContrastButton label="Copy Visible" onPress={handleCopyAllVisible} disabled={processedClips.length === 0} />
                  {isNoteFile && (
                    <HighContrastButton label="Insert into open Note" onPress={handleInsertVisible} disabled={processedClips.length === 0 || isInserting} />
                  )}
                  <HighContrastButton label="Clear All" onPress={handleClearAll} disabled={clips.length === 0} />
                </View>
              ) : (
                <>
                  {isNoteFile ? (
                    <>
                      <View style={styles.btnRow}>
                        <HighContrastButton label="Copy Selected" onPress={handleCopySelected} disabled={!selectionHasText} />
                        <HighContrastButton label="Insert into open Note" onPress={handleInsertSelected} disabled={isInserting} />
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
                        <HighContrastButton label="Copy Selected" onPress={handleCopySelected} disabled={!selectionHasText} />
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
          </>
        )}

        {/* Tab 2: Table of Contents View */}
        {enableToc && activeTab === 'toc' && (
          <View style={styles.tabViewContainer}>
            <Text style={styles.subtitle}>
              {tocUpdatedAt
                ? `${headings.length} heading(s) found in current note. Last updated ${new Date(tocUpdatedAt).toLocaleString()}.`
                : 'Tap "Build ToC" to scan this note and generate a Table of Contents.'}
            </Text>

            <ScrollView style={{ flex: 1, marginVertical: 12 }}>
              {headings.length === 0 ? (
                <Text style={{ textAlign: 'center', marginVertical: 32, fontSize: 16, color: '#666' }}>
                  {tocUpdatedAt
                    ? 'No headings detected. Add titles/headings in your note, then tap Update ToC.'
                    : 'No Table of Contents yet. Tap "Build ToC" below to scan this note for titles/headings.'}
                </Text>
              ) : (
                headings.map((h, idx) => (
                  <View key={h.id || idx} style={styles.tocCard}>
                    <Text style={styles.tocTitle}>{`${idx + 1}. ${h.title}`}</Text>
                    <Text style={styles.tocPage}>Page {h.page}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Pressable
                        onPress={() => handleOpenEditHeadingModal(h)}
                        style={styles.editButton}
                      >
                        <Text style={styles.editButtonText}>✏️ Edit</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.footer}>
              <View style={styles.btnRow}>
                <HighContrastButton
                  label={tocUpdatedAt ? '🔄 Update ToC (Page 1)' : '📖 Build ToC (Page 1)'}
                  onPress={handleBuildToc}
                  disabled={!isNoteFile || isGeneratingToc}
                />
              </View>
            </View>
          </View>
        )}

        {/* Tab 3: Keyword Index View */}
        {enableKeywordIndex && activeTab === 'index' && (
          <View style={styles.tabViewContainer}>
            <Text style={styles.subtitle}>
              {isScanningIndex ? 'Scanning note keywords...' : `${filteredKeywords.length} unique keyword(s) found`}
            </Text>

            <SearchBar
              value={indexSearchQuery}
              onChangeText={setIndexSearchQuery}
              onClear={() => setIndexSearchQuery('')}
            />

            <ScrollView style={{ flex: 1, marginVertical: 12 }}>
              {filteredKeywords.length === 0 ? (
                <Text style={{ textAlign: 'center', marginVertical: 32, fontSize: 16, color: '#666' }}>
                  No keywords detected. Text and native keywords will appear here automatically.
                </Text>
              ) : (
                filteredKeywords.map((kw, idx) => (
                  <View key={idx} style={styles.indexCard}>
                    <View style={styles.indexWordRow}>
                      <Text style={styles.indexWord}>{kw.keyword}</Text>
                      {kw.pages.length > 0 && (
                        <Pressable
                          onPress={() => handleJumpToNotePage(kw.pages[0])}
                          style={styles.jumpButton}
                        >
                          <Text style={styles.jumpButtonText}>↗ Jump (p. {kw.pages[0]})</Text>
                        </Pressable>
                      )}
                    </View>
                    <Text style={styles.indexPages}>Occurrences on page(s): {kw.pages.join(', ')}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.footer}>
              <View style={styles.btnRow}>
                <HighContrastButton
                  label="🏷️ Build / Update Index (Last Page)"
                  onPress={handleGenerateIndexPage}
                  disabled={!isNoteFile || isScanningIndex}
                />
                <HighContrastButton
                  label="🔄 Refresh"
                  onPress={handleRefreshIndex}
                  disabled={!isNoteFile || isScanningIndex}
                />
              </View>
            </View>
          </View>
        )}

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
          showSourceInClipper={showSourceInClipper}
          onShowSourceChange={(value) => {
            setShowSourceInClipper(value);
            StorageService.setShowSourceInClipper(value);
          }}
          insertSourceLink={insertSourceLink}
          onInsertSourceLinkChange={(value) => {
            setInsertSourceLink(value);
            StorageService.setInsertSourceLink(value);
          }}
          insertFontSize={insertFontSize}
          onInsertFontSizeChange={(size) => {
            setInsertFontSize(size);
            StorageService.setInsertFontSize(size);
          }}
          enableToc={enableToc}
          onEnableTocChange={(value) => {
            setEnableToc(value);
            StorageService.setEnableToc(value);
          }}
          onResetToDefault={() => {
            // Restore every setting to its application default.
            setAutoRemoveInserted(true); StorageService.setAutoRemoveInserted(true);
            setCombineInserted(false); StorageService.setCombineInserted(false);
            setInsertFontSize(DEFAULT_INSERT_FONT_SIZE); StorageService.setInsertFontSize(DEFAULT_INSERT_FONT_SIZE);
            setShowSourceInClipper(true); StorageService.setShowSourceInClipper(true);
            setInsertSourceLink(true); StorageService.setInsertSourceLink(true);
            setEnableToc(false); StorageService.setEnableToc(false);
            ToastAndroid.show('Settings reset to default.', ToastAndroid.SHORT);
          }}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
      {/* Shared confirmation dialog (broken links, ToC blank-page prompt, …) */}
      <ConfirmationDialog
        visible={showConfirmDialog}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmConfirmLabel}
        cancelLabel={confirmCancelLabel}
        onConfirm={() => {
          onConfirmCallback?.fn();
        }}
        onCancel={() => setShowConfirmDialog(false)}
      />

      {/* Modal for Editing Heading Title */}
      {editingHeading && (
        <Modal
          transparent
          animationType="none"
          statusBarTranslucent
          visible={!!editingHeading}
          onRequestClose={() => setEditingHeading(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Edit Heading Title (Page {editingHeading.page})</Text>
              <TextInput
                style={styles.modalInput}
                value={editTitleInput}
                onChangeText={setEditTitleInput}
                placeholder="Enter title name..."
                placeholderTextColor="#666666"
                autoFocus
                selectTextOnFocus
              />
              <View style={styles.modalBtnRow}>
                <Pressable
                  style={[styles.modalBtn, styles.modalBtnClear]}
                  onPress={() => setEditTitleInput('')}
                >
                  <Text style={styles.modalBtnCancelText}>🗑 Clear</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnCancel]}
                    onPress={() => setEditingHeading(null)}
                  >
                    <Text style={styles.modalBtnCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnSave]}
                    onPress={handleSaveHeadingTitle}
                  >
                    <Text style={styles.modalBtnSaveText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Progress dialog shown while the ToC is being scanned + written */}
      {isGeneratingToc && (
        <Modal transparent animationType="none" statusBarTranslucent visible={isGeneratingToc}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <ActivityIndicator size="large" color="#000000" style={{ marginBottom: 12 }} />
              <Text style={[styles.modalTitle, { marginBottom: 0, textAlign: 'center' }]}>
                Generating ToC…
              </Text>
              <Text style={{ textAlign: 'center', color: '#666', marginTop: 6 }}>
                Scanning headings — this can take a moment.
              </Text>
            </View>
          </View>
        </Modal>
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
  navTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#f5f5f5',
    marginBottom: 8,
  },
  navTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRightWidth: 1,
    borderColor: '#cccccc',
  },
  navTabActive: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 3,
    borderBottomColor: '#000000',
  },
  navTabText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666666',
  },
  navTabTextActive: {
    color: '#000000',
  },
  tabViewContainer: {
    flex: 1,
    paddingVertical: 4,
  },
  tocCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  tocTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
    flex: 1,
  },
  tocPage: {
    fontSize: 14,
    color: '#666666',
    marginRight: 12,
  },
  jumpButton: {
    borderWidth: 1,
    borderColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f0f0f0',
  },
  jumpButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  editButton: {
    borderWidth: 1,
    borderColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    padding: 10,
    fontSize: 16,
    color: '#000000',
    backgroundColor: '#ffffff',
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalBtnClear: {
    backgroundColor: '#f5f5f5',
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#000000',
  },
  modalBtnCancel: {
    backgroundColor: '#f5f5f5',
  },
  modalBtnCancelText: {
    color: '#000000',
    fontWeight: 'bold',
  },
  modalBtnSave: {
    backgroundColor: '#000000',
  },
  modalBtnSaveText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  indexCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  indexWordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  indexWord: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  indexPages: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },
});
