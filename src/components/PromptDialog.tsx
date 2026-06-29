// SnClipper/src/components/PromptDialog.tsx
// Vinod Nair
//
// Modal asking the user how to clip a selection (as image / as text / cancel).
// Used both from the prompt launch mode and from the crop overlay's "you selected
// text" prompt — the labels and which action is primary vary per site via props.

import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';

interface PromptDialogProps {
  imageLabel: string;
  textLabel: string;
  onClipImage: () => void;
  onClipText: () => void;
  onCancel: () => void;
  // Which action gets the filled-black "primary" styling.
  primaryAction?: 'image' | 'text';
  // Optional selection text rendered as a bold-italic quote under the description.
  text?: string | null;
  // Defaults to the generic question; override for the crop-overlay wording.
  description?: string;
}

export function PromptDialog({
  imageLabel,
  textLabel,
  onClipImage,
  onClipText,
  onCancel,
  primaryAction = 'image',
  text,
  description = 'How would you like to clip this selection?',
}: PromptDialogProps) {
  const imageIsPrimary = primaryAction === 'image';
  return (
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>
        <Text style={styles.modalTitle}>Clip Selection</Text>
        <Text style={styles.modalDescription}>
          {description}
          {text ? (
            <>
              {'\n\n'}
              <Text style={styles.modalQuote}>"{text}"</Text>
            </>
          ) : null}
        </Text>
        <View style={styles.modalButtons}>
          <Pressable
            onPress={onClipImage}
            style={[styles.modalButton, imageIsPrimary ? styles.modalButtonPrimary : styles.modalButtonSecondary]}
          >
            <Text style={imageIsPrimary ? styles.modalButtonTextPrimary : styles.modalButtonTextSecondary}>
              {imageLabel}
            </Text>
          </Pressable>
          <Pressable
            onPress={onClipText}
            style={[styles.modalButton, imageIsPrimary ? styles.modalButtonSecondary : styles.modalButtonPrimary]}
          >
            <Text style={imageIsPrimary ? styles.modalButtonTextSecondary : styles.modalButtonTextPrimary}>
              {textLabel}
            </Text>
          </Pressable>
          <Pressable onPress={onCancel} style={[styles.modalButton, styles.modalButtonCancel]}>
            <Text style={styles.modalButtonTextCancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  modalQuote: {
    fontWeight: 'bold',
    fontStyle: 'italic',
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
