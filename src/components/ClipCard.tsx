// SnClipper/src/components/ClipCard.tsx
// Vinod Nair
//
// A single clip card: header (selection checkbox + date + source) and a body of
// chronological text/image sub-elements.

import React from 'react';
import { StyleSheet, Text, View, Pressable, Image } from 'react-native';
import { ClipItem } from '../services/StorageService';

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

interface ClipCardProps {
  clip: ClipItem;
  isSelected: boolean;
  isSelectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function ClipCard({ clip, isSelected, isSelectionMode, onPress, onLongPress }: ClipCardProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
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
}

const styles = StyleSheet.create({
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
  clipImage: {
    width: '100%',
    height: 180,
    resizeMode: 'contain',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginTop: 6,
    backgroundColor: '#f9f9f9',
  },
});
