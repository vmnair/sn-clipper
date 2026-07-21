// SnClipper/src/components/SettingsPopover.tsx
// Vinod Nair
//
// Local high-contrast settings popover, anchored below the header gear button.
// Rendered as a backdrop + absolute panel, matching FilterPopover.

import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { INSERT_FONT_SIZES } from '../services/StorageService';

interface SettingsPopoverProps {
  autoRemoveInserted: boolean;
  onAutoRemoveChange: (value: boolean) => void;
  combineInserted: boolean;
  onCombineChange: (value: boolean) => void;
  showSourceInClipper: boolean;
  onShowSourceChange: (value: boolean) => void;
  insertSourceLink: boolean;
  onInsertSourceLinkChange: (value: boolean) => void;
  insertFontSize: number;
  onInsertFontSizeChange: (size: number) => void;
  enableToc: boolean;
  onEnableTocChange: (value: boolean) => void;
  enableKeywordIndex: boolean;
  onEnableKeywordIndexChange: (value: boolean) => void;
  onResetToDefault: () => void;
  onClose: () => void;
}

const FONT_OPTIONS: { label: string; size: number }[] = [
  { label: 'Small', size: INSERT_FONT_SIZES.small },
  { label: 'Medium', size: INSERT_FONT_SIZES.medium },
  { label: 'Large', size: INSERT_FONT_SIZES.large },
];

// Right-aligned circular badge: filled check when on, blank otherwise.
function Badge({ selected }: { selected: boolean }) {
  return selected ? (
    <View style={styles.popoverCheckedBadge}>
      <Text style={styles.popoverCheckMark}>✓</Text>
    </View>
  ) : (
    <View style={styles.popoverEmptyBadge} />
  );
}

export function SettingsPopover({
  autoRemoveInserted,
  onAutoRemoveChange,
  combineInserted,
  onCombineChange,
  showSourceInClipper,
  onShowSourceChange,
  insertSourceLink,
  onInsertSourceLinkChange,
  insertFontSize,
  onInsertFontSizeChange,
  enableToc,
  onEnableTocChange,
  enableKeywordIndex,
  onEnableKeywordIndexChange,
  onResetToDefault,
  onClose,
}: SettingsPopoverProps) {
  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Pressable style={styles.popover} onPress={() => {}}>
        {/* Pointing Triangle */}
        <View style={styles.popoverArrow} />

        <Text style={styles.popoverSectionHeader}>Settings</Text>
        <Pressable
          onPress={() => onAutoRemoveChange(!autoRemoveInserted)}
          style={styles.popoverRow}
          testID="setting-auto-remove"
        >
          <View style={styles.popoverLabelBlock}>
            <Text style={styles.popoverRowLabel}>Remove clips after inserting</Text>
            <Text style={styles.popoverRowHint}>Inserted clips are deleted from Clipper</Text>
          </View>
          <Badge selected={autoRemoveInserted} />
        </Pressable>

        <Pressable
          onPress={() => onCombineChange(!combineInserted)}
          style={styles.popoverRow}
          testID="setting-combine"
        >
          <View style={styles.popoverLabelBlock}>
            <Text style={styles.popoverRowLabel}>Combine inserted text</Text>
            <Text style={styles.popoverRowHint}>Insert clips as one text block</Text>
          </View>
          <Badge selected={combineInserted} />
        </Pressable>

        <View style={styles.popoverDivider} />

        <Text style={styles.popoverSectionHeader}>Table of Contents &amp; Index</Text>
        <Pressable
          onPress={() => onEnableTocChange(!enableToc)}
          style={styles.popoverRow}
          testID="setting-enable-toc"
        >
          <View style={styles.popoverLabelBlock}>
            <Text style={styles.popoverRowLabel}>Enable Table of Contents (ToC)</Text>
            <Text style={styles.popoverRowHint}>ToC tab &amp; Page 1 note generator</Text>
          </View>
          <Badge selected={enableToc} />
        </Pressable>

        <Pressable
          onPress={() => onEnableKeywordIndexChange(!enableKeywordIndex)}
          style={styles.popoverRow}
          testID="setting-enable-keyword-index"
        >
          <View style={styles.popoverLabelBlock}>
            <Text style={styles.popoverRowLabel}>Enable Keyword Index</Text>
            <Text style={styles.popoverRowHint}>Index tab &amp; Last Page note generator</Text>
          </View>
          <Badge selected={enableKeywordIndex} />
        </Pressable>

        <View style={styles.popoverDivider} />

        <Text style={styles.popoverSectionHeader}>Source document</Text>
        <Pressable
          onPress={() => onShowSourceChange(!showSourceInClipper)}
          style={styles.popoverRow}
          testID="setting-show-source"
        >
          <View style={styles.popoverLabelBlock}>
            <Text style={styles.popoverRowLabel}>Show source &amp; jump in Clipper</Text>
            <Text style={styles.popoverRowHint}>Jump icon on each clip card</Text>
          </View>
          <Badge selected={showSourceInClipper} />
        </Pressable>

        <Pressable
          onPress={() => onInsertSourceLinkChange(!insertSourceLink)}
          style={styles.popoverRow}
          testID="setting-insert-source-link"
        >
          <View style={styles.popoverLabelBlock}>
            <Text style={styles.popoverRowLabel}>Link source when inserting</Text>
            <Text style={styles.popoverRowHint}>Add a ↗ link under inserted clips</Text>
          </View>
          <Badge selected={insertSourceLink} />
        </Pressable>

        <View style={styles.popoverDivider} />

        <Text style={styles.popoverSectionHeader}>Inserted text size</Text>
        {FONT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.size}
            onPress={() => onInsertFontSizeChange(opt.size)}
            style={styles.popoverRow}
            testID={`setting-font-${opt.label.toLowerCase()}`}
          >
            <Text style={styles.popoverRowLabel}>{opt.label}</Text>
            <Badge selected={insertFontSize === opt.size} />
          </Pressable>
        ))}

        <View style={styles.popoverDivider} />

        <Pressable onPress={onResetToDefault} style={styles.resetButton} testID="setting-reset">
          <Text style={styles.resetButtonText}>Reset to default</Text>
        </Pressable>
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
  popoverDivider: {
    height: 1,
    backgroundColor: '#000000',
    marginVertical: 10,
  },
  popoverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  popoverLabelBlock: {
    flex: 1,
    paddingRight: 12,
  },
  popoverRowLabel: {
    fontSize: 18,
    color: '#000000',
  },
  popoverRowHint: {
    fontSize: 14,
    color: '#666666',
    marginTop: 2,
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
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#000000',
  },
  popoverCheckMark: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  resetButton: {
    minHeight: 48,
    borderWidth: 2,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  resetButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
});
