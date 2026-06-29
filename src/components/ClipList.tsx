// SnClipper/src/components/ClipList.tsx
// Vinod Nair
//
// Scrollable list of clip cards. `data` is the filtered/sorted set to display;
// `totalCount` is the unfiltered clip count, used only to pick the empty message.

import React from 'react';
import { StyleSheet, Text, FlatList } from 'react-native';
import { ClipItem } from '../services/StorageService';
import { ClipCard } from './ClipCard';

interface ClipListProps {
  data: ClipItem[];
  totalCount: number;
  selectedIds: string[];
  isSelectionMode: boolean;
  onCardPress: (id: string) => void;
  onCardLongPress: (id: string) => void;
}

export function ClipList({
  data,
  totalCount,
  selectedIds,
  isSelectionMode,
  onCardPress,
  onCardLongPress,
}: ClipListProps) {
  return (
    <FlatList
      style={styles.scrollArea}
      contentContainerStyle={styles.scrollContent}
      data={data}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <Text style={styles.emptyText}>
          {totalCount === 0
            ? 'No clippings aggregated yet. Highlight text to begin.'
            : 'No clippings match the search or filter query.'}
        </Text>
      }
      renderItem={({ item: clip }) => (
        <ClipCard
          clip={clip}
          isSelected={selectedIds.includes(clip.id)}
          isSelectionMode={isSelectionMode}
          onPress={() => onCardPress(clip.id)}
          onLongPress={() => onCardLongPress(clip.id)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
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
});
