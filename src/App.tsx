// SnClipper/src/app.tsx
// Vinod Nair

import React, { useEffect, useState, useMemo } from 'react';
import {
  SafeAreaView,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ToastAndroid,
  Pressable,
  TextInput,
  Image,
  AppState,
} from 'react-native';
import { ClipService } from './services/ClipService';
import { ClipItem } from './services/StorageService';
import { PluginManager } from 'sn-plugin-lib';
import { HighContrastButton } from './components/HighContrastButton';
import { CropOverlay } from './components/CropOverlay';

// Derive a human-readable document title from an absolute file path.
const deriveArticleName = (filePath?: string | null): string => {
  if (!filePath) return 'Unknown Document';
  return filePath.substring(filePath.lastIndexOf('/') + 1) || 'Unknown Document';
};

const formatDate = (timestamp?: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const fullMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const month = fullMonths[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  return `${month} ${day}, ${year} ${hours}:${minutesStr} ${ampm}`;
};

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
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [promptText, setPromptText] = useState('');

  useEffect(() => {
    // Sync current list from Storage on open
    ClipService.init().then(() => {
      setClips(ClipService.getClipsSync());
    });

    // Check active file context (Note vs Document)
    const checkContext = async () => {
      try {
        const { PluginCommAPI, PluginFileAPI, PluginDocAPI } = require('sn-plugin-lib');
        
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
            const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
            const isDoc = ['.pdf', '.epub', '.txt', '.cbz', '.fb2'].includes(ext);
            setIsNoteFile(!isDoc);

            let pageNum = 0;
            const pageRes = await PluginCommAPI.getCurrentPageNum();
            if (pageRes.success && pageRes.result !== undefined && pageRes.result !== null) {
              pageNum = pageRes.result;
              setCurrentPageNum(pageNum);
            }
          }
          return;
        }

        if (launchMode !== 'prompt') {
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
          const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
          const isDoc = ['.pdf', '.epub', '.txt', '.cbz', '.fb2'].includes(ext);
          setIsNoteFile(!isDoc);

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
        if (mode === 'prompt') {
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

  const handleMergeSelected = async () => {
    if (selectedIds.length < 2) {
      ToastAndroid.show('Select at least 2 clips to merge!', ToastAndroid.SHORT);
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
    const { PluginManager } = require('sn-plugin-lib');
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

      // 1. Get existing page elements to calculate starting Y coordinate (Append feature)
      let currentY = 100;
      const margin = 30;

      const elementsRes = await PluginFileAPI.getElements(page, notePath) as any;
      if (elementsRes && elementsRes.success && Array.isArray(elementsRes.result)) {
        for (const el of elementsRes.result) {
          if (el.status !== undefined && el.status !== 0) {
            continue;
          }
          let elBottom = 0;
          if (el.type === 500 || el.type === 501 || el.type === 502) { // Text Box types
            if (el.textBox && el.textBox.textRect) {
              elBottom = el.textBox.textRect.bottom;
            }
          } else if (el.type === 200) { // Picture/Image type
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
        currentY += margin;
      }

      const allElements: { type: 'text' | 'image'; text?: string; imagePath?: string }[] = [];
      for (const clip of clipsToInsert) {
        allElements.push(...clip.elements);
      }

      // Helper function to load image size
      const getImgSize = (elem: any) => new Promise<{ width: number; height: number }>((resolve) => {
        if (elem.width && elem.height) {
          resolve({ width: elem.width, height: elem.height });
          return;
        }
        Image.getSize(
          'file://' + elem.imagePath,
          (w, h) => resolve({ width: w, height: h }),
          () => resolve({ width: 600, height: 300 }) // fallback to 2:1 ratio (600 width, 300 height)
        );
      });

      // 2. Pre-calculate total height needed for selected clips
      let totalNeededHeight = 0;
      const elementLayouts: { type: 'text' | 'image'; text?: string; imagePath?: string; width?: number; height?: number; layoutHeight: number }[] = [];

      for (const elem of allElements) {
        if (elem.type === 'text' && elem.text) {
          const charsPerLine = Math.floor((pageWidth - 200) / 24) || 25;
          const lineCount = Math.ceil(elem.text.length / charsPerLine);
          const estimatedHeight = Math.max(100, lineCount * 60 + 20);
          elementLayouts.push({ ...elem, layoutHeight: estimatedHeight });
          totalNeededHeight += estimatedHeight + margin;
        } else if (elem.type === 'image' && elem.imagePath) {
          const { width: imgW, height: imgH } = await getImgSize(elem);
          const targetW = pageWidth - 200;
          const targetH = Math.round(targetW * (imgH / imgW));
          elementLayouts.push({ ...elem, layoutHeight: targetH });
          totalNeededHeight += targetH + margin;
        }
      }

      // 3. Bounds check: warning if selected text/images do not fit (Non-blocking warning)
      if (currentY + totalNeededHeight > pageHeight - 100) {
        ToastAndroid.show(
          'Warning: Selected clips may exceed page bounds.',
          ToastAndroid.LONG
        );
      }

      // 4. Sequential chronological insertion
      for (const elem of elementLayouts) {
        if (elem.type === 'text' && elem.text) {
          const rect = {
            left: 100,
            top: currentY,
            right: pageWidth - 100,
            bottom: currentY + elem.layoutHeight,
          };

          const insertRes = await PluginNoteAPI.insertText({
            textContentFull: elem.text,
            textRect: rect,
            fontSize: 44,
            textAlign: 0,
            textBold: 0,
            textItalics: 0,
            textFrameWidthType: 0,
            textFrameStyle: 0,
            textEditable: 1,
          });

          if (insertRes && insertRes.success) {
            currentY += elem.layoutHeight + margin;
          }
          await new Promise(r => setTimeout(r, 500));
        } else if (elem.type === 'image' && elem.imagePath) {
          // A. Insert image (takes native default center coordinate in-memory)
          const insertRes = await PluginNoteAPI.insertImage(elem.imagePath) as any;
          if (insertRes && insertRes.success && insertRes.result && insertRes.result.uuid) {
            const imgUuid = insertRes.result.uuid;

            // B. Commit insertion to disk file
            await PluginNoteAPI.saveCurrentNote();

            // C. Load elements from disk and locate the image by UUID
            const pageElementsRes = await PluginFileAPI.getElements(page, notePath) as any;
            if (pageElementsRes && pageElementsRes.success && Array.isArray(pageElementsRes.result)) {
              const imgElem = pageElementsRes.result.find((el: any) => el.uuid === imgUuid);
              if (imgElem) {
                // D. Modify coordinates to keep chronological order on disk
                imgElem.picture = {
                  picturePath: elem.imagePath,
                  rect: {
                    left: 100,
                    top: currentY,
                    right: pageWidth - 100,
                    bottom: currentY + elem.layoutHeight,
                  }
                };
                await PluginFileAPI.modifyElements(notePath, page, [imgElem]);
              }
            }
            currentY += elem.layoutHeight + margin;
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      ToastAndroid.show('Clips inserted successfully!', ToastAndroid.SHORT);
      // Remove the successfully inserted clips from Clipper history database
      const insertedIds = clipsToInsert.map(c => c.id);
      await ClipService.deleteClips(insertedIds);

      await PluginNoteAPI.saveCurrentNote();
      // Automatically close Clipper view to show the newly inserted note contents
      PluginManager.closePluginView();
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
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Clip Selection</Text>
                <Text style={styles.modalDescription}>
                  You selected text. How would you like to clip this selection?
                </Text>
                <View style={styles.modalButtons}>
                  <Pressable
                    onPress={handleClipSelectionAsText}
                    style={[styles.modalButton, styles.modalButtonPrimary]}
                  >
                    <Text style={styles.modalButtonTextPrimary}>Clip as Text</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleClipSelectionAsImage}
                    style={[styles.modalButton, styles.modalButtonSecondary]}
                  >
                    <Text style={styles.modalButtonTextSecondary}>Clip as Image</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleCancelSelectionModal}
                    style={[styles.modalButton, styles.modalButtonCancel]}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
      </View>
    );
  }

  if (showPromptDialog) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Clip Selection</Text>
            <Text style={styles.modalDescription}>
              How would you like to clip this selection?{"\n\n"}
              <Text style={{ fontWeight: 'bold', fontStyle: 'italic' }}>"{promptText}"</Text>
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={async () => {
                  setShowPromptDialog(false);
                  await ClipService.setPromptText('');
                  await handleStartCropping(currentFilePath || undefined, currentPageNum);
                }}
              >
                <Text style={styles.modalButtonTextPrimary}>Clip Region</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={async () => {
                  setShowPromptDialog(false);
                  await ClipService.setPromptText('');
                  await ClipService.addClip(promptText, deriveArticleName(currentFilePath));
                  ToastAndroid.show('Clipped as Text!', ToastAndroid.SHORT);
                  const { PluginManager } = require('sn-plugin-lib');
                  PluginManager.closePluginView();
                }}
              >
                <Text style={styles.modalButtonTextSecondary}>Clip Text</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={async () => {
                  setShowPromptDialog(false);
                  await ClipService.setPromptText('');
                  const { PluginManager } = require('sn-plugin-lib');
                  PluginManager.closePluginView();
                }}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
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

              <Pressable onPress={toggleSearch} style={styles.iconButton} testID="search-btn">
                <Image source={require('../assets/icon/search.png')} style={styles.iconImage} />
              </Pressable>
              <Pressable onPress={() => setIsPopoverOpen(true)} style={styles.iconButton} testID="filter-btn">
                <Image source={require('../assets/icon/filter.png')} style={styles.iconImage} />
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
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search clippings..."
              placeholderTextColor="#888888"
            />
            <Pressable onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
              <Image source={require('../assets/icon/clear.png')} style={styles.searchClearImage} />
            </Pressable>
          </View>
        )}

        {/* Recycled FlatList representing clippings */}
        <FlatList
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          data={processedClips}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {clips.length === 0
                ? 'No clippings aggregated yet. Highlight text to begin.'
                : 'No clippings match the search or filter query.'}
            </Text>
          }
          renderItem={({ item: clip }) => {
            const isSelected = selectedIds.includes(clip.id);
            return (
              <Pressable
                onPress={() => handleCardPress(clip.id)}
                onLongPress={() => handleCardLongPress(clip.id)}
                style={[
                  styles.clipItem,
                  isSelectionMode && styles.selectableClipItem,
                  isSelected && styles.selectedClipItem,
                ]}
              >
                <View style={styles.clipItemHeader}>
                  <View style={styles.clipIndexRow}>
                    {isSelectionMode && (
                      <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                        {isSelected && <Text style={styles.checkMark}>✓</Text>}
                      </View>
                    )}
                    <Text style={styles.clipIndex}>{formatDate(clip.timestamp)}</Text>
                  </View>
                  <Text style={styles.articleName} numberOfLines={1}>
                    {clip.articleName}
                  </Text>
                </View>
                {clip.elements && clip.elements.map((elem, idx) => {
                  if (elem.type === 'text' && elem.text) {
                    return <Text key={idx} style={styles.clipText}>{elem.text}</Text>;
                  } else if (elem.type === 'image' && elem.imagePath) {
                    return (
                      <Image
                        key={idx}
                        source={{ uri: 'file://' + elem.imagePath }}
                        style={styles.clipImage}
                      />
                    );
                  }
                  return null;
                })}
              </Pressable>
            );
          }}
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
                    <HighContrastButton label="Copy Selected" onPress={handleCopySelected} />
                    <HighContrastButton label="Insert into open Note" onPress={handleInsertSelected} />
                    <HighContrastButton label="Merge Selected" onPress={handleMergeSelected} disabled={selectedIds.length < 2} />
                  </View>
                  <View style={styles.btnRow}>
                    <HighContrastButton label="Delete Selected" onPress={handleDeleteSelected} />
                    <HighContrastButton label="Cancel" onPress={handleCancel} />
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.btnRow}>
                    <HighContrastButton label="Copy Selected" onPress={handleCopySelected} />
                    <HighContrastButton label="Merge Selected" onPress={handleMergeSelected} disabled={selectedIds.length < 2} />
                    <HighContrastButton label="Delete Selected" onPress={handleDeleteSelected} />
                  </View>
                  <View style={styles.btnRow}>
                    <HighContrastButton label="Cancel" onPress={handleCancel} />
                  </View>
                </>
              )}
            </>
          )}
        </View>
      </View>

      {/* Local Filter & Sort Popover Menu */}
      {isPopoverOpen && (
        <>
          <Pressable style={styles.backdrop} onPress={() => setIsPopoverOpen(false)} />
          <Pressable style={styles.popover} onPress={() => {}}>
            {/* Pointing Triangle */}
            <View style={styles.popoverArrow} />
            
            {/* Sort Order Section (Pinned Top) */}
            <Text style={styles.popoverSectionHeader}>Sort Order</Text>
            <Pressable
              onPress={() => {
                setActiveSortMode('newest');
                setIsPopoverOpen(false);
              }}
              style={styles.popoverRow}
            >
              <Text style={styles.popoverRowLabel}>Newest First</Text>
              {activeSortMode === 'newest' ? (
                <View style={styles.popoverCheckedBadge}>
                  <Text style={styles.popoverCheckMark}>✓</Text>
                </View>
              ) : (
                <View style={styles.popoverEmptyBadge} />
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setActiveSortMode('oldest');
                setIsPopoverOpen(false);
              }}
              style={styles.popoverRow}
            >
              <Text style={styles.popoverRowLabel}>Oldest First</Text>
              {activeSortMode === 'oldest' ? (
                <View style={styles.popoverCheckedBadge}>
                  <Text style={styles.popoverCheckMark}>✓</Text>
                </View>
              ) : (
                <View style={styles.popoverEmptyBadge} />
              )}
            </Pressable>

            <View style={styles.popoverDivider} />

            {/* Filter by Source Section (Scrollable Bottom) */}
            <Text style={styles.popoverSectionHeader}>Filter by Source</Text>
            <ScrollView style={styles.popoverScroll} nestedScrollEnabled={true}>
              <Pressable
                onPress={() => {
                  setActiveSourceFilter(null);
                  setIsPopoverOpen(false);
                }}
                style={styles.popoverRow}
              >
                <Text style={styles.popoverRowLabel} numberOfLines={1}>All Sources</Text>
                {activeSourceFilter === null ? (
                  <View style={styles.popoverCheckedBadge}>
                    <Text style={styles.popoverCheckMark}>✓</Text>
                  </View>
                ) : (
                  <View style={styles.popoverEmptyBadge} />
                )}
              </Pressable>

              {uniqueSources.map((source) => (
                <Pressable
                  key={source}
                  onPress={() => {
                    setActiveSourceFilter(source);
                    setIsPopoverOpen(false);
                  }}
                  style={styles.popoverRow}
                >
                  <Text style={styles.popoverRowLabel} numberOfLines={1}>
                    {source}
                  </Text>
                  {activeSourceFilter === source ? (
                    <View style={styles.popoverCheckedBadge}>
                      <Text style={styles.popoverCheckMark}>✓</Text>
                    </View>
                  ) : (
                    <View style={styles.popoverEmptyBadge} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </>
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
  searchBar: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: '#000000',
    marginBottom: 12,
    height: 48,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 12,
    fontSize: 18,
    color: '#000000',
  },
  searchClearBtn: {
    paddingHorizontal: 12,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchClearImage: {
    width: 18,
    height: 18,
    tintColor: '#000000',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    zIndex: 998,
  },
  popover: {
    position: 'absolute',
    top: 100,
    right: 16,
    width: 432,
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
    zIndex: 999,
    padding: 12,
  },
  popoverArrow: {
    position: 'absolute',
    top: -7,
    right: 26,
    width: 12,
    height: 12,
    backgroundColor: '#ffffff',
    borderLeftWidth: 2,
    borderTopWidth: 2,
    borderColor: '#000000',
    transform: [{ rotate: '45deg' }],
    zIndex: 1000,
  },
  popoverSectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666666',
    marginBottom: 8,
  },
  popoverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  popoverRowLabel: {
    fontSize: 18,
    color: '#000000',
    maxWidth: '80%',
  },
  popoverCheckedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popoverEmptyBadge: {
    width: 20,
    height: 20,
  },
  popoverCheckMark: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  popoverDivider: {
    height: 1,
    backgroundColor: '#000000',
    marginVertical: 10,
  },
  popoverScroll: {
    maxHeight: 176, // scrollable area for documents
  },

  scrollArea: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000000',
    marginBottom: 16,
  },
  scrollContent: {
    padding: 12,
    gap: 12,
  },
  emptyText: {
    fontSize: 18,
    fontStyle: 'italic',
    color: '#666666',
    textAlign: 'center',
    marginTop: 40,
  },
  clipItem: {
    borderWidth: 1,
    borderColor: '#cccccc',
    padding: 12,
    backgroundColor: '#ffffff',
  },
  selectableClipItem: {
    borderColor: '#888888',
  },
  selectedClipItem: {
    borderWidth: 3,
    borderColor: '#000000',
  },
  clipItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
    paddingBottom: 6,
    marginBottom: 8,
  },
  clipIndexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#000000',
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  clipIndex: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  articleName: {
    fontSize: 14,
    color: '#666666',
    fontStyle: 'italic',
    maxWidth: '45%',
  },
  clipText: {
    fontSize: 18,
    color: '#000000',
    lineHeight: 26,
  },
  footer: {
    flexDirection: 'column',
    gap: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  clipImage: {
    width: '100%',
    height: 180,
    resizeMode: 'contain',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginTop: 6,
    backgroundColor: '#f9f9f9',
  },
  textIconButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTextButton: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  // Root wrapper for crop mode: holds the CropOverlay plus the (absolute) selection modal.
  cropRoot: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    width: '80%',
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 16,
  },
  modalDescription: {
    fontSize: 18,
    color: '#333333',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 26,
  },
  modalButtons: {
    width: '100%',
    flexDirection: 'column',
    gap: 12,
  },
  modalButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  modalButtonPrimary: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  modalButtonSecondary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
  },
  modalButtonCancel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#666666',
  },
  modalButtonTextPrimary: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  modalButtonTextSecondary: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  modalButtonTextCancel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666666',
  },
});
