// SnClipper/src/app.tsx
// Vinod Nair

import React, { useEffect, useState, useMemo } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ToastAndroid,
  Pressable,
  TextInput,
  Image,
} from 'react-native';
import { ClipService } from './services/ClipService';
import { ClipItem } from './services/StorageService';
import { PluginNoteAPI, PluginFileAPI, PluginManager } from 'sn-plugin-lib';
import { HighContrastButton } from './components/HighContrastButton';

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
  const [isNoteFile, setIsNoteFile] = useState<boolean>(true); // Default to true

  // Search, Filter & Sort States
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [activeSourceFilter, setActiveSourceFilter] = useState<string | null>(null); // null = All Sources
  const [activeSortMode, setActiveSortMode] = useState<'oldest' | 'newest'>('newest');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  useEffect(() => {
    // Sync current list and active file type context from Storage on open
    ClipService.init().then(() => {
      setClips(ClipService.getClipsSync());
      setIsNoteFile(ClipService.getActiveFileTypeSync());
    });

    // Reactively refresh UI when background actions add elements or change active file context
    const unsubscribe = ClipService.subscribe(() => {
      setClips([...ClipService.getClipsSync()]);
      setIsNoteFile(ClipService.getActiveFileTypeSync());
    });

    return unsubscribe;
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

  const handleInsertClips = async (targetClips: ClipItem[]) => {
    const text = ClipService.getAggregateTextSync(targetClips);
    if (!text) {
      ToastAndroid.show('Nothing to insert!', ToastAndroid.SHORT);
      return;
    }

    try {
      const sizeRes = await PluginFileAPI.getPageSize();
      const w = sizeRes.success ? sizeRes.result.width : 1404;
      const h = sizeRes.success ? sizeRes.result.height : 1872;

      const textRect = {
        left: 100,
        top: 200,
        right: w - 100,
        bottom: h - 200,
      };

      const res = await PluginNoteAPI.insertText({
        textContentFull: text,
        textRect,
        fontSize: 28,
        textAlign: 0,
        textBold: 0,
        textItalics: 0,
        textFrameWidthType: 0,
        textFrameStyle: 0,
        textEditable: 0,
      });

      if (res.success) {
        ToastAndroid.show('Inserted into Note!', ToastAndroid.SHORT);
        PluginManager.closePluginView();
      } else {
        ToastAndroid.show(`Insert failed: ${res.error?.message}`, ToastAndroid.SHORT);
      }
    } catch (e: any) {
      ToastAndroid.show(`Error: ${e.message}`, ToastAndroid.SHORT);
    }
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
              <Pressable onPress={toggleSearch} style={styles.iconButton}>
                <Image source={require('../assets/icon/search.png')} style={styles.iconImage} />
              </Pressable>
              <Pressable onPress={() => setIsPopoverOpen(!isPopoverOpen)} style={styles.iconButton}>
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

        {/* Scrollable Clips List */}
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
          {processedClips.length === 0 ? (
            <Text style={styles.emptyText}>
              {clips.length === 0
                ? 'No clippings aggregated yet. Underline text inside a document to begin.'
                : 'No clippings match the search or filter query.'}
            </Text>
          ) : (
            processedClips.map((clip) => {
              const isSelected = selectedIds.includes(clip.id);
              return (
                <Pressable
                  key={clip.id}
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
                  <Text style={styles.clipText}>{clip.text}</Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {/* Footer Actions Area */}
        <View style={styles.footer}>
          {!isSelectionMode ? (
            <>
              <View style={styles.btnRow}>
                <HighContrastButton label="Copy Visible" onPress={handleCopyAllVisible} disabled={processedClips.length === 0} />
                <HighContrastButton label="Clear All" onPress={handleClearAll} disabled={clips.length === 0} />
              </View>
              {isNoteFile && (
                <View style={styles.btnRow}>
                  <HighContrastButton label="Insert Visible" onPress={() => handleInsertClips(processedClips)} disabled={processedClips.length === 0} />
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.btnRow}>
                <HighContrastButton label="Copy Selected" onPress={handleCopySelected} />
                <HighContrastButton label="Merge Selected" onPress={handleMergeSelected} disabled={selectedIds.length < 2} />
                <HighContrastButton label="Delete Selected" onPress={handleDeleteSelected} />
              </View>
              <View style={styles.btnRow}>
                {isNoteFile && (
                  <HighContrastButton label="Insert Selected" onPress={() => handleInsertClips(clips.filter((c) => selectedIds.includes(c.id)))} />
                )}
                <HighContrastButton label="Cancel" onPress={handleCancel} />
              </View>
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
});
