// SnClipper/src/components/FilterPopover.tsx
// Vinod Nair
//
// Local high-contrast popover for sort order + filter-by-source, anchored below the
// header filter button. Rendered as a backdrop + absolute panel.

import React from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView } from 'react-native';

type SortMode = 'oldest' | 'newest';

interface FilterPopoverProps {
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  activeSourceFilter: string | null; // null = All Sources
  sources: string[];
  onSourceChange: (source: string | null) => void;
  onClose: () => void;
}

// Right-aligned circular badge: filled check when selected, blank otherwise.
function Badge({ selected }: { selected: boolean }) {
  return selected ? (
    <View style={styles.popoverCheckedBadge}>
      <Text style={styles.popoverCheckMark}>✓</Text>
    </View>
  ) : (
    <View style={styles.popoverEmptyBadge} />
  );
}

export function FilterPopover({
  sortMode,
  onSortChange,
  activeSourceFilter,
  sources,
  onSourceChange,
  onClose,
}: FilterPopoverProps) {
  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Pressable style={styles.popover} onPress={() => {}}>
        {/* Pointing Triangle */}
        <View style={styles.popoverArrow} />

        {/* Sort Order Section (Pinned Top) */}
        <Text style={styles.popoverSectionHeader}>Sort Order</Text>
        <Pressable onPress={() => onSortChange('newest')} style={styles.popoverRow}>
          <Text style={styles.popoverRowLabel}>Newest First</Text>
          <Badge selected={sortMode === 'newest'} />
        </Pressable>
        <Pressable onPress={() => onSortChange('oldest')} style={styles.popoverRow}>
          <Text style={styles.popoverRowLabel}>Oldest First</Text>
          <Badge selected={sortMode === 'oldest'} />
        </Pressable>

        <View style={styles.popoverDivider} />

        {/* Filter by Source Section (Scrollable Bottom) */}
        <Text style={styles.popoverSectionHeader}>Filter by Source</Text>
        <ScrollView style={styles.popoverScroll} nestedScrollEnabled={true}>
          <Pressable onPress={() => onSourceChange(null)} style={styles.popoverRow}>
            <Text style={styles.popoverRowLabel} numberOfLines={1}>All Sources</Text>
            <Badge selected={activeSourceFilter === null} />
          </Pressable>

          {sources.map((source) => (
            <Pressable key={source} onPress={() => onSourceChange(source)} style={styles.popoverRow}>
              <Text style={styles.popoverRowLabel} numberOfLines={1}>
                {source}
              </Text>
              <Badge selected={activeSourceFilter === source} />
            </Pressable>
          ))}
        </ScrollView>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
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
});
