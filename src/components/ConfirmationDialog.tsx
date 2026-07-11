// SnClipper/src/components/ConfirmationDialog.tsx
// Vinod Nair
//
// A reusable, high-contrast modal dialog matching Clipper's E-Ink design style.
// Used for confirmation flows (e.g. deleting broken document links).

import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';

interface ConfirmationDialogProps {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  if (!visible) return null;

  return (
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>
        <Text style={styles.modalTitle}>{title}</Text>
        <Text style={styles.modalDescription}>{description}</Text>
        <View style={styles.modalButtons}>
          <Pressable onPress={onConfirm} style={[styles.modalButton, styles.modalButtonPrimary]}>
            <Text style={styles.modalButtonTextPrimary}>{confirmLabel}</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={[styles.modalButton, styles.modalButtonCancel]}>
            <Text style={styles.modalButtonTextCancel}>{cancelLabel}</Text>
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
    zIndex: 1050, // Slightly higher than PromptDialog
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
    textAlign: 'center',
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
  modalButtonCancel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#666666',
  },
  modalButtonTextPrimary: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  modalButtonTextCancel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666666',
  },
});
