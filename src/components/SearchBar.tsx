// SnClipper/src/components/SearchBar.tsx
// Vinod Nair
//
// Toggleable search input row shown under the dashboard header.

import React from 'react';
import { StyleSheet, View, TextInput, Pressable, Image } from 'react-native';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
}

export function SearchBar({ value, onChangeText, onClear }: SearchBarProps) {
  return (
    <View style={styles.searchBar}>
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search clippings..."
        placeholderTextColor="#888888"
      />
      <Pressable onPress={onClear} style={styles.searchClearBtn}>
        <Image source={require('../../assets/icon/clear.png')} style={styles.searchClearImage} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
