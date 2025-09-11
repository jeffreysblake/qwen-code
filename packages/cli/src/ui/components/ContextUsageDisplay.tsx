/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { Colors } from '../colors.js';
import { tokenLimit } from '@qwen-code/qwen-code-core';

export const ContextUsageDisplay = ({
  promptTokenCount,
  model,
}: {
  promptTokenCount: number;
  model: string;
}) => {
  const limit = tokenLimit(model);
  const percentage = Math.min(promptTokenCount / limit, 1); // Cap percentage at 1 to prevent negative context
  const contextLeft = Math.max(0, ((1 - percentage) * 100)); // Ensure non-negative percentage

  return (
    <Text color={Colors.Gray}>
      ({contextLeft.toFixed(0)}% context left)
    </Text>
  );
};
