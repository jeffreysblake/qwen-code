/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';

export interface TextInputProps {
  placeholder?: string;
  value?: string;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  isFocused?: boolean;
  maxWidth?: number;
}

export const TextInput: React.FC<TextInputProps> = ({
  placeholder = 'Enter text...',
  value: initialValue = '',
  onSubmit,
  onCancel,
  isFocused = true,
  maxWidth = 80,
}) => {
  const [value, setValue] = useState(initialValue);
  const [cursorPos, setCursorPos] = useState(initialValue.length);

  useKeypress(
    (key) => {
      if (!isFocused) return;

      if (key.name === 'escape') {
        onCancel?.();
        return;
      }

      if (key.name === 'return') {
        onSubmit(value);
        return;
      }

      if (key.name === 'backspace') {
        if (cursorPos > 0) {
          const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
          setValue(newValue);
          setCursorPos(cursorPos - 1);
        }
        return;
      }

      if (key.name === 'left') {
        setCursorPos(Math.max(0, cursorPos - 1));
        return;
      }

      if (key.name === 'right') {
        setCursorPos(Math.min(value.length, cursorPos + 1));
        return;
      }

      if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
        setCursorPos(0);
        return;
      }

      if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        setCursorPos(value.length);
        return;
      }

      if (key.ctrl && key.name === 'u') {
        // Clear line
        setValue('');
        setCursorPos(0);
        return;
      }

      // Regular character input
      if (key.name && key.name.length === 1 && !key.ctrl && !key.meta) {
        const newValue = value.slice(0, cursorPos) + key.name + value.slice(cursorPos);
        if (newValue.length <= maxWidth) {
          setValue(newValue);
          setCursorPos(cursorPos + 1);
        }
        return;
      }

      // Handle printable characters
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        const newValue = value.slice(0, cursorPos) + key.sequence + value.slice(cursorPos);
        if (newValue.length <= maxWidth) {
          setValue(newValue);
          setCursorPos(cursorPos + 1);
        }
      }
    },
    { isActive: isFocused },
  );

  const displayValue = value.length === 0 && placeholder ? placeholder : value;
  const isPlaceholder = value.length === 0 && placeholder;

  return (
    <Box borderStyle="single" borderColor={Colors.Gray} paddingX={1}>
      {isPlaceholder ? (
        <Text color={Colors.Gray}>{placeholder}</Text>
      ) : (
        <Text>
          {value.slice(0, cursorPos)}
          {isFocused && (
            <Text>
              {chalk.inverse(
                cursorPos < value.length ? value.slice(cursorPos, cursorPos + 1) : ' '
              )}
            </Text>
          )}
          {value.slice(cursorPos + 1)}
        </Text>
      )}
    </Box>
  );
};