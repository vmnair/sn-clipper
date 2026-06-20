import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export function HighContrastButton({ label, onPress, disabled = false }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.text, disabled && styles.disabledText]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
  },
  pressed: {
    backgroundColor: '#e0e0e0', // Pure gray tap flash
  },
  disabled: {
    borderColor: '#cccccc',
    backgroundColor: '#f9f9f9',
  },
  text: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
  },
  disabledText: {
    color: '#cccccc',
  },
});
