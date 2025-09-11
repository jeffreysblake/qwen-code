/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIContentGenerator } from './openaiContentGenerator.js';
import { ContentGeneratorConfig, AuthType } from './contentGenerator.js';
import { Config } from '../config/config.js';

// Mock dependencies
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

describe('OpenAIContentGenerator Integration Tests', () => {
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

  describe('Local Model Sampling Parameters Integration', () => {
    describe('buildSamplingParameters method', () => {
      it('should prioritize config parameters over local model defaults', async () => {
        const config: ContentGeneratorConfig = {
          model: 'llama-7b',
          baseUrl: 'http://localhost:11434',
          apiKey: 'test',
          authType: AuthType.API_KEY,
          samplingParams: {
            temperature: 0.7,
            top_p: 0.8,
            max_tokens: 1000,
          },
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        // Access private method via type assertion for testing
        const params = (generator as any).buildSamplingParameters({
          model: 'llama-7b',
          config: {},
          contents: [],
        });

        expect(params.temperature).toBe(0.7); // Config value
        expect(params.top_p).toBe(0.8); // Config value
        expect(params.max_tokens).toBe(1000); // Config value
      });

      it('should use request parameters over local model defaults', async () => {
        const config: ContentGeneratorConfig = {
          model: 'qwen2.5-14b',
          baseUrl: 'http://192.168.1.100:8080',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        const params = (generator as any).buildSamplingParameters({
          model: 'qwen2.5-14b',
          config: {
            temperature: 0.5,
            topP: 0.7,
            maxOutputTokens: 800,
          },
          contents: [],
        });

        expect(params.temperature).toBe(0.5); // Request value
        expect(params.top_p).toBe(0.7); // Request value
        expect(params.max_tokens).toBe(800); // Request value
      });

      it('should fall back to local model defaults when no config/request params', async () => {
        const config: ContentGeneratorConfig = {
          model: 'llama3.2:8b',
          baseUrl: 'http://localhost:11434',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        const params = (generator as any).buildSamplingParameters({
          model: 'llama3.2:8b',
          config: {},
          contents: [],
        });

        expect(params.temperature).toBe(0.3); // Local model default
        expect(params.top_p).toBe(0.9); // Local model default
        expect(params.top_k).toBe(40); // Local model default
        expect(params.repetition_penalty).toBe(1.1); // Local model default
      });

      it('should use standard defaults for cloud models', async () => {
        const config: ContentGeneratorConfig = {
          model: 'gpt-4',
          baseUrl: 'https://api.openai.com',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        const params = (generator as any).buildSamplingParameters({
          model: 'gpt-4',
          config: {},
          contents: [],
        });

        expect(params.temperature).toBe(0.0); // Standard default
        expect(params.top_p).toBe(1.0); // Standard default
        expect(params.top_k).toBeUndefined(); // Not set for cloud models
        expect(params.repetition_penalty).toBeUndefined(); // Not set for cloud models
      });

      it('should handle mixed parameter sources correctly', async () => {
        const config: ContentGeneratorConfig = {
          model: 'qwen2.5-7b',
          baseUrl: 'http://localhost:8080',
          apiKey: 'test',
          authType: AuthType.API_KEY,
          samplingParams: {
            temperature: 0.6, // Config overrides
            top_k: 50, // Config overrides
          },
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        const params = (generator as any).buildSamplingParameters({
          model: 'qwen2.5-7b',
          config: {
            topP: 0.85, // Request overrides
            maxOutputTokens: 1200, // Request overrides
          },
          contents: [],
        });

        expect(params.temperature).toBe(0.6); // Config
        expect(params.top_p).toBe(0.85); // Request
        expect(params.top_k).toBe(50); // Config
        expect(params.max_tokens).toBe(1200); // Request
        expect(params.repetition_penalty).toBe(1.1); // Local model default (only source)
      });

      describe('Environment variable handling', () => {
        it('should respect LOCAL_MODEL_MAX_TOKENS in sampling params', async () => {
          process.env['LOCAL_MODEL_MAX_TOKENS'] = '512';

          const config: ContentGeneratorConfig = {
            model: 'llama-7b',
            baseUrl: 'http://localhost:11434',
            apiKey: 'test',
            authType: AuthType.API_KEY,
          };

          const generator = new OpenAIContentGenerator(config, mockConfig);

          const params = (generator as any).buildSamplingParameters({
            model: 'llama-7b',
            config: {},
            contents: [],
          });

          expect(params.max_tokens).toBe(512);
        });

        it('should handle invalid LOCAL_MODEL_MAX_TOKENS gracefully', async () => {
          process.env['LOCAL_MODEL_MAX_TOKENS'] = 'invalid';

          const config: ContentGeneratorConfig = {
            model: 'qwen2.5-14b',
            baseUrl: 'http://localhost:8080',
            apiKey: 'test',
            authType: AuthType.API_KEY,
          };

          const generator = new OpenAIContentGenerator(config, mockConfig);

          const params = (generator as any).buildSamplingParameters({
            model: 'qwen2.5-14b',
            config: {},
            contents: [],
          });

          // Should fall back to default max_tokens from getLocalModelSamplingParams
          expect(params.max_tokens).toBe(1024);
        });
      });

      describe('Type safety for sampling parameters', () => {
        it('should handle undefined values in sampling params object', async () => {
          const config: ContentGeneratorConfig = {
            model: 'llama-7b',
            baseUrl: 'http://localhost:11434',
            apiKey: 'test',
            authType: AuthType.API_KEY,
            samplingParams: {
              temperature: undefined as any,
              top_p: undefined as any,
              max_tokens: undefined as any,
            },
          };

          const generator = new OpenAIContentGenerator(config, mockConfig);

          const params = (generator as any).buildSamplingParameters({
            model: 'llama-7b',
            config: {},
            contents: [],
          });

          // Should fall back to local model defaults when config values are undefined
          expect(params.temperature).toBe(0.3);
          expect(params.top_p).toBe(0.9);
          expect(params.max_tokens).toBe(1024);
        });

        it('should handle null values in request config', async () => {
          const config: ContentGeneratorConfig = {
            model: 'qwen2.5-7b',
            baseUrl: 'http://localhost:8080',
            apiKey: 'test',
            authType: AuthType.API_KEY,
          };

          const generator = new OpenAIContentGenerator(config, mockConfig);

          const params = (generator as any).buildSamplingParameters({
            model: 'qwen2.5-7b',
            config: {
              temperature: null as any,
              topP: null as any,
              maxOutputTokens: null as any,
            },
            contents: [],
          });

          // Should treat null as undefined and fall back appropriately
          expect(params.temperature).toBe(0.3);
          expect(params.top_p).toBe(0.9);
          expect(params.max_tokens).toBe(1024);
        });

        it('should preserve zero values when explicitly set', async () => {
          const config: ContentGeneratorConfig = {
            model: 'llama-7b',
            baseUrl: 'http://localhost:11434',
            apiKey: 'test',
            authType: AuthType.API_KEY,
            samplingParams: {
              temperature: 0, // Explicit zero
            },
          };

          const generator = new OpenAIContentGenerator(config, mockConfig);

          const params = (generator as any).buildSamplingParameters({
            model: 'llama-7b',
            config: {
              topP: 0, // Explicit zero
            },
            contents: [],
          });

          expect(params.temperature).toBe(0); // Should preserve explicit zero
          expect(params.top_p).toBe(0); // Should preserve explicit zero
        });
      });

      describe('Parameter boundary validation', () => {
        it('should handle extreme parameter values', async () => {
          const config: ContentGeneratorConfig = {
            model: 'qwen2.5-14b',
            baseUrl: 'http://localhost:8080',
            apiKey: 'test',
            authType: AuthType.API_KEY,
            samplingParams: {
              temperature: 100, // Extremely high
              top_p: 2.5, // Invalid range
              top_k: -10, // Invalid negative
              max_tokens: 1000000, // Extremely high
            },
          };

          const generator = new OpenAIContentGenerator(config, mockConfig);

          // Should not throw, just pass through (validation happens in OpenAI client)
          expect(() => {
            (generator as any).buildSamplingParameters({
              model: 'qwen2.5-14b',
              config: {},
              contents: [],
            });
          }).not.toThrow();
        });
      });
    });

    describe('Local model detection in constructor', () => {
      it('should initialize concurrency manager for local models', () => {
        const config: ContentGeneratorConfig = {
          model: 'llama-7b',
          baseUrl: 'http://localhost:11434',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        // Check that concurrency manager was initialized
        expect((generator as any).concurrencyManager).toBeDefined();
      });

      it('should not initialize concurrency manager for cloud models', () => {
        const config: ContentGeneratorConfig = {
          model: 'gpt-4',
          baseUrl: 'https://api.openai.com',
          apiKey: 'test',
          authType: AuthType.API_KEY,
        };

        const generator = new OpenAIContentGenerator(config, mockConfig);

        // Check that concurrency manager was not initialized
        expect((generator as any).concurrencyManager).toBeUndefined();
      });

      it('should handle edge cases in model detection during initialization', () => {
        const edgeCases = [
          { model: '', baseUrl: '' },
          { model: 'unknown', baseUrl: 'https://unknown.com' },
          { model: 'gpt-4', baseUrl: 'http://localhost:8080' }, // Cloud model on local URL
          { model: 'llama-7b', baseUrl: 'https://api.openai.com' }, // Local model on cloud URL
        ];

        edgeCases.forEach(({ model, baseUrl }) => {
          expect(() => {
            new OpenAIContentGenerator(
              {
                model,
                baseUrl,
                apiKey: 'test',
                authType: AuthType.API_KEY,
              },
              mockConfig,
            );
          }).not.toThrow();
        });
      });
    });
  });

  describe('Error scenarios that have caused issues before', () => {
    it('should handle missing configuration gracefully', () => {
      expect(() => {
        new OpenAIContentGenerator(
          {
            model: '',
            baseUrl: '',
            apiKey: '',
            authType: AuthType.API_KEY,
          },
          mockConfig,
        );
      }).not.toThrow();
    });

    it('should handle malformed baseUrl in local detection', () => {
      expect(() => {
        new OpenAIContentGenerator(
          {
            model: 'test',
            baseUrl: 'not-a-valid-url',
            apiKey: 'test',
            authType: AuthType.API_KEY,
          },
          mockConfig,
        );
      }).not.toThrow();
    });

    it('should handle undefined samplingParams gracefully', () => {
      const config: ContentGeneratorConfig = {
        model: 'llama-7b',
        baseUrl: 'http://localhost:11434',
        apiKey: 'test',
        authType: AuthType.API_KEY,
        samplingParams: undefined as any,
      };

      expect(() => {
        const generator = new OpenAIContentGenerator(config, mockConfig);
        (generator as any).buildSamplingParameters({
          model: 'llama-7b',
          config: {},
          contents: [],
        });
      }).not.toThrow();
    });

    it('should handle partially defined samplingParams', () => {
      const config: ContentGeneratorConfig = {
        model: 'qwen2.5-7b',
        baseUrl: 'http://localhost:8080',
        apiKey: 'test',
        authType: AuthType.API_KEY,
        samplingParams: {
          temperature: 0.5,
          // Other parameters undefined
        } as any,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      const params = (generator as any).buildSamplingParameters({
        model: 'qwen2.5-7b',
        config: {},
        contents: [],
      });

      expect(params.temperature).toBe(0.5); // From config
      expect(params.top_p).toBe(0.9); // From local defaults
      expect(params.top_k).toBe(40); // From local defaults
    });
  });

  describe('Performance regression tests', () => {
    it('should build sampling parameters efficiently', () => {
      const config: ContentGeneratorConfig = {
        model: 'llama-7b',
        baseUrl: 'http://localhost:11434',
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        (generator as any).buildSamplingParameters({
          model: 'llama-7b',
          config: {},
          contents: [],
        });
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });

    it('should handle constructor efficiently for multiple instances', () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        new OpenAIContentGenerator(
          {
            model: 'llama-7b',
            baseUrl: 'http://localhost:11434',
            apiKey: 'test',
            authType: AuthType.API_KEY,
          },
          mockConfig,
        );
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500); // Should complete in under 500ms
    });
  });

  describe('Backward compatibility tests', () => {
    it('should maintain existing behavior for cloud models', () => {
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
          topP: 0.8,
        },
        contents: [],
      });

      // Should follow original priority: config > request > default
      expect(params.temperature).toBe(0.7); // Config
      expect(params.top_p).toBe(0.9); // Config (overrides request)
      expect(params.top_k).toBeUndefined(); // Not set for cloud models
      expect(params.repetition_penalty).toBeUndefined(); // Not set for cloud models
    });

    it('should not affect existing cloud model configurations', () => {
      const cloudConfigs = [
        { model: 'gpt-4', baseUrl: 'https://api.openai.com' },
        { model: 'gpt-3.5-turbo', baseUrl: 'https://api.openai.com' },
        { model: 'claude-3', baseUrl: 'https://api.anthropic.com' },
        {
          model: 'gemini-pro',
          baseUrl: 'https://generativelanguage.googleapis.com',
        },
      ];

      cloudConfigs.forEach(({ model, baseUrl }) => {
        const generator = new OpenAIContentGenerator(
          {
            model,
            baseUrl,
            apiKey: 'test',
            authType: AuthType.API_KEY,
          },
          mockConfig,
        );

        const params = (generator as any).buildSamplingParameters({
          model,
          config: {},
          contents: [],
        });

        // Should use standard defaults
        expect(params.temperature).toBe(0.0);
        expect(params.top_p).toBe(1.0);
        expect(params.top_k).toBeUndefined();
        expect(params.repetition_penalty).toBeUndefined();
      });
    });
  });

  describe('Real-world scenario tests', () => {
    it('should handle Ollama deployment correctly', () => {
      const config: ContentGeneratorConfig = {
        model: 'llama3.2:8b-instruct-fp16',
        baseUrl: 'http://localhost:11434',
        apiKey: 'ollama', // Ollama doesn't require real API key
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      const params = (generator as any).buildSamplingParameters({
        model: 'llama3.2:8b-instruct-fp16',
        config: {},
        contents: [],
      });

      expect((generator as any).concurrencyManager).toBeDefined();
      expect(params.temperature).toBe(0.3);
      expect(params.repetition_penalty).toBe(1.1);
    });

    it('should handle local GPU server deployment', () => {
      const config: ContentGeneratorConfig = {
        model: 'qwen2.5-32b-instruct-awq',
        baseUrl: 'http://192.168.1.50:8000',
        apiKey: 'none',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      const params = (generator as any).buildSamplingParameters({
        model: 'qwen2.5-32b-instruct-awq',
        config: {},
        contents: [],
      });

      expect((generator as any).concurrencyManager).toBeDefined();
      expect(params.max_tokens).toBeLessThanOrEqual(2048); // Capped for safety
    });

    it('should handle mixed deployment with override', () => {
      // Scenario: Using local model name but cloud provider URL (e.g., via proxy)
      const config: ContentGeneratorConfig = {
        model: 'llama-70b-chat',
        baseUrl: 'https://my-proxy.com/v1', // Cloud-like URL
        apiKey: 'test',
        authType: AuthType.API_KEY,
      };

      const generator = new OpenAIContentGenerator(config, mockConfig);

      const params = (generator as any).buildSamplingParameters({
        model: 'llama-70b-chat',
        config: {},
        contents: [],
      });

      // Should detect as local due to model name and apply optimizations
      expect((generator as any).concurrencyManager).toBeDefined();
      expect(params.temperature).toBe(0.3);
      expect(params.repetition_penalty).toBe(1.1);
    });
  });
});
