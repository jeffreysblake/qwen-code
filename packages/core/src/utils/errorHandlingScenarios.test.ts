/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { retryWithBackoff, getRetryOptionsForAuthType } from './retry.js';
import { isLocalModelError } from './localModelUtils.js';
import { AuthType } from '../core/contentGenerator.js';

// Mock for testing different error scenarios
const createMockError = (
  message: string,
  status?: number,
  headers?: Record<string, string>,
) => {
  const error = new Error(message) as any;
  if (status) {
    error.status = status;
    error.response = {
      status,
      headers: headers || {},
    };
  }
  return error;
};

describe('Error Handling Scenarios - Comprehensive Testing', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Local Model Error Detection', () => {
    describe('Connection errors', () => {
      it('should detect various connection failure patterns', () => {
        const connectionErrors = [
          'Connection refused',
          'ECONNREFUSED',
          'connect ECONNREFUSED 127.0.0.1:11434',
          'connection reset by peer',
          'ENOTFOUND localhost',
          'EHOSTUNREACH',
          'ETIMEDOUT',
          'socket hang up',
        ];

        connectionErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(true);
          expect(isLocalModelError(errorMessage)).toBe(true);
          expect(isLocalModelError(errorMessage.toUpperCase())).toBe(true);
        });
      });
    });

    describe('Model-specific errors', () => {
      it('should detect model loading and availability errors', () => {
        const modelErrors = [
          'Model not loaded',
          'Model not found',
          'model loading failed',
          'Failed to load model',
          'Model is currently loading',
          'Model not available',
          'No model loaded',
          'Invalid model name',
        ];

        modelErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(true);
          expect(isLocalModelError(errorMessage)).toBe(true);
        });
      });

      it('should detect memory and resource errors', () => {
        const resourceErrors = [
          'Out of memory',
          'CUDA out of memory',
          'Insufficient memory',
          'Memory allocation failed',
          'GPU memory full',
          'OOM error',
          'Not enough VRAM',
        ];

        resourceErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(true);
          expect(isLocalModelError(errorMessage)).toBe(true);
        });
      });

      it('should detect context and token limit errors', () => {
        const contextErrors = [
          'Context length exceeded',
          'Token limit exceeded',
          'Input too long',
          'Context window full',
          'Maximum context size reached',
          'Sequence length too long',
        ];

        contextErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(true);
          expect(isLocalModelError(errorMessage)).toBe(true);
        });
      });

      it('should detect timeout and inference errors', () => {
        const timeoutErrors = [
          'Inference timeout',
          'Generation timeout',
          'Request timeout',
          'Processing timeout',
          'Model inference failed',
          'Generation failed',
        ];

        timeoutErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(true);
          expect(isLocalModelError(errorMessage)).toBe(true);
        });
      });
    });

    describe('Platform-specific errors', () => {
      it('should detect Ollama-specific errors', () => {
        const ollamaErrors = [
          'ollama is not running',
          'Ollama server error',
          'ollama: model not found',
          'Failed to connect to ollama',
        ];

        ollamaErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(true);
        });
      });

      it('should detect local server errors', () => {
        const serverErrors = [
          'Local server unavailable',
          'localhost connection failed',
          'Server not responding',
          '127.0.0.1 unreachable',
        ];

        serverErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(true);
        });
      });
    });

    describe('False positives and negatives', () => {
      it('should not detect cloud service errors as local', () => {
        const cloudErrors = [
          'API key invalid',
          'Rate limit exceeded',
          'Unauthorized',
          'Forbidden',
          'Service unavailable',
          'OpenAI API error',
          'Anthropic API error',
          'Google API error',
          'Invalid request format',
          'Model not supported',
        ];

        cloudErrors.forEach((errorMessage) => {
          expect(isLocalModelError(new Error(errorMessage))).toBe(false);
          expect(isLocalModelError(errorMessage)).toBe(false);
        });
      });

      it('should handle edge cases in error messages', () => {
        const edgeCases = [
          '', // Empty string
          ' ', // Whitespace only
          'connection', // Partial match
          'model', // Partial match
          'memory', // Partial match without context
          'localhost is great', // Contains keyword but not error
          'I love my local model', // Contains keywords but not error
        ];

        edgeCases.forEach((errorMessage) => {
          // These should not be detected as local model errors
          expect(isLocalModelError(errorMessage)).toBe(false);
        });
      });

      it('should handle non-string error inputs', () => {
        const nonStringErrors = [null, undefined, 42, true, [], {}];

        nonStringErrors.forEach((error) => {
          expect(() => isLocalModelError(error)).not.toThrow();
          expect(isLocalModelError(error)).toBe(false);
        });

        // Special case for error object with message
        const errorWithMessage = { message: 'Connection refused' };
        expect(isLocalModelError(errorWithMessage)).toBe(true);
      });
    });
  });

  describe('Retry Logic for Different Auth Types', () => {
    describe('Local model retry configuration', () => {
      it('should provide optimized retry config for local models', () => {
        const config = getRetryOptionsForAuthType('local');

        expect(config.maxAttempts).toBe(3); // Fewer attempts
        expect(config.initialDelayMs).toBe(1000); // Shorter delay
        expect(config.maxDelayMs).toBe(8000); // Shorter max delay
        expect(typeof config.shouldRetry).toBe('function');
      });

      it('should not retry permanent local model failures', () => {
        const config = getRetryOptionsForAuthType('local');

        const permanentErrors = [
          'out of memory',
          'model not found',
          'context length exceeded',
        ];

        permanentErrors.forEach((errorMessage) => {
          expect(config.shouldRetry(new Error(errorMessage))).toBe(false);
        });
      });

      it('should retry transient local model failures', () => {
        const config = getRetryOptionsForAuthType('local');

        const transientErrors = [
          'Connection refused',
          'ECONNREFUSED',
          'Model loading',
          'Inference timeout',
          'Server not responding',
          'Temporary failure',
        ];

        transientErrors.forEach((errorMessage) => {
          expect(config.shouldRetry(new Error(errorMessage))).toBe(true);
        });
      });

      it('should use default retry logic for non-local errors', () => {
        const config = getRetryOptionsForAuthType('local');

        const nonLocalErrors = [
          'API key invalid',
          'Rate limit exceeded',
          'Some generic error',
          'Network error',
        ];

        nonLocalErrors.forEach((errorMessage) => {
          expect(config.shouldRetry(new Error(errorMessage))).toBe(true);
        });
      });
    });

    describe('Non-local auth types', () => {
      it('should use default config for cloud auth types', () => {
        const authTypes = [
          AuthType.API_KEY,
          AuthType.LOGIN_WITH_GOOGLE,
          AuthType.QWEN_OAUTH,
        ];

        authTypes.forEach((authType) => {
          const config = getRetryOptionsForAuthType(authType);

          expect(config.maxAttempts).toBe(5); // Default attempts
          expect(config.initialDelayMs).toBe(5000); // Default delay
          expect(config.maxDelayMs).toBe(30000); // Default max delay
        });
      });
    });
  });

  describe('Retry Scenarios with Real Error Patterns', () => {
    describe('Connection failure recovery', () => {
      it('should retry connection failures and eventually succeed', async () => {
        let attemptCount = 0;
        const maxAttempts = 3;

        const mockFunction = vi.fn(async () => {
          attemptCount++;
          if (attemptCount < maxAttempts) {
            throw createMockError('Connection refused');
          }
          return 'success';
        });

        const config = getRetryOptionsForAuthType('local');
        const result = await retryWithBackoff(mockFunction, config);

        expect(result).toBe('success');
        expect(mockFunction).toHaveBeenCalledTimes(maxAttempts);
      });

      it('should not retry permanent failures', async () => {
        const mockFunction = vi.fn(async () => {
          throw createMockError('Model not found');
        });

        const config = getRetryOptionsForAuthType('local');

        await expect(retryWithBackoff(mockFunction, config)).rejects.toThrow(
          'Model not found',
        );
        expect(mockFunction).toHaveBeenCalledTimes(1); // Should not retry
      });

      it('should respect max attempts for transient failures', async () => {
        const mockFunction = vi.fn(async () => {
          throw createMockError('Connection refused');
        });

        const config = getRetryOptionsForAuthType('local');

        await expect(retryWithBackoff(mockFunction, config)).rejects.toThrow(
          'Connection refused',
        );
        expect(mockFunction).toHaveBeenCalledTimes(config.maxAttempts);
      });
    });

    describe('HTTP error code handling', () => {
      it('should retry on 429 errors with appropriate delay', async () => {
        let attemptCount = 0;

        const mockFunction = vi.fn(async () => {
          attemptCount++;
          if (attemptCount < 2) {
            throw createMockError('Too Many Requests', 429, {
              'retry-after': '1',
            });
          }
          return 'success after retry';
        });

        const start = Date.now();
        const result = await retryWithBackoff(mockFunction);
        const duration = Date.now() - start;

        expect(result).toBe('success after retry');
        expect(duration).toBeGreaterThanOrEqual(1000); // Should respect retry-after
        expect(mockFunction).toHaveBeenCalledTimes(2);
      });

      it('should retry on 5xx server errors', async () => {
        const serverErrors = [500, 502, 503, 504];

        for (const status of serverErrors) {
          let attemptCount = 0;

          const mockFunction = vi.fn(async () => {
            attemptCount++;
            if (attemptCount < 2) {
              throw createMockError(`Server Error ${status}`, status);
            }
            return `recovered from ${status}`;
          });

          const result = await retryWithBackoff(mockFunction);
          expect(result).toBe(`recovered from ${status}`);
          expect(mockFunction).toHaveBeenCalledTimes(2);
        }
      });

      it('should not retry on 4xx client errors (except 429)', async () => {
        const clientErrors = [400, 401, 403, 404, 422];

        for (const status of clientErrors) {
          const mockFunction = vi.fn(async () => {
            throw createMockError(`Client Error ${status}`, status);
          });

          await expect(retryWithBackoff(mockFunction)).rejects.toThrow(
            `Client Error ${status}`,
          );
          expect(mockFunction).toHaveBeenCalledTimes(1); // Should not retry
        }
      });
    });

    describe('Mixed error scenarios', () => {
      it('should handle alternating error types correctly', async () => {
        let attemptCount = 0;
        const errors = [
          createMockError('Connection refused'), // Retry
          createMockError('Server Error', 500), // Retry
          createMockError('Temporary failure'), // Retry
        ];

        const mockFunction = vi.fn(async () => {
          if (attemptCount < errors.length) {
            const error = errors[attemptCount];
            attemptCount++;
            throw error;
          }
          return 'finally succeeded';
        });

        const result = await retryWithBackoff(
          mockFunction,
          getRetryOptionsForAuthType('local'),
        );

        expect(result).toBe('finally succeeded');
        expect(mockFunction).toHaveBeenCalledTimes(4); // 3 failures + 1 success
      });

      it('should handle rapid success after initial failure', async () => {
        let attemptCount = 0;

        const mockFunction = vi.fn(async () => {
          attemptCount++;
          if (attemptCount === 1) {
            throw createMockError('Temporary glitch');
          }
          return 'quick recovery';
        });

        const start = Date.now();
        const result = await retryWithBackoff(
          mockFunction,
          getRetryOptionsForAuthType('local'),
        );
        const duration = Date.now() - start;

        expect(result).toBe('quick recovery');
        expect(mockFunction).toHaveBeenCalledTimes(2);
        expect(duration).toBeGreaterThanOrEqual(1000); // Should include delay
      });
    });

    describe('Quota and rate limiting scenarios', () => {
      it('should handle quota exceeded scenarios for different auth types', async () => {
        // This would need to be mocked more extensively for different quota types
        // For now, test basic quota error handling

        const quotaError = createMockError('Quota exceeded', 429);
        const mockFunction = vi.fn(async () => {
          throw quotaError;
        });

        await expect(retryWithBackoff(mockFunction)).rejects.toThrow(
          'Quota exceeded',
        );
        expect(mockFunction).toHaveBeenCalledTimes(5); // Should retry up to max attempts
      });
    });
  });

  describe('Error Recovery Patterns', () => {
    describe('Graceful degradation', () => {
      it('should handle partial system failures', async () => {
        let systemState = 'degraded';
        let attemptCount = 0;

        const mockFunction = vi.fn(async () => {
          attemptCount++;

          if (systemState === 'degraded' && attemptCount < 3) {
            throw createMockError('System degraded, retrying...');
          } else if (systemState === 'degraded') {
            systemState = 'recovered';
          }

          return `system ${systemState}`;
        });

        const result = await retryWithBackoff(
          mockFunction,
          getRetryOptionsForAuthType('local'),
        );

        expect(result).toBe('system recovered');
        expect(attemptCount).toBe(3);
      });
    });

    describe('Circuit breaker-like behavior', () => {
      it('should stop retrying after consecutive permanent failures', async () => {
        const mockFunction = vi.fn(async () => {
          throw createMockError('Model not found'); // Permanent error
        });

        const config = getRetryOptionsForAuthType('local');

        await expect(retryWithBackoff(mockFunction, config)).rejects.toThrow(
          'Model not found',
        );
        expect(mockFunction).toHaveBeenCalledTimes(1); // Should not retry permanent errors
      });
    });

    describe('Resource exhaustion handling', () => {
      it('should handle memory pressure scenarios', async () => {
        let memoryPressure = true;
        let attemptCount = 0;

        const mockFunction = vi.fn(async () => {
          attemptCount++;

          if (memoryPressure && attemptCount < 2) {
            throw createMockError('Insufficient memory');
          }

          if (attemptCount === 2) {
            memoryPressure = false; // Simulate memory becoming available
            throw createMockError('Connection refused'); // Retryable error
          }

          return 'memory available, operation succeeded';
        });

        const config = getRetryOptionsForAuthType('local');

        // First call should fail on permanent memory error
        await expect(retryWithBackoff(mockFunction, config)).rejects.toThrow(
          'Insufficient memory',
        );
        expect(mockFunction).toHaveBeenCalledTimes(1);

        // Reset for second attempt
        attemptCount = 0;
        memoryPressure = false;
        mockFunction.mockClear();

        const result = await retryWithBackoff(mockFunction, config);
        expect(result).toBe('memory available, operation succeeded');
      });
    });
  });

  describe('Error Logging and Observability', () => {
    it('should provide meaningful error information for debugging', () => {
      const testErrors = [
        { message: 'Connection refused', expected: true },
        { message: 'CUDA out of memory', expected: true },
        { message: 'Model not found', expected: true },
        { message: 'API key invalid', expected: false },
        { message: '', expected: false },
      ];

      testErrors.forEach(({ message, expected }) => {
        const result = isLocalModelError(message);
        expect(result).toBe(expected);

        // Error should provide clear categorization
        if (expected) {
          expect(typeof message).toBe('string');
          expect(message.length).toBeGreaterThan(0);
        }
      });
    });

    it('should handle error objects with additional context', () => {
      const contextError = {
        message: 'Connection refused',
        code: 'ECONNREFUSED',
        errno: -61,
        syscall: 'connect',
        address: '127.0.0.1',
        port: 11434,
      } as any;

      expect(isLocalModelError(contextError)).toBe(true);

      const networkError = new Error('Network error');
      (networkError as any).code = 'ENOTFOUND';
      (networkError as any).hostname = 'localhost';

      expect(isLocalModelError(networkError)).toBe(true);
    });
  });

  describe('Edge cases and regression tests', () => {
    it('should handle malformed error objects', () => {
      const malformedErrors = [
        { message: null, toString: undefined, valueOf: undefined },
        { message: undefined, toString: undefined, valueOf: undefined },
        { toString: () => 'Connection refused', message: undefined, valueOf: undefined },
        { valueOf: () => 'Model not found', message: undefined, toString: undefined },
      ];

      malformedErrors.forEach((error) => {
        expect(() => isLocalModelError(error)).not.toThrow();
      });
    });

    it('should handle very long error messages', () => {
      const longMessage = 'Connection refused '.repeat(1000) + 'to localhost';
      expect(isLocalModelError(longMessage)).toBe(true);

      const veryLongNonError = 'Not an error '.repeat(1000);
      expect(isLocalModelError(veryLongNonError)).toBe(false);
    });

    it('should handle international characters and encodings', () => {
      const internationalErrors = [
        'Connexion refusée (Connection refused)',
        'Модель не найдена (Model not found)',
        '内存不足 (Out of memory)',
        'メモリ不足 (Memory insufficient)',
      ];

      internationalErrors.forEach((error) => {
        expect(isLocalModelError(error)).toBe(true);
      });
    });

    it('should be case-insensitive for all error patterns', () => {
      const caseVariations = [
        ['CONNECTION REFUSED', true],
        ['connection refused', true],
        ['Connection Refused', true],
        ['CoNnEcTiOn ReFuSeD', true],
        ['MODEL NOT FOUND', true],
        ['model not found', true],
        ['Model Not Found', true],
        ['OUT OF MEMORY', true],
        ['out of memory', true],
        ['Out Of Memory', true],
      ];

      caseVariations.forEach(([message, expected]) => {
        expect(isLocalModelError(message as string)).toBe(expected as boolean);
      });
    });
  });
});
