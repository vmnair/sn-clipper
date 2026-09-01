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
import { IndexService, HeadingItem } from './services/IndexService';
import { PermissionService, FILE_READ, FILE_WRITE } from './services/PermissionService';
import { ClipList } from './components/ClipList';
import { deriveArticleName, isDocFile, isNoteFile as checkIsNoteFile } from './utils/paths';
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
  const [isCropping, setIsCropping] = useState<boolean>(() => {
    const shot = ClipService.getPendingCropShot();
    return !!shot && (Date.now() - shot.ts < 60000);
  });
  const [cropLoading, setCropLoading] = useState(false);
  const [cropPagePath, setCropPagePath] = useState<string | null>(() => {
    const shot = ClipService.getPendingCropShot();
    return shot && (Date.now() - shot.ts < 60000) ? shot.path : null;
  });
  const [cropImageSize, setCropImageSize] = useState<{ width: number; height: number }>(() => {
    const shot = ClipService.getPendingCropShot();
    return shot && (Date.now() - shot.ts < 60000)
      ? { width: shot.width, height: shot.height }
      : { width: 1404, height: 1872 };
  });

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

  // Tab State: 'clips' | 'toc'
  const [activeTab, setActiveTab] = useState<'clips' | 'toc'>('clips');
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [isGeneratingToc, setIsGeneratingToc] = useState(false);
  const [tocPhase, setTocPhase] = useState<'scanning' | 'recognizing'>('scanning');
  const [tocUpdatedAt, setTocUpdatedAt] = useState<number | null>(null);

  const [editingHeading, setEditingHeading] = useState<HeadingItem | null>(null);
  const [editTitleInput, setEditTitleInput] = useState<string>('');

  // If the active tab gets disabled in Settings, fall back to the Clips tab so its content
  // doesn't linger on screen after the feature is turned off.
  useEffect(() => {
    if (activeTab === 'toc' && !enableToc) setActiveTab('clips');
  }, [enableToc, activeTab]);

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
  const [onCancelCallback, setOnCancelCallback] = useState<{ fn: () => void } | null>(null);

  const askUserConfirmation = (
    title: string,
    description: string,
    confirmLabel = 'OK',
    cancelLabel?: string,
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmTitle(title);
      setConfirmDescription(description);
      setConfirmConfirmLabel(confirmLabel);
      setConfirmCancelLabel(cancelLabel || '');
      setOnConfirmCallback({
        fn: () => {
          setShowConfirmDialog(false);
          resolve(true);
        },
      });
      setOnCancelCallback({
        fn: () => {
          setShowConfirmDialog(false);
          resolve(false);
        },
      });
      setShowConfirmDialog(true);
    });
  };

  // True while a launch-mode 'prompt' dialog is active for this launch. Guards against a
  // follow-up context check (e.g. AppState 'active') reading the already-consumed 'normal'
  // launch mode and dismissing the just-shown prompt (the flash-then-disappear regression).
  const promptActiveRef = useRef(false);
  // True while a launch-mode 'crop' session is active for this launch. Guards against a
  // follow-up context check (e.g. AppState 'active') reading the already-consumed 'normal'
  // launch mode and dismissing the active crop screen.
  const cropActiveRef = useRef(false);

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

        // Fallback for the background Clip button (index.js, showType:0): the host could not
        // show its permission dialog without a foreground UI, so index.js opened Clipper in
        // 'permission' mode. Re-request here — where there IS a UI — and, once granted,
        // finish the clip the user asked for. Mirrors the index.js word-count routing.
        if (launchMode === 'permission') {
          await ClipService.setLaunchMode('normal');
          cropActiveRef.current = false;
          setIsCropping(false);
          setContextResolved(true);

          const outcome = await PermissionService.ensure(
            FILE_READ,
            'Clipper needs read access to capture the text you selected.',
          );
          if (outcome !== 'granted') {
            ToastAndroid.show(
              outcome === 'blocked'
                ? PermissionService.blockedMessage('Clipping')
                : 'Clipper needs permission to clip',
              ToastAndroid.LONG,
            );
            PluginManager.closePluginView();
            return;
          }

          const selRes = await PluginDocAPI.getLastSelectedText() as any;
          const selected = (selRes && selRes.success && selRes.result) ? selRes.result : '';
          if (!selected || selected.trim().length === 0) {
            ToastAndroid.show('Nothing selected to clip.', ToastAndroid.SHORT);
            PluginManager.closePluginView();
            return;
          }

          let articleName = 'Unknown Document';
          let documentPath: string | undefined;
          let documentPage: number | undefined;
          try {
            const fRes = await PluginCommAPI.getCurrentFilePath();
            if (fRes.success && fRes.result) {
              documentPath = fRes.result;
              articleName = deriveArticleName(documentPath);
            }
            const pRes = await PluginCommAPI.getCurrentPageNum();
            if (pRes.success && pRes.result !== undefined && pRes.result !== null) {
              documentPage = pRes.result;
            }
          } catch (metaErr) {
            console.error('Failed to get current file metadata:', metaErr);
          }

          const words = selected.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
          if (words.length > 5) {
            await ClipService.addClip(selected, articleName, documentPath, documentPage);
            ToastAndroid.show('Clipped as Text!', ToastAndroid.SHORT);
            PluginManager.closePluginView();
          } else {
            // Short selection — same "text or image?" prompt the background handler uses.
            setCurrentFilePath(documentPath ?? null);
            if (documentPath) setIsNoteFile(!isDocFile(documentPath));
            setCurrentPageNum(documentPage ?? 0);
            setPromptText(selected);
            promptActiveRef.current = true;
            setShowPromptDialog(true);
          }
          return;
        }

        if (launchMode === 'prompt') {
          await ClipService.setLaunchMode('normal');
          cropActiveRef.current = false;
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

        if (launchMode === 'crop') {
          await ClipService.setLaunchMode('normal');
          cropActiveRef.current = true;
          setIsCropping(true);
          setCropLoading(true);

          let filePath: string | undefined;
          let pageNum = 0;
          try {
            const fileRes = await PluginCommAPI.getCurrentFilePath();
            if (fileRes && fileRes.success && fileRes.result) {
              filePath = fileRes.result;
              setCurrentFilePath(filePath);
              setIsNoteFile(!isDocFile(filePath));
            }
            const pageRes = await PluginCommAPI.getCurrentPageNum();
            if (pageRes && pageRes.success && pageRes.result !== undefined && pageRes.result !== null) {
              pageNum = pageRes.result;
              setCurrentPageNum(pageNum);
            }
          } catch (e) {
            console.warn('Metadata query in crop failed:', e);
          }

          const targetFile = filePath || currentFilePath;
          const isNote = targetFile ? checkIsNoteFile(targetFile) : false;

          let bgShot: any = null;
          if (!isNote) {
            // Check for background screenshot from index.js for DOC files
            bgShot = ClipService.getPendingCropShot();
            if (bgShot && (Date.now() - bgShot.ts < 60000)) {
              setCropPagePath(bgShot.path);
              setCropImageSize({ width: bgShot.width, height: bgShot.height });
              setCropLoading(false);
            }
          } else {
            ClipService.clearPendingCropShot();
          }

          setContextResolved(true);
          if (!bgShot) {
            await handleStartCropping(targetFile, pageNum);
          }
          return;
        }

        // The 'prompt', 'permission', and 'crop' modes have already returned above, so here
        // launchMode is 'normal'. Clear stale prompt state — but NOT when a prompt
        // is active for this launch: a follow-up check (AppState 'active') sees the already-
        // consumed 'normal' mode and would otherwise dismiss the just-shown prompt.
        if (!promptActiveRef.current) {
          setShowPromptDialog(false);
          setPromptText('');
        }

        if (!cropActiveRef.current) {
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

    let subscription: any = null;
    if (DeviceEventEmitter && typeof DeviceEventEmitter.addListener === 'function') {
      subscription = DeviceEventEmitter.addListener('onLaunchModeChange', (mode: string) => {
        if (mode === 'crop') {
          cropActiveRef.current = true;
          const bgShot = ClipService.getPendingCropShot();
          if (bgShot && (Date.now() - bgShot.ts < 60000)) {
            setCropPagePath(bgShot.path);
            setCropImageSize({ width: bgShot.width, height: bgShot.height });
            setCropLoading(false);
            setIsCropping(true);
          }
          checkContext();
        } else if (mode === 'prompt') {
          checkContext();
        }
      });
    }

    return () => {
      unsubscribe();
      appStateSub.remove();
      if (subscription) {
        subscription.remove();
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

  // -------------------------------------------------------------
  // Permission gates (host plugin permission system)
  // -------------------------------------------------------------
  // Gate at the user-action level, not per API call: one prompt per thing the user asked
  // for. Grants are never cached — "allow this time only" is revoked when the plugin exits,
  // so every action re-checks (hasPermission is cheap).

  /** Returns true when the action may proceed; otherwise the user has already been told why not. */
  const ensurePermissions = async (
    action: string,
    requests: Array<{ permission: string; desc: string }>,
  ): Promise<boolean> => {
    const outcome = await PermissionService.ensureAll(requests);
    if (outcome === 'granted') return true;

    if (outcome === 'blocked') {
      // "Don't allow" — re-requesting only produces a go-to-Settings dialog, so say so in a
      // blocking dialog rather than a toast the user can miss.
      setConfirmTitle('File access needed');
      setConfirmDescription(PermissionService.blockedMessage(action));
      setConfirmConfirmLabel('OK');
      setConfirmCancelLabel('');
      setOnConfirmCallback({ fn: () => setShowConfirmDialog(false) });
      setShowConfirmDialog(true);
    } else {
      // Dismissed, or the dialog could not be shown — retrying is worthwhile.
      ToastAndroid.show(`${action} needs file access — tap again to allow.`, ToastAndroid.LONG);
    }
    return false;
  };

  /**
   * Turn a 1501/1503/1500/1502/1217 failure into a clear message. Returns true when the error
   * was a permission problem (and has been reported), false for ordinary failures so callers
   * can fall back to their own error text.
   */
  const reportPermissionError = (e: any): boolean => {
    const msg = PermissionService.messageForError(e);
    if (!msg) return false;
    ToastAndroid.show(msg, ToastAndroid.LONG);
    return true;
  };

  const handleOpenSource = async (clip: ClipItem, element: ClipSubElement, elementIndex: number) => {
    if (!element.documentPath) return;

    // Jump-to-Source stats the source file in shared storage and re-opens it in the reader —
    // both are FILE:READ operations under the host permission system.
    const allowed = await ensurePermissions('Opening the source document', [
      { permission: FILE_READ, desc: 'Clipper needs read access to reopen the document this clip came from.' },
    ]);
    if (!allowed) return;

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

      const { PluginFileAPI } = require('sn-plugin-lib');
      try {
        const encRes = await PluginFileAPI.getPathEncryptionStatus(element.documentPath) as any;
        if (encRes && encRes.success && encRes.result === 1) {
          ToastAndroid.show('This file is locked with a password.', ToastAndroid.LONG);
          return;
        }
      } catch (e) { /* best-effort */ }
      const openRes: any = await PluginFileAPI.openFile(element.documentPath, element.documentPage ?? 0);
      if (openRes && openRes.success === false) {
        if (PermissionService.isPermissionError(openRes)) {
          if (!reportPermissionError(openRes)) {
            ToastAndroid.show(`Failed to open source document: ${openRes.error?.message || 'Permission denied'}`, ToastAndroid.SHORT);
          }
        } else {
          ToastAndroid.show('Could not open the source document (it may have been moved or deleted)', ToastAndroid.LONG);
        }
        return;
      }
      PluginManager.closePluginView();
    } catch (err: any) {
      if (!reportPermissionError(err)) {
        ToastAndroid.show(`Failed to open source document: ${err.message}`, ToastAndroid.SHORT);
      }
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
  const handleStartCropping = async (targetPath?: string, targetPage?: number) => {
    const file = targetPath || currentFilePath;
    const pg = targetPage !== undefined ? targetPage : currentPageNum;
    const isNote = file ? checkIsNoteFile(file) : (currentFilePath ? checkIsNoteFile(currentFilePath) : false);

    // 1. Consume the fresh reader screenshot captured in background by index.js ONLY for DOC files
    if (!isNote) {
      const bgShot = ClipService.getPendingCropShot();
      if (bgShot && (Date.now() - bgShot.ts < 60000)) {
        setCropPagePath(bgShot.path);
        setCropImageSize({ width: bgShot.width, height: bgShot.height });
        setCropLoading(false);
        cropActiveRef.current = true;
        setIsCropping(true);
        return;
      }
    } else {
      ClipService.clearPendingCropShot();
    }

    // 2. Primary for NOTE files (or Fallback for DOC): file-based render if no live screenshot is available
    if (!file) {
      ToastAndroid.show('No active document to crop.', ToastAndroid.SHORT);
      cropActiveRef.current = false;
      setIsCropping(false);
      return;
    }

    // Rendering the page to crop from (generateNotePng / generateCurrentDocImage, plus
    // getPageSize) reads the user's document, so gate on FILE:READ. The crop itself and the
    // saved PNG live in the plugin's private dir, which is exempt.
    const allowed = await ensurePermissions('Region capture', [
      { permission: FILE_READ, desc: 'Clipper needs read access to render the page you are cropping.' },
    ]);
    if (!allowed) {
      cropActiveRef.current = false;
      setIsCropping(false);
      return;
    }

    cropActiveRef.current = true;
    setIsCropping(true);
    setCropLoading(true);

    // Drop any capture left over from a previous aborted session before making a new one.
    if (cropPagePath) {
      const { FileUtils } = require('sn-plugin-lib');
      FileUtils.deleteFile(cropPagePath).catch(() => {});
    }

    try {
      const { PluginFileAPI, PluginDocAPI, PluginNoteAPI } = require('sn-plugin-lib');
      const pluginDir = await PluginManager.getPluginDirPath();
      if (!pluginDir) {
        ToastAndroid.show('Storage error: Cannot access plugin folder.', ToastAndroid.SHORT);
        cropActiveRef.current = false;
        setIsCropping(false);
        setCropLoading(false);
        return;
      }

      const tempPath = `${pluginDir}/temp_crop_page_${Date.now()}.png`;

      // Fetch the page size once and reuse it for both the capture and the crop scaling.
      let pageSize = { width: 1404, height: 1872 };
      const sizeRes = await PluginFileAPI.getPageSize(file, pg);
      if (sizeRes.success && sizeRes.result) {
        pageSize = sizeRes.result;
      }

      let success = false;
      // Keep the failing response around: a permission failure carries code 1503 and deserves
      // a different message from a genuine render failure.
      let genRes: any = null;
      if (isNote) {
        // generateLayerPreviewImage renders only the handwriting/element layer, without the
        // page's background template (ruled lines, dot grid). generateNotePng bakes the
        // template into the PNG regardless of its `type` param on this firmware (confirmed
        // on-device: type:0 "transparent background" still produced ruled lines) — see
        // design_instance/current_status.md.
        genRes = await PluginNoteAPI.generateLayerPreviewImage(file, pg, 0, tempPath) as any;
        success = genRes && genRes.success;
        if (!success) {
          genRes = await PluginFileAPI.generateNotePng({
            notePath: file,
            page: pg,
            times: 1,
            pngPath: tempPath,
            type: 0,
          });
          success = genRes && genRes.success;
        }
      } else {
        // sn-plugin-lib 0.1.65 replaced generateDocImage(docPath, page, pngPath, size) with
        // generateCurrentDocImage(page, pngPath, size, type) — it always renders the CURRENTLY
        // open document, which is exactly what the crop flow captures. type 0 = plain page
        // (type 1 bakes in text-selection highlight/underline styling, which we don't want in
        // a cropped region).
        genRes = await PluginDocAPI.generateCurrentDocImage(
          pg,
          tempPath,
          { width: Math.round(pageSize.width), height: Math.round(pageSize.height) },
          0
        );
        success = genRes && genRes.success;
      }

      if (success) {
        setCropPagePath(tempPath);
        setCropImageSize(pageSize);
        setCropLoading(false);
      } else {
        if (!reportPermissionError(genRes)) {
          ToastAndroid.show('Capture failed: Failed to screenshot page.', ToastAndroid.SHORT);
        }
        cropActiveRef.current = false;
        setIsCropping(false);
        setCropLoading(false);
      }
    } catch (err: any) {
      if (!reportPermissionError(err)) {
        ToastAndroid.show(`Capture error: ${err.message}`, ToastAndroid.SHORT);
      }
      cropActiveRef.current = false;
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
        cropActiveRef.current = false;
        setIsCropping(false);
        ClipService.clearPendingCropShot();
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
    cropActiveRef.current = false;
    setIsCropping(false);
    ClipService.clearPendingCropShot();
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
    // Claim the guard BEFORE the first await: the permission gate below is async, and two
    // quick taps would otherwise both get past this check and insert twice.
    insertingRef.current = true;
    setIsInserting(true);

    // Insert always reads the page layout (getElements/getPageSize are both FILE:READ-gated
    // in the host), but WRITE is only needed for image clips.
    //
    // Verified against the host's own enforcement (HostCommImpl.checkFileWritePermission):
    // the note-editing APIs that act on the CURRENTLY OPEN file — insertText, insertTextLink,
    // insertImage, saveCurrentNote — carry no permission check at all. Only APIs that take a
    // file path are gated, and the one this flow uses is modifyElements(notePath, ...), called
    // solely to reposition an image after insertImage. So a text-only insert that asked for
    // WRITE would prompt for a permission it never uses, and would refuse to run for anyone
    // who denied it.
    const needsWrite = clipsToInsert.some(clipHasImage);
    const requests = [
      { permission: FILE_READ, desc: 'Clipper needs read access to lay out clips on the current note page.' },
    ];
    if (needsWrite) {
      requests.push({ permission: FILE_WRITE, desc: 'Clipper needs write access to place images in your note.' });
    }
    const allowed = await ensurePermissions('Inserting clips', requests);
    if (!allowed) {
      insertingRef.current = false;
      setIsInserting(false);
      return;
    }
    try {
      const { PluginCommAPI, PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');
      
      const fileRes = await PluginCommAPI.getCurrentFilePath();
      if (!fileRes.success || !fileRes.result) {
        ToastAndroid.show('Insert failed: No active file.', ToastAndroid.SHORT);
        return;
      }
      const notePath = fileRes.result;
      const pageRes = await PluginCommAPI.getCurrentPageNum();
      let currentPage = (pageRes.success && pageRes.result !== undefined && pageRes.result !== null) ? pageRes.result : 0;

      let totalPages = 1;
      try {
        const totRes = await PluginFileAPI.getNoteTotalPageNum(notePath) as any;
        if (totRes && totRes.success && typeof totRes.result === 'number') {
          totalPages = totRes.result;
        }
      } catch (e) { /* fallback */ }
      let currentTotalPages = Math.max(totalPages, currentPage + 1);

      // Read settings FRESH from storage
      const autoRemove = await StorageService.getAutoRemoveInserted();
      const combine = await StorageService.getCombineInserted();
      const linkSource = await StorageService.getInsertSourceLink();

      await PluginNoteAPI.saveCurrentNote();

      const fontSize = insertFontSize;
      const lineHeight = Math.round(fontSize * 1.2);
      const gap = Math.round(lineHeight * 0.6);
      const imageLeftInset = Math.round(fontSize * 0.6);
      const MIN_SPLIT_LINES = 3;

      // Flatten clips into an ordered list of element "items", tagging each with its clip id
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

      const fontSizeLink = Math.round(fontSize * 0.8);
      const linkHeight = Math.round(fontSizeLink * 1.35);
      const linkSpace = linkHeight + gap;
      const linkGap = Math.round(lineHeight * 0.2);
      const JUMP_ICON = '↗';
      const iconWidth = Math.round(fontSizeLink * 1.4);
      const charWidthPx = fontSize * 0.5;

      const { FileUtils } = require('sn-plugin-lib');

      const performInsertJumpIcon = async (destPath: string, destPage: number, topY: number, rightMargin: number) => {
        const linkType = destPath.endsWith('.note') || destPath.endsWith('.not')
          ? (destPage !== undefined ? 0 : 1)
          : 2;
        await PluginNoteAPI.insertTextLink({
          destPath,
          destPage: destPage || 0,
          style: 0,
          linkType,
          rect: { left: rightMargin - iconWidth, top: topY, right: rightMargin, bottom: topY + linkHeight },
          fontSize: fontSizeLink,
          fullText: JUMP_ICON,
          showText: JUMP_ICON,
          isItalic: 0,
        });
      };

      const performInsertLabeledLink = async (destPath: string, destPage: number, articleNameStr: string, topY: number, maxW: number) => {
        const pageNum = destPage !== undefined ? destPage + 1 : 1;
        const cleanName = (articleNameStr || 'Unknown Document').replace(/\.[^/.]+$/, '');
        const shortenedName = cleanName.length > 24 ? cleanName.substring(0, 23) + '…' : cleanName;
        const labelText = `[${shortenedName}, p. ${pageNum} ↗]`;
        const linkType = destPath.endsWith('.note') || destPath.endsWith('.not')
          ? (destPage !== undefined ? 0 : 1)
          : 2;
        await PluginNoteAPI.insertTextLink({
          destPath,
          destPage: destPage || 0,
          style: 0,
          linkType,
          rect: { left: 100, top: topY, right: 100 + maxW, bottom: topY + linkHeight },
          fontSize: fontSizeLink,
          fullText: labelText,
          showText: labelText,
          isItalic: 0,
        });
      };

      const placeJumpIconForBlock = async (
        boxTop: number,
        lines: number,
        lastLineChars: number,
        links: { path: string; page: number }[],
        maxW: number,
      ): Promise<number> => {
        const contentBottom = boxTop + lines * lineHeight;
        const [primary, ...rest] = links;
        const lastLineTop = boxTop + (lines - 1) * lineHeight;
        const lastWordRight = 100 + Math.round(lastLineChars * charWidthPx);
        const iconLeft = (100 + maxW) - iconWidth;
        const rightMargin = 100 + maxW;
        const fitsInline = lastWordRight + Math.round(charWidthPx) <= iconLeft;
        let y: number;
        if (fitsInline) {
          await performInsertJumpIcon(primary.path, primary.page, lastLineTop + Math.round((lineHeight - linkHeight) / 2), rightMargin);
          y = contentBottom;
        } else {
          const iconTop = contentBottom + linkGap;
          await performInsertJumpIcon(primary.path, primary.page, iconTop, rightMargin);
          y = iconTop + linkHeight;
        }
        for (const link of rest) {
          const iconTop = y + linkGap;
          await performInsertJumpIcon(link.path, link.page, iconTop, rightMargin);
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
              } catch (e) {}
            }
          }
        }
        return Array.from(uniqueLinksMap.values());
      };

      const getImageDimensions = (imagePath: string): Promise<{ width: number; height: number }> => {
        return new Promise((resolve) => {
          const uri = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
          Image.getSize(
            uri,
            (width, height) => resolve({ width, height }),
            () => resolve({ width: 0, height: 0 })
          );
        });
      };

      const getElemBottom = (el: any, pageHeight: number): number => {
        if (!el) return 0;
        if (el.status === -1 || el.status === 2) return 0; // Skip explicitly deleted elements

        let bottom = 0;

        // 1. Text boxes (500, 501, 502)
        if (el.textBox && el.textBox.textRect && typeof el.textBox.textRect.bottom === 'number') {
          bottom = Math.max(bottom, el.textBox.textRect.bottom);
        }
        if (el.textRect && typeof el.textRect.bottom === 'number') {
          bottom = Math.max(bottom, el.textRect.bottom);
        }

        // 2. Pictures (200)
        if (el.picture && el.picture.rect && typeof el.picture.rect.bottom === 'number') {
          bottom = Math.max(bottom, el.picture.rect.bottom);
        }

        // 3. Titles (100)
        if (el.title) {
          bottom = Math.max(bottom, (el.title.Y || 0) + (el.title.height || 0));
        }

        // 4. Links (600)
        if (el.link) {
          bottom = Math.max(bottom, (el.link.Y || 0) + (el.link.height || 0));
        }

        // 5. Recognition bounds (handwriting strokes & recognized titles)
        const rr = el.recognizeResult;
        if (rr && typeof rr.down_right_point_y === 'number' && rr.down_right_point_y > 0) {
          if (rr.down_right_point_y <= pageHeight - 120) {
            bottom = Math.max(bottom, rr.down_right_point_y);
          }
        }

        // 6. Direct maxY (strokes & geometries)
        if (typeof el.maxY === 'number' && el.maxY > 0 && el.maxY <= pageHeight - 120) {
          bottom = Math.max(bottom, el.maxY);
        }

        // 7. General Y + height fallback
        if (typeof el.Y === 'number' && typeof el.height === 'number' && el.height > 0) {
          const yBottom = el.Y + el.height;
          if (yBottom <= pageHeight - 120) {
            bottom = Math.max(bottom, yBottom);
          }
        }

        return bottom;
      };

      const pollForTargetPage = async (targetPage: number, timeoutMs = 4000): Promise<boolean> => {
        const start = Date.now();
        let lastJumpTime = 0;
        while (Date.now() - start < timeoutMs) {
          try {
            const pageRes = await PluginCommAPI.getCurrentPageNum() as any;
            if (pageRes && pageRes.success && pageRes.result === targetPage) {
              await new Promise(r => setTimeout(r, 200)); // 200ms stabilization buffer
              return true;
            }
          } catch (e) {}

          // Active retry: re-issue jumpToPage if target page not reached after 400ms
          if (Date.now() - lastJumpTime > 500) {
            try {
              await PluginCommAPI.jumpToPage(targetPage);
              lastJumpTime = Date.now();
            } catch (e) {}
          }

          await new Promise(r => setTimeout(r, 150));
        }
        return false;
      };

      const insertPositionedImage = async (
        imagePath: string,
        top: number,
        maxW: number,
        maxH: number,
        targetPage: number,
      ): Promise<number | null> => {
        const attemptInsert = async (): Promise<{ success: boolean; targetH?: number; misdropped?: boolean; misdropNum?: number }> => {
          await PluginNoteAPI.insertImage(imagePath);
          await PluginNoteAPI.saveCurrentNote();
          try {
            const lastRes = await PluginFileAPI.getLastElement() as any;
            const el = (lastRes && lastRes.result) ? lastRes.result : null;
            if (el && el.type === 200 && el.picture && el.picture.rect) {
              // Verify it landed on the intended target page
              if (el.pageNum !== undefined && el.pageNum !== targetPage) {
                return { success: false, misdropped: true, misdropNum: el.numInPage };
              }
              const r = el.picture.rect;
              const natW = r.right - r.left, natH = r.bottom - r.top;
              if (natW <= 0 || natH <= 0) return { success: false };
              const scale = Math.min(maxW / natW, maxH / natH, 1);
              const targetW = Math.max(1, Math.round(natW * scale));
              const targetH = Math.max(1, Math.round(natH * scale));
              const picturePath = el.picture.picturePath;
              if (picturePath && !(await FileUtils.exists(picturePath))) {
                try { await FileUtils.copyFile(imagePath, picturePath); } catch (e) { /* fall through */ }
              }
              const imgLeft = 100 + imageLeftInset;
              const modified = {
                ...el, pageNum: targetPage, layerNum: 0,
                picture: { ...el.picture, rect: { left: imgLeft, top, right: imgLeft + targetW, bottom: top + targetH } },
              };
              const modRes = await PluginFileAPI.modifyElements(notePath, targetPage, [modified]) as any;
              if (modRes && modRes.success === false && PermissionService.isPermissionError(modRes)) {
                reportPermissionError(modRes);
                return { success: false };
              }
              await PluginNoteAPI.saveCurrentNote();
              return (modRes && modRes.success) ? { success: true, targetH } : { success: false };
            }
          } catch (e: any) {
            if (PermissionService.isPermissionError(e)) {
              reportPermissionError(e);
            }
          }
          return { success: false };
        };

        // Try insert once
        let res = await attemptInsert();
        if (!res.success && res.misdropped) {
          // Clean up misdropped element if we have its num
          if (res.misdropNum) {
            try {
              const curPgRes = await PluginCommAPI.getCurrentPageNum() as any;
              const actualPg = (curPgRes && curPgRes.success) ? curPgRes.result : (targetPage > 0 ? targetPage - 1 : 0);
              await PluginFileAPI.deleteElements(notePath, actualPg, [res.misdropNum]);
              await PluginNoteAPI.saveCurrentNote();
            } catch (delErr) {}
          }
          // Re-verify and re-jump to target page
          await PluginCommAPI.jumpToPage(targetPage);
          await pollForTargetPage(targetPage, 2000);
          // Retry once
          res = await attemptInsert();
        }

        return (res.success && res.targetH !== undefined) ? res.targetH : null;
      };

      let i = 0;
      const insertedCountByClip: Record<string, number> = {};
      const splitRemainder: Record<string, string> = {};
      let attemptedInserts = 0;
      let pageBudget = 20; // Bounded loop max 20 pages
      let stoppedEarlyOutOfSpace = false;

      while (i < items.length && pageBudget > 0) {
        pageBudget--;

        let pageWidth = 1404;
        let pageHeight = 1872;
        try {
          const sizeRes = await PluginFileAPI.getPageSize(notePath, currentPage) as any;
          if (sizeRes && sizeRes.success && sizeRes.result) {
            pageWidth = sizeRes.result.width;
            pageHeight = sizeRes.result.height;
          }
        } catch (e) {}

        const maxWidth = pageWidth - 200;
        const charsPerLine = Math.max(1, Math.floor(maxWidth / (fontSize * 0.5)));
        const estimateTextLines = (t: string) => countWrappedLines(t, charsPerLine);
        const estimateTextHeight = (linesCount: number) => linesCount * lineHeight;
        const boxDescenderPad = Math.round(lineHeight * 0.35);

        const insertTextBox = async (content: string, top: number, height: number) => {
          await PluginNoteAPI.insertText({
            textContentFull: content,
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

        let currentY = 100;
        const beforeIds = new Set<string>();
        let existingImageCount = 0;

        const elementsRes = await PluginFileAPI.getElements(currentPage, notePath) as any;
        if (elementsRes && elementsRes.success && Array.isArray(elementsRes.result)) {
          for (const el of elementsRes.result) {
            if (el.uuid) beforeIds.add(el.uuid);
            if (el.type === 200) existingImageCount++;
            const elBottom = getElemBottom(el, pageHeight);
            if (elBottom > currentY && elBottom <= pageHeight) {
              currentY = elBottom;
            }
          }
        }
        if (currentY > 100) {
          currentY += gap;
        }

        let pageHasContent = currentY > 100 || existingImageCount > 0;

        while (i < items.length) {
          const item = items[i];

          if (item.type === 'image') {
            if (!item.imagePath) {
              insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;
              i++;
              continue;
            }

            // 8b: Upfront real image dimension reading
            let imgW = item.width || 0;
            let imgH = item.height || 0;
            if (!imgW || !imgH) {
              const dims = await getImageDimensions(item.imagePath);
              if (dims.width > 0 && dims.height > 0) {
                imgW = dims.width;
                imgH = dims.height;
              }
            }

            const availHeight = (pageHeight - gap) - currentY;
            const fullPageAvail = (pageHeight - gap) - 100;
            const maxW = maxWidth - imageLeftInset;

            const targetW = imgW > 0 ? Math.min(maxW, imgW) : maxW;
            const targetH = imgH > 0 && imgW > 0 ? Math.round(imgH * (targetW / imgW)) : 400;
            const linkReserve = (item.documentPath && linkSource) ? linkSpace : 0;
            const requiredHeight = targetH + linkReserve;

            // If page already has content and requiredHeight doesn't fit in remaining space:
            // defer immediately to next page (no guessFitH squeezing!)
            if (pageHasContent && requiredHeight > availHeight) {
              break; // move to next page
            }

            // If on a fresh page, scale down to fit full page if necessary
            const maxH = Math.max(1, (pageHasContent ? availHeight : fullPageAvail) - linkReserve);
            const top = currentY;
            const placedH = await insertPositionedImage(item.imagePath, top, maxW, maxH, currentPage);
            attemptedInserts++;
            insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;
            pageHasContent = true;
            await new Promise(r => setTimeout(r, 200));
            i++;
            if (placedH === null) {
              break;
            }
            currentY = top + placedH;
            if (item.documentPath && linkSource) {
              const validLinks = await getValidLinksForGroup([item]);
              if (validLinks.length > 0) {
                const iconTop = currentY + linkGap;
                await performInsertJumpIcon(validLinks[0].path, validLinks[0].page, iconTop, 100 + maxWidth);
                currentY = iconTop + linkHeight;
              }
            }
            currentY += gap;
            continue;
          }

          if (!item.text || !item.text.trim()) {
            insertedCountByClip[item.clipId] = (insertedCountByClip[item.clipId] || 0) + 1;
            i++;
            continue;
          }

          const availHeight = (pageHeight - gap) - currentY;

          if (combine) {
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
                if (totalBlockHeight > availHeight) break;
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
              group.forEach((g) => {
                insertedCountByClip[g.clipId] = (insertedCountByClip[g.clipId] || 0) + 1;
                // This item may be a previously-split element whose leftover tail just got
                // fully absorbed into this combined box — clear it so a stale remainder can't
                // leak onto a later, unrelated element of the same (merged) clip.
                delete splitRemainder[g.clipId];
              });

              const validLinks = linkSource ? await getValidLinksForGroup(group) : [];
              if (validLinks.length > 0) {
                let ny = currentY + groupHeight + linkGap;
                for (const link of validLinks) {
                  await performInsertLabeledLink(link.path, link.page, link.articleName, ny, maxWidth);
                  ny += linkSpace;
                }
                currentY = ny;
              } else {
                currentY = currentY + groupHeight + gap;
              }
              pageHasContent = true;
              i = j;
              await new Promise(r => setTimeout(r, 200));
              break;
            }
          }

          // Single text item
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
            // This item may be a previously-split element (item.text was reduced to its
            // leftover tail on an earlier page) now fully placed here — clear its stale
            // remainder so it can't leak onto a later, unrelated element of the same clip.
            delete splitRemainder[item.clipId];

            let linksInserted = false;
            if (item.documentPath && linkSource) {
              const validLinks = await getValidLinksForGroup([item]);
              if (validLinks.length > 0) {
                currentY = await placeJumpIconForBlock(currentY, estLines, wrap.lastLineChars, validLinks, maxWidth);
                linksInserted = true;
              }
            }
            if (!linksInserted) currentY = currentY + estH + gap;
            pageHasContent = true;
            i++;
            await new Promise(r => setTimeout(r, 200));
            if (combine) break;
            continue;
          } else {
            const fullPageAvail = (pageHeight - gap) - 100;
            if (!autoRemove && totalSingleHeight <= fullPageAvail) {
              break; // Defer whole clip to next page
            }
            const linesThatFit = Math.floor((availHeight - (item.documentPath ? linkSpace : 0)) / lineHeight);
            if (linesThatFit < MIN_SPLIT_LINES) {
              break; // Defer to fresh page
            }
            const charBudget = Math.floor(linesThatFit * charsPerLine * 0.9);
            const [chunk, remainder] = splitTextToFit(t, charBudget);
            if (!chunk) {
              break;
            }
            const chunkWrap = measureWrappedText(chunk, charsPerLine);
            const chunkH = chunkWrap.lines * lineHeight;
            await insertTextBox(chunk, currentY, chunkH);
            attemptedInserts++;
            if (remainder) {
              item.text = remainder;
              splitRemainder[item.clipId] = remainder;
            }

            if (item.documentPath && linkSource) {
              const validLinks = await getValidLinksForGroup([item]);
              if (validLinks.length > 0) {
                currentY = await placeJumpIconForBlock(currentY, chunkWrap.lines, chunkWrap.lastLineChars, validLinks, maxWidth);
              } else {
                currentY = currentY + chunkH + gap;
              }
            } else {
              currentY = currentY + chunkH + gap;
            }
            await PluginNoteAPI.saveCurrentNote();
            await new Promise(r => setTimeout(r, 200));
            break;
          }
        }

        await PluginNoteAPI.saveCurrentNote();

        if (i >= items.length) {
          break;
        }

        // Advance to next existing page or notify end of note
        const nextPage = currentPage + 1;
        if (nextPage < currentTotalPages) {
          const jumpRes = await PluginCommAPI.jumpToPage(nextPage) as any;
          if (!jumpRes || jumpRes.success === false) {
            stoppedEarlyOutOfSpace = true;
            break;
          }
          const settled = await pollForTargetPage(nextPage, 3000);
          if (!settled) {
            ToastAndroid.show('Turn the page and tap Insert to continue.', ToastAndroid.LONG);
            stoppedEarlyOutOfSpace = true;
            break;
          }
          currentPage = nextPage;
        } else {
          // Re-enable ask-then-create when the host implements insertNotePage; see RATTA_REPORT_insertNotePage.md
          await askUserConfirmation(
            'Page Full',
            'No more room in this note. Add a new page to the note, then reopen Clipper and tap Insert to continue.',
            'OK'
          );
          stoppedEarlyOutOfSpace = true;
          break;
        }
      }

      await PluginNoteAPI.saveCurrentNote();

      if (autoRemove && attemptedInserts > 0) {
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

      if (i < items.length && splitRemainder[items[i]?.clipId]) {
        ToastAndroid.show(
          'Clip too long for one page — inserted part. Turn to a new page, then Insert again to continue.',
          ToastAndroid.LONG
        );
        PluginManager.closePluginView();
      } else if (stoppedEarlyOutOfSpace || i < items.length) {
        // Page Full modal was already acknowledged by the user; close cleanly
        PluginManager.closePluginView();
      } else {
        ToastAndroid.show(
          autoRemove ? 'Clips inserted successfully!' : 'Clips inserted (kept in Clipper)',
          ToastAndroid.SHORT
        );
        PluginManager.closePluginView();
      }
    } catch (e: any) {
      // A grant can expire mid-insert ("allow this time only" dies with the session), which
      // surfaces as 1501/1503 rather than a generic failure — say so, so retrying is obvious.
      if (!reportPermissionError(e)) {
        ToastAndroid.show(`Insert failed: ${e.message}`, ToastAndroid.SHORT);
      }
    } finally {
      insertingRef.current = false;
      setIsInserting(false);
    }
  };

  // Handlers for Table of Contents

  // Build/refresh the ToC on the page the reader is currently on. generateTocPage guards against
  // overwriting: it writes only to a verified-empty current page (inserting a blank first if the
  // current page has content), so nothing is ever written over existing notes.
  const runTocBuild = async () => {
    if (!currentFilePath) {
      ToastAndroid.show('No active note file open', ToastAndroid.SHORT);
      return;
    }

    // Building a ToC scans every page (getElements/getTitles/getPageSize/recognizeElements)
    // and then writes the ToC page (insertText/insertTextLink/replaceElements/deleteElements).
    const allowed = await ensurePermissions('Building the Table of Contents', [
      { permission: FILE_READ, desc: 'Clipper needs read access to scan this note for headings.' },
      { permission: FILE_WRITE, desc: 'Clipper needs write access to write the Table of Contents page.' },
    ]);
    if (!allowed) return;

    setTocPhase('scanning');
    setIsGeneratingToc(true);
    try {
      const res = await IndexService.generateTocPage(currentFilePath, insertFontSize, setTocPhase);

      if (res.success) {
        // The ToC now lives in the note — clear the Clipper snapshot so the ToC tab doesn't keep
        // showing a stale headings list next time Clipper opens.
        await StorageService.clearTocState(currentFilePath);
        setHeadings([]);
        setTocUpdatedAt(null);
        ToastAndroid.show(res.message || 'Table of Contents created!', ToastAndroid.LONG);
        PluginManager.closePluginView();
      } else if (res.needsBlankPage) {
        // Blocking dialog (easy-to-miss toast won't do): the page isn't blank. OK-only.
        setConfirmTitle('Page is not blank!');
        setConfirmDescription(res.message || 'Open or add a blank page, then tap Build ToC.');
        setConfirmConfirmLabel('OK');
        setConfirmCancelLabel('');
        setOnConfirmCallback({ fn: () => setShowConfirmDialog(false) });
        setShowConfirmDialog(true);
      } else {
        if (res.error && reportPermissionError(res.error)) {
          // Permission error handled by reportPermissionError
        } else {
          ToastAndroid.show(res.message || 'Failed to generate ToC page', ToastAndroid.LONG);
        }
      }
    } catch (e: any) {
      if (!reportPermissionError(e)) {
        ToastAndroid.show('Failed to generate ToC page', ToastAndroid.LONG);
      }
    } finally {
      setIsGeneratingToc(false);
    }
  };

  const handleBuildToc = () => { runTocBuild(); };

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
            cropActiveRef.current = true;
            setShowPromptDialog(false);
            const bgShot = ClipService.getPendingCropShot();
            if (bgShot && (Date.now() - bgShot.ts < 60000)) {
              setCropPagePath(bgShot.path);
              setCropImageSize({ width: bgShot.width, height: bgShot.height });
              setCropLoading(false);
              setIsCropping(true);
            } else {
              setIsCropping(true);
              setCropLoading(true);
              handleStartCropping(currentFilePath || undefined, currentPageNum);
            }
            await ClipService.setPromptText('');
          }}
          onClipText={async () => {
            promptActiveRef.current = false;
            setShowPromptDialog(false);
            ClipService.clearPendingCropShot();
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
            ClipService.clearPendingCropShot();
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
                <Image source={require('../assets/icon/close.png')} style={styles.iconImage} />
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
        {enableToc && (
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
                ? `${headings.length} heading(s) found. The ToC is created on the page you're viewing — open a blank page first (it won't overwrite notes).`
                : 'Open the note to a blank page where you want the ToC, then tap "Build ToC". It writes on the current page and never overwrites existing notes.'}
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
                  <View
                    key={h.id || idx}
                    style={[
                      styles.tocCard,
                      h.level && h.level > 1 ? { marginLeft: (h.level - 1) * 16 } : null,
                    ]}
                  >
                    <Text style={styles.tocTitle}>
                      {h.numberLabel ? `${h.numberLabel} ${h.title}` : `${idx + 1}. ${h.title}`}
                    </Text>
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
                  label="📖 Build ToC on current page"
                  onPress={handleBuildToc}
                  disabled={!isNoteFile || isGeneratingToc}
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
        onCancel={() => {
          if (onCancelCallback?.fn) {
            onCancelCallback.fn();
          } else {
            setShowConfirmDialog(false);
          }
        }}
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
                {tocPhase === 'recognizing' ? 'Recognizing handwriting…' : 'Scanning headings…'}
              </Text>
              <Text style={{ textAlign: 'center', color: '#666', marginTop: 6 }}>
                {tocPhase === 'recognizing'
                  ? 'Converting handwritten titles to text — this may take some time.'
                  : 'Reading the note’s titles.'}
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
});
