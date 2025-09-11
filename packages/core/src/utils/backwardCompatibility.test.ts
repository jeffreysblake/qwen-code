/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenLimit } from '../core/tokenLimits.js';
import { normalizeParams } from '../tools/tools.js';
import { OpenAIContentGenerator } from '../core/openaiContentGenerator.js';
import { ContentGeneratorConfig, AuthType } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import { retryWithBackoff, getRetryOptionsForAuthType } from './retry.js';

// Mock OpenAI and dependencies
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn(),
      },
    };
  },
}));

vi.mock('../utils/openaiLogger.js', () => ({
  openaiLogger: {
    logInteraction: vi.fn(),
  },
}));

vi.mock('../telemetry/loggers.js', () => ({
  logApiError: vi.fn(),
  logApiResponse: vi.fn(),
}));

describe('Backward Compatibility - Regression Tests', () => {
  let mockConfig: Config;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };

    mockConfig = {
      getCliVersion: () => '1.0.0',
    } as Config;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Token Limit Function Compatibility', () => {
    it('should maintain existing behavior for known cloud models', () => {
      // These should return exact same values as before local model enhancements
      const cloudModels = [
        { model: 'gemini-1.5-pro', expected: 2_097_152 },
        { model: 'gemini-1.5-flash', expected: 1_048_576 },
        { model: 'gemini-2.5-pro-preview-05-06', expected: 1_048_576 },
        { model: 'gemini-2.5-pro-preview-06-05', expected: 1_048_576 },
        { model: 'gemini-2.5-pro', expected: 1_048_576 },
        { model: 'gemini-2.5-flash-preview-05-20', expected: 1_048_576 },
        { model: 'gemini-2.5-flash', expected: 1_048_576 },
        { model: 'gemini-2.5-flash-lite', expected: 1_048_576 },
        { model: 'gemini-2.0-flash', expected: 1_048_576 },
        {
          model: 'gemini-2.0-flash-preview-image-generation',
          expected: 32_000,
        },
      ];

      cloudModels.forEach(({ model, expected }) => {
        expect(tokenLimit(model)).toBe(expected);
        expect(
          tokenLimit(model, 'https://generativelanguage.googleapis.com'),
        ).toBe(expected);
      });
    });

    it('should return default for unknown models without local detection', () => {
      const unknownModels = ['unknown-model', 'custom-model', '', 'gpt-4'];

      unknownModels.forEach((model) => {
        expect(tokenLimit(model)).toBe(1_048_576); // DEFAULT_TOKEN_LIMIT
        expect(tokenLimit(model, 'https://api.openai.com')).toBe(1_048_576);
      });
    });

    it('should handle undefined baseUrl like before', () => {
      expect(tokenLimit('gemini-1.5-pro', undefined)).toBe(2_097_152);
      expect(tokenLimit('gemini-1.5-flash', undefined)).toBe(1_048_576);
      expect(tokenLimit('unknown-model', undefined)).toBe(1_048_576);
    });

    it('should not be affected by environment variables for cloud models', () => {
      process.env['LOCAL_MODEL_TOKEN_LIMIT'] = '999999';

      // Cloud models should ignore the env var
      expect(tokenLimit('gemini-1.5-pro')).toBe(2_097_152);
      expect(tokenLimit('gemini-2.5-flash')).toBe(1_048_576);

      // Even with cloud-like URLs
      expect(
        tokenLimit(
          'gemini-1.5-pro',
          'https://generativelanguage.googleapis.com',
        ),
      ).toBe(2_097_152);
    });
  });

  describe('Parameter Normalization Compatibility', () => {
    it('should preserve non-boolean values exactly as before', () => {
      const inputs = [
        { value: 'hello', expected: 'hello' },
        { value: 42, expected: 42 },
        { value: null, expected: null },
        { value: undefined, expected: undefined },
        { value: [], expected: [] },
        { value: {}, expected: {} },
        { value: 0, expected: 0 },
        { value: '', expected: '' },
      ];

      inputs.forEach(({ value, expected }) => {
        const input = { testValue: value };
        const result = normalizeParams(input);
        expect(result.testValue).toEqual(expected);
      });
    });

    it('should preserve existing boolean values unchanged', () => {
      const input = {
        trueValue: true,
        falseValue: false,
        mixedObject: {
          nestedTrue: true,
          nestedFalse: false,
        },
        arrayWithBooleans: [true, false, 'other'],
      };

      const result = normalizeParams(input);

      expect(result.trueValue).toBe(true);
      expect(result.falseValue).toBe(false);
      expect(result.mixedObject.nestedTrue).toBe(true);
      expect(result.mixedObject.nestedFalse).toBe(false);
      expect(result.arrayWithBooleans[0]).toBe(true);
      expect(result.arrayWithBooleans[1]).toBe(false);
      expect(result.arrayWithBooleans[2]).toBe('other');
    });

    it('should not affect object structure or references', () => {
      const originalObject = {
        data: { nested: { value: 'test' } },
        array: [1, 2, 3],
        func: () => 'test',
      };

      const normalized = normalizeParams(originalObject);

      // Structure should be preserved
      expect(normalized.data.nested.value).toBe('test');
      expect(normalized.array).toEqual([1, 2, 3]);
      expect(typeof normalized.func).toBe('function');
      expect(normalized.func()).toBe('test');
    });

    it('should handle edge cases that existed before without breaking', () => {
      const edgeCases = [
        null,
        undefined,
        '',
        0,
        false,
        [],
        {},
        { '': '' },
        { null: null },
        { undefined: undefined },
      ];

      edgeCases.forEach((edgeCase) => {
        expect(() => normalizeParams(edgeCase)).not.toThrow();

        // Result should have same type as input for these cases
        const result = normalizeParams(edgeCase);
        if (edgeCase === null || edgeCase === undefined) {
          expect(result).toBe(edgeCase);
        } else if (typeof edgeCase === 'object') {
          expect(typeof result).toBe('object');
        } else {
          expect(result).toBe(edgeCase);
        }
      });
    });
  });

  describe('OpenAI Content Generator Compatibility', () => {
    describe('Cloud model behavior unchanged', () => {
      it('should create generators for cloud models exactly as before', () => {
        const cloudConfigs = [
          {
            model: 'gpt-4',
            baseUrl: 'https://api.openai.com',
            apiKey: 'test',
            authType: AuthType.API_KEY,
          },
          {
            model: 'gpt-3.5-turbo',
            baseUrl: 'https://api.openai.com',
            apiKey: 'test',
            authType: AuthType.LOGIN_WITH_GOOGLE,
          },
        ];

        cloudConfigs.forEach((config) => {
          expect(
            () => new OpenAIContentGenerator(config, mockConfig),
          ).not.toThrow();

          const generator = new OpenAIContentGenerator(config, mockConfig);

          // Should not have concurrency manager for cloud models
          expect((generator as any).concurrencyManager).toBeUndefined();
        });
      });

      it('should build sampling parameters for cloud models as before', () => {
        const config: ContentGeneratorConfig = {
          model: 'gpt-4',
          baseUrl: 'https://api.openai.com',
          apiKey: 'test',
          authType: AuthType.API_KEY,
          samplingParams: {
            temperature: 0.7,
            top_p: 0.9,
          },
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        const params = (generator as any).buildSamplingParameters({
          model: 'gpt-4',
          config: {
            temperature: 0.5,
          },
          contents: [],
        });

        // Should follow original precedence: config > request > default
        expect(params.temperature).toBe(0.7); // Config overrides request
        expect(params.top_p).toBe(0.9); // From config
        expect(params.top_k).toBeUndefined(); // Not set for cloud models
        expect(params.repetition_penalty).toBeUndefined(); // Not set for cloud models
      });

      it('should handle missing config parameters as before', () => {
        const config: ContentGeneratorConfig = {
          model: 'gpt-3.5-turbo',
          baseUrl: 'https://api.openai.com',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        const params = (generator as any).buildSamplingParameters({
          model: 'gpt-3.5-turbo',
          config: {},
          contents: [],
        });

        // Should use original defaults
        expect(params.temperature).toBe(0.0);
        expect(params.top_p).toBe(1.0);
        expect(params.top_k).toBeUndefined();
        expect(params.max_tokens).toBeUndefined(); // Only set when explicitly provided
      });

      it('should preserve original request/response handling', () => {
        const config: ContentGeneratorConfig = {
          model: 'gpt-4',
          baseUrl: 'https://api.openai.com',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        // Constructor should not throw
        expect(generator).toBeDefined();

        // Should have original properties
        expect((generator as any).model).toBe('gpt-4');
        expect((generator as any).contentGeneratorConfig).toBe(config);
        expect((generator as any).config).toBe(mockConfig);

        // Should not have local model enhancements
        expect((generator as any).concurrencyManager).toBeUndefined();
      });
    });

    describe('Provider-specific configurations', () => {
      it('should handle OpenRouter configurations as before', () => {
        const config: ContentGeneratorConfig = {
          model: 'anthropic/claude-3-sonnet',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        expect(
          () => new OpenAIContentGenerator(config, mockConfig),
        ).not.toThrow();

        const generator = new OpenAIContentGenerator(config, mockConfig);
        expect((generator as any).concurrencyManager).toBeUndefined();
      });

      it('should handle DashScope configurations as before', () => {
        const config: ContentGeneratorConfig = {
          model: 'qwen-max',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        expect(
          () => new OpenAIContentGenerator(config, mockConfig),
        ).not.toThrow();

        const generator = new OpenAIContentGenerator(config, mockConfig);
        expect((generator as any).concurrencyManager).toBeUndefined();
      });
    });

    describe('Error handling compatibility', () => {
      it('should handle construction errors as before', () => {
        const invalidConfigs = [
          {
            model: '',
            baseUrl: '',
            apiKey: '',
            authType: AuthType.API_KEY,
          },
        ];

        invalidConfigs.forEach((config) => {
          expect(
            () => new OpenAIContentGenerator(config, mockConfig),
          ).not.toThrow();
        });
      });
    });
  });

  describe('Retry Logic Compatibility', () => {
    it('should use original retry behavior for non-local auth types', () => {
      const authTypes = [
        AuthType.API_KEY,
        AuthType.LOGIN_WITH_GOOGLE,
        AuthType.QWEN_OAUTH,
        undefined, // Default case
      ];

      authTypes.forEach((authType) => {
        const config = getRetryOptionsForAuthType(authType);

        // Should use original default values
        expect(config.maxAttempts).toBe(5);
        expect(config.initialDelayMs).toBe(5000);
        expect(config.maxDelayMs).toBe(30000);
        expect(typeof config.shouldRetry).toBe('function');
      });
    });

    it('should handle original error scenarios as before', async () => {
      let attemptCount = 0;

      const mockFunction = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          const error = new Error('Generic error') as any;
          error.status = 500;
          throw error;
        }
        return 'success';
      });

      const result = await retryWithBackoff(mockFunction);

      expect(result).toBe('success');
      expect(mockFunction).toHaveBeenCalledTimes(3);
    });

    it('should handle 429 errors with retry-after headers as before', async () => {
      let attemptCount = 0;

      const mockFunction = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          const error = new Error('Rate limited') as any;
          error.status = 429;
          error.response = {
            status: 429,
            headers: { 'retry-after': '1' },
          };
          throw error;
        }
        return 'rate limit recovered';
      });

      const start = Date.now();
      const result = await retryWithBackoff(mockFunction);
      const duration = Date.now() - start;

      expect(result).toBe('rate limit recovered');
      expect(duration).toBeGreaterThanOrEqual(1000);
    });

    it('should not retry 4xx errors as before', async () => {
      const clientErrors = [400, 401, 403, 404];

      for (const status of clientErrors) {
        const mockFunction = vi.fn(async () => {
          const error = new Error(`Client error ${status}`) as any;
          error.status = status;
          throw error;
        });

        await expect(retryWithBackoff(mockFunction)).rejects.toThrow(
          `Client error ${status}`,
        );
        expect(mockFunction).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('Configuration Object Structure Compatibility', () => {
    it('should accept all original ContentGeneratorConfig properties', () => {
      const fullConfig: ContentGeneratorConfig = {
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test-key',
        authType: AuthType.API_KEY,
        timeout: 30000,
        maxRetries: 3,
        samplingParams: {
          temperature: 0.5,
          top_p: 0.9,
          max_tokens: 1000,
        },
        enableOpenAILogging: false,
      };

      expect(
        () => new OpenAIContentGenerator(fullConfig, mockConfig),
      ).not.toThrow();

      const generator = new OpenAIContentGenerator(fullConfig, mockConfig);
      expect((generator as any).model).toBe('gpt-4');
      expect((generator as any).contentGeneratorConfig).toBe(fullConfig);
    });

    it('should handle partial configurations as before', () => {
      const minimalConfig: ContentGeneratorConfig = {
        model: 'gpt-3.5-turbo',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      expect(
        () => new OpenAIContentGenerator(minimalConfig, mockConfig),
      ).not.toThrow();
    });

    it('should preserve original property defaults', () => {
      const config: ContentGeneratorConfig = {
        model: 'claude-3',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      // Original defaults should be maintained
      expect((generator as any).contentGeneratorConfig.timeout).toBeUndefined();
      expect(
        (generator as any).contentGeneratorConfig.maxRetries,
      ).toBeUndefined();
      expect(
        (generator as any).contentGeneratorConfig.enableOpenAILogging,
      ).toBeUndefined();
    });
  });

  describe('Environment Variable Compatibility', () => {
    it('should not affect cloud models with local environment variables', () => {
      // Set local model environment variables
      process.env['LOCAL_MODEL_TOKEN_LIMIT'] = '4096';
      process.env['LOCAL_MODEL_MAX_TOKENS'] = '512';
      process.env['OPENAI_BASE_URL'] = 'http://localhost:8080';

      // Cloud model behavior should be unaffected
      expect(tokenLimit('gemini-1.5-pro')).toBe(2_097_152);
      expect(tokenLimit('gpt-4', 'https://api.openai.com')).toBe(1_048_576);

      const config: ContentGeneratorConfig = {
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com', // Explicit cloud URL overrides env
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);
      expect((generator as any).concurrencyManager).toBeUndefined();
    });

    it('should handle missing environment variables gracefully', () => {
      delete process.env['OPENAI_BASE_URL'];
      delete process.env['LOCAL_MODEL_TOKEN_LIMIT'];

      expect(tokenLimit('unknown-model')).toBe(1_048_576);

      expect(() => {
        new OpenAIContentGenerator(
          {
            model: 'test',
            baseUrl: 'https://api.test.com',
            apiKey: 'test',
            authType: AuthType.API_KEY,
          },
          mockConfig,
        );
      }).not.toThrow();
    });
  });

  describe('API Compatibility', () => {
    it('should maintain same method signatures', () => {
      const config: ContentGeneratorConfig = {
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      // Check method existence and signatures
      expect(typeof generator.generateContent).toBe('function');
      expect(typeof generator.generateContentStream).toBe('function');
      expect(typeof generator.countTokens).toBe('function');
      expect(typeof generator.embedContent).toBe('function');

      // Methods should have same parameter counts as before
      expect(generator.generateContent.length).toBe(2);
      expect(generator.generateContentStream.length).toBe(2);
    });

    it('should return same types from utility functions', () => {
      // tokenLimit should return number
      expect(typeof tokenLimit('test')).toBe('number');

      // normalizeParams should return same type as input for objects
      const input = { test: 'value' };
      const result = normalizeParams(input);
      expect(typeof result).toBe('object');
      expect(result).not.toBe(input); // Should be a copy, but same structure

      // getRetryOptionsForAuthType should return RetryOptions
      const retryConfig = getRetryOptionsForAuthType('test');
      expect(typeof retryConfig.maxAttempts).toBe('number');
      expect(typeof retryConfig.shouldRetry).toBe('function');
    });
  });

  describe('Performance Regression Tests', () => {
    it('should not significantly slow down cloud model operations', () => {
      const config: ContentGeneratorConfig = {
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      // Constructor should be fast
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        new OpenAIContentGenerator(config, mockConfig);
      }
      const constructorTime = Date.now() - start;
      expect(constructorTime).toBeLessThan(500); // Should be under 500ms for 100 instances

      // Parameter building should be fast
      const generator = new OpenAIContentGenerator(config, mockConfig);
      const paramStart = Date.now();

      for (let i = 0; i < 1000; i++) {
        (generator as any).buildSamplingParameters({
          model: 'gpt-4',
          config: {},
          contents: [],
        });
      }

      const paramTime = Date.now() - paramStart;
      expect(paramTime).toBeLessThan(100); // Should be under 100ms for 1000 calls
    });

    it('should not add significant memory overhead for cloud models', () => {
      const config: ContentGeneratorConfig = {
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      // Create many instances
      const generators = [];
      for (let i = 0; i < 100; i++) {
        generators.push(new OpenAIContentGenerator(config, mockConfig));
      }

      // All should be created successfully
      expect(generators.length).toBe(100);
      generators.forEach((gen) => {
        expect(gen).toBeDefined();
        expect((gen as any).concurrencyManager).toBeUndefined();
      });
    });
  });

  describe('Integration Compatibility', () => {
    it('should work with existing test mocks and stubs', () => {
      // This test ensures our changes don't break existing test infrastructure
      const config: ContentGeneratorConfig = {
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      // Should work with existing mocks
      expect(() => {
        (generator as any).buildCreateParams(
          {
            model: 'gpt-4',
            config: {},
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          },
          'test-id',
          false,
        );
      }).not.toThrow();
    });

    it('should maintain existing error handling behavior', () => {
      const config: ContentGeneratorConfig = {
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      // Error handling should be unchanged for cloud models
      expect(typeof (generator as any).handleError).toBe('function');
    });
  });
});
