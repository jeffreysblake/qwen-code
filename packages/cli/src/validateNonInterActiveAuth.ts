/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, Config } from '@qwen-code/qwen-code-core';
import { USER_SETTINGS_PATH } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';

function getAuthTypeFromEnv(): AuthType | undefined {
  if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
    return AuthType.LOGIN_WITH_GOOGLE;
  }
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') {
    return AuthType.USE_VERTEX_AI;
  }
  if (process.env['GEMINI_API_KEY']) {
    return AuthType.USE_GEMINI;
  }
  // Check if this looks like a local configuration (all three required vars present)
  if (process.env['OPENAI_API_KEY'] && process.env['OPENAI_BASE_URL'] && process.env['OPENAI_MODEL']) {
    // If the base URL looks like a local endpoint, use LOCAL auth type
    const baseUrl = process.env['OPENAI_BASE_URL'].toLowerCase();
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('192.168.') || baseUrl.includes('10.') || baseUrl.includes('172.')) {
      return AuthType.LOCAL;
    }
    // Otherwise use standard OpenAI
    return AuthType.USE_OPENAI;
  }
  if (process.env['OPENAI_API_KEY']) {
    return AuthType.USE_OPENAI;
  }
  return undefined;
}

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
) {
  const envAuthType = getAuthTypeFromEnv();
  
  // If environment variables provide a complete auth setup, prioritize that
  // This prevents auth screen loops when env vars are set but settings have a different auth type
  let effectiveAuthType = configuredAuthType;
  
  if (envAuthType) {
    // If env variables suggest LOCAL or another auth type, and it validates successfully, use it
    const envValidationError = validateAuthMethod(envAuthType);
    if (!envValidationError) {
      effectiveAuthType = envAuthType;
    } else if (!effectiveAuthType) {
      // Only fallback to env auth type if no configured auth type exists
      effectiveAuthType = envAuthType;
    }
  }
  
  if (!effectiveAuthType) {
    console.error(
      `Please set an Auth method in your ${USER_SETTINGS_PATH} or specify one of the following environment variables before running: GEMINI_API_KEY, OPENAI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA`,
    );
    process.exit(1);
  }

  if (!useExternalAuth) {
    const err = validateAuthMethod(effectiveAuthType);
    if (err != null) {
      console.error(err);
      process.exit(1);
    }
  }

  await nonInteractiveConfig.refreshAuth(effectiveAuthType);
  return nonInteractiveConfig;
}
