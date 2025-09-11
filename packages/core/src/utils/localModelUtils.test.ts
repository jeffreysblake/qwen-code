/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isLocalModel,
  getLocalModelTokenLimit,
  detectLocalModelCapabilities,
  getCompressionThreshold,
  getLocalModelSamplingParams,
  LocalModelMonitor,
  isLocalModelError,
  getLocalModelRetryConfig,
} from './localModelUtils.js';

describe('LocalModelUtils', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isLocalModel', () => {
    describe('URL-based detection', () => {
      it('should detect localhost URLs', () => {
        expect(isLocalModel('http://localhost:8080', 'gpt-4')).toBe(true);
        expect(isLocalModel('https://localhost:11434', 'llama')).toBe(true);
      });

      it('should detect 127.0.0.1 URLs', () => {
        expect(isLocalModel('http://127.0.0.1:8000', 'model')).toBe(true);
        expect(isLocalModel('https://127.0.0.1:1234', 'test')).toBe(true);
      });

      it('should detect private IP ranges', () => {
        expect(isLocalModel('http://192.168.1.100:8080', 'model')).toBe(true);
        expect(isLocalModel('http://10.0.0.50:11434', 'model')).toBe(true);
        expect(isLocalModel('http://172.16.0.100:8000', 'model')).toBe(true);
      });

      it('should detect common local ports even without explicit IP', () => {
        expect(isLocalModel('http://myserver:11434', 'model')).toBe(true);
        expect(isLocalModel('https://server:1234', 'model')).toBe(true);
        expect(isLocalModel('http://gpu-box:8080', 'model')).toBe(true);
      });

      it('should handle environment variable fallback', () => {
        process.env['OPENAI_BASE_URL'] = 'http://localhost:8080';
        expect(isLocalModel(undefined, 'gpt-4')).toBe(true);

        process.env['OPENAI_BASE_URL'] = 'https://api.openai.com';
        expect(isLocalModel(undefined, 'gpt-4')).toBe(false);
      });

      it('should handle case insensitive URLs', () => {
        expect(isLocalModel('HTTP://LOCALHOST:8080', 'model')).toBe(true);
        expect(isLocalModel('HTTPS://127.0.0.1:1234', 'model')).toBe(true);
      });

      it('should not detect cloud provider URLs', () => {
        expect(isLocalModel('https://api.openai.com', 'gpt-4')).toBe(false);
        expect(isLocalModel('https://api.anthropic.com', 'claude')).toBe(false);
        expect(
          isLocalModel('https://generativelanguage.googleapis.com', 'gemini'),
        ).toBe(false);
        expect(isLocalModel('https://dashscope.aliyuncs.com', 'qwen')).toBe(
          false,
        );
      });
    });

    describe('Model name-based detection', () => {
      it('should detect common local model names', () => {
        expect(isLocalModel('https://api.openai.com', 'llama-7b')).toBe(true);
        expect(isLocalModel('https://api.openai.com', 'qwen2.5-72b')).toBe(
          true,
        );
        expect(isLocalModel('https://api.openai.com', 'mistral-large')).toBe(
          true,
        );
        expect(
          isLocalModel('https://api.openai.com', 'codellama-instruct'),
        ).toBe(true);
        expect(isLocalModel('https://api.openai.com', 'ollama/llama3')).toBe(
          true,
        );
      });

      it('should handle case insensitive model names', () => {
        expect(isLocalModel('https://api.openai.com', 'LLAMA-7B')).toBe(true);
        expect(isLocalModel('https://api.openai.com', 'Qwen2.5-Chat')).toBe(
          true,
        );
        expect(isLocalModel('https://api.openai.com', 'LOCAL-MODEL')).toBe(
          true,
        );
      });

      it('should not detect cloud model names', () => {
        expect(isLocalModel('https://api.openai.com', 'gpt-4')).toBe(false);
        expect(isLocalModel('https://api.openai.com', 'gpt-3.5-turbo')).toBe(
          false,
        );
        expect(isLocalModel('https://api.openai.com', 'claude-3')).toBe(false);
        expect(isLocalModel('https://api.openai.com', 'gemini-pro')).toBe(
          false,
        );
      });
    });

    describe('Combined detection logic', () => {
      it('should return true if either URL or model indicates local', () => {
        expect(isLocalModel('http://localhost:8080', 'gpt-4')).toBe(true);
        expect(isLocalModel('https://api.openai.com', 'llama-7b')).toBe(true);
        expect(isLocalModel('http://localhost:8080', 'llama-7b')).toBe(true);
      });

      it('should return false only if both URL and model indicate non-local', () => {
        expect(isLocalModel('https://api.openai.com', 'gpt-4')).toBe(false);
        expect(isLocalModel('https://api.anthropic.com', 'claude-3')).toBe(
          false,
        );
      });
    });

    describe('Edge cases and error handling', () => {
      it('should handle undefined/null inputs gracefully', () => {
        expect(isLocalModel(undefined, undefined)).toBe(false);
        expect(isLocalModel(null as any, null as any)).toBe(false);
        expect(isLocalModel('', '')).toBe(false);
      });

      it('should handle malformed URLs', () => {
        expect(isLocalModel('not-a-url', 'model')).toBe(false);
        expect(isLocalModel('://malformed', 'model')).toBe(false);
        expect(isLocalModel('ftp://localhost:8080', 'model')).toBe(true); // Should still detect localhost
      });

      it('should handle empty environment variables', () => {
        process.env['OPENAI_BASE_URL'] = '';
        expect(isLocalModel(undefined, 'gpt-4')).toBe(false);

        delete process.env['OPENAI_BASE_URL'];
        expect(isLocalModel(undefined, 'gpt-4')).toBe(false);
      });
    });
  });

  describe('getLocalModelTokenLimit', () => {
    it('should respect environment variable override', () => {
      process.env['LOCAL_MODEL_TOKEN_LIMIT'] = '16384';
      expect(getLocalModelTokenLimit('any-model')).toBe(16384);

      process.env['LOCAL_MODEL_TOKEN_LIMIT'] = '32768';
      expect(getLocalModelTokenLimit('llama-7b')).toBe(32768);
    });

    it('should handle invalid environment variable values', () => {
      process.env['LOCAL_MODEL_TOKEN_LIMIT'] = 'not-a-number';
      expect(getLocalModelTokenLimit('llama-7b')).toBe(4096); // Should fall back to model-specific limit

      process.env['LOCAL_MODEL_TOKEN_LIMIT'] = '0';
      expect(getLocalModelTokenLimit('llama-7b')).toBe(4096); // Should reject 0

      process.env['LOCAL_MODEL_TOKEN_LIMIT'] = '-1000';
      expect(getLocalModelTokenLimit('llama-7b')).toBe(4096); // Should reject negative
    });

    it('should return model-specific limits based on size', () => {
      // Large models
      expect(getLocalModelTokenLimit('qwen2.5-72b-instruct')).toBe(32768);
      expect(getLocalModelTokenLimit('llama-70b-chat')).toBe(32768);

      // Medium-large models
      expect(getLocalModelTokenLimit('qwen2.5-32b')).toBe(16384);
      expect(getLocalModelTokenLimit('llama-30b')).toBe(16384);

      // Medium models
      expect(getLocalModelTokenLimit('qwen2.5-14b')).toBe(8192);
      expect(getLocalModelTokenLimit('llama-13b')).toBe(8192);

      // Small models
      expect(getLocalModelTokenLimit('qwen2.5-7b')).toBe(4096);
      expect(getLocalModelTokenLimit('llama-7b')).toBe(4096);

      // Very small models
      expect(getLocalModelTokenLimit('qwen2.5-3b')).toBe(2048);
      expect(getLocalModelTokenLimit('qwen2.5-1.5b')).toBe(2048);
    });

    it('should handle case insensitive model names', () => {
      expect(getLocalModelTokenLimit('QWEN2.5-72B-INSTRUCT')).toBe(32768);
      expect(getLocalModelTokenLimit('Llama-7B-Chat')).toBe(4096);
    });

    it('should return conservative default for unknown models', () => {
      expect(getLocalModelTokenLimit('unknown-model')).toBe(8192);
      expect(getLocalModelTokenLimit('custom-finetune')).toBe(8192);
      expect(getLocalModelTokenLimit('')).toBe(8192);
    });

    describe('Model pattern matching accuracy', () => {
      it('should not be confused by partial matches', () => {
        expect(getLocalModelTokenLimit('not-llama-70b-but-7b')).toBe(4096); // Should match 7b, not 70b
        expect(getLocalModelTokenLimit('qwen2.5-7b-based-on-14b')).toBe(4096); // Should match 7b, not 14b
      });

      it('should handle versioned model names', () => {
        expect(getLocalModelTokenLimit('qwen2.5-72b-instruct-v1.2')).toBe(
          32768,
        );
        expect(getLocalModelTokenLimit('llama-7b-chat-v2')).toBe(4096);
      });
    });
  });

  describe('detectLocalModelCapabilities', () => {
    it('should return configuration based on available memory', () => {
      const config = detectLocalModelCapabilities();

      expect(config).toHaveProperty('maxConcurrentRequests');
      expect(config).toHaveProperty('adaptiveTimeout', true);
      expect(config).toHaveProperty('memoryConstraints');
      expect(config.memoryConstraints).toHaveProperty(
        'aggressiveCompression',
        true,
      );

      expect(typeof config.maxConcurrentRequests).toBe('number');
      expect(config.maxConcurrentRequests).toBeGreaterThan(0);
      expect(config.maxConcurrentRequests).toBeLessThanOrEqual(4);
    });

    it('should detect GPU availability from environment', () => {
      process.env['CUDA_VISIBLE_DEVICES'] = '0';
      const config = detectLocalModelCapabilities();

      expect(config.hardwareOptimization).toBeDefined();
      expect(config.hardwareOptimization?.useGPU).toBe(true);
      expect(config.hardwareOptimization?.batchSize).toBe(8);

      delete process.env['CUDA_VISIBLE_DEVICES'];
    });

    it('should handle different memory scenarios', () => {
      // This test is more observational since we can't easily mock process.memoryUsage()
      const config = detectLocalModelCapabilities();

      // Ensure memory constraints are set appropriately
      expect(config.memoryConstraints?.maxContextSize).toBeGreaterThan(0);
      expect(config.memoryConstraints?.maxContextSize).toBeLessThanOrEqual(
        16384,
      );
    });
  });

  describe('getCompressionThreshold', () => {
    it('should return conservative threshold for cloud models', () => {
      expect(getCompressionThreshold(false)).toBe(0.9);
    });

    it('should return more aggressive threshold for local models', () => {
      const threshold = getCompressionThreshold(true);
      expect(threshold).toBeGreaterThan(0);
      expect(threshold).toBeLessThan(0.9);
    });

    it('should adjust threshold based on memory pressure', () => {
      // This is hard to test directly, but we can ensure it returns valid values
      const threshold = getCompressionThreshold(true);
      expect(threshold).toBeGreaterThan(0.2);
      expect(threshold).toBeLessThan(0.7);
    });
  });

  describe('getLocalModelSamplingParams', () => {
    it('should return optimized parameters for local models', () => {
      const params = getLocalModelSamplingParams();

      expect(params).toHaveProperty('temperature', 0.3);
      expect(params).toHaveProperty('top_p', 0.9);
      expect(params).toHaveProperty('top_k', 40);
      expect(params).toHaveProperty('repetition_penalty', 1.1);
      expect(params).toHaveProperty('max_tokens');

      expect(typeof params['max_tokens']).toBe('number');
      expect(params['max_tokens'] as number).toBeGreaterThan(0);
      expect(params['max_tokens'] as number).toBeLessThanOrEqual(2048);
    });

    it('should respect environment variable for max tokens', () => {
      process.env['LOCAL_MODEL_MAX_TOKENS'] = '512';
      const params = getLocalModelSamplingParams();

      expect(params['max_tokens']).toBe(512);

      process.env['LOCAL_MODEL_MAX_TOKENS'] = '4000'; // Should be capped at 2048
      const params2 = getLocalModelSamplingParams();
      expect(params2['max_tokens']).toBe(2048);
    });

    it('should handle invalid environment variable for max tokens', () => {
      process.env['LOCAL_MODEL_MAX_TOKENS'] = 'invalid';
      const params = getLocalModelSamplingParams();

      expect(params['max_tokens']).toBe(1024); // Should fall back to default
    });
  });

  describe('LocalModelMonitor', () => {
    let monitor: LocalModelMonitor;

    beforeEach(() => {
      monitor = new LocalModelMonitor();
    });

    it('should track response times correctly', () => {
      monitor.recordRequest();
      monitor.recordResponseTime(1000);
      monitor.recordResponseTime(2000);

      const metrics = monitor.getMetrics();
      expect(metrics.responseTime).toBe(1500); // Average of 1000 and 2000
    });

    it('should track error rates correctly', () => {
      monitor.recordRequest();
      monitor.recordRequest();
      monitor.recordError();

      const metrics = monitor.getMetrics();
      expect(metrics.errorRate).toBe(0.5); // 1 error out of 2 requests
    });

    it('should limit response time history to 100 entries', () => {
      for (let i = 0; i < 150; i++) {
        monitor.recordResponseTime(i);
      }

      const metrics = monitor.getMetrics();
      // Should be average of last 100 entries (50-149)
      expect(metrics.responseTime).toBeCloseTo(99.5, 1);
    });

    it('should calculate token throughput heuristically', () => {
      monitor.recordResponseTime(1000); // 1 second

      const metrics = monitor.getMetrics();
      expect(metrics.tokenThroughput).toBe(100); // 100 tokens per second heuristic
    });

    it('should suggest configuration adjustment for poor performance', () => {
      // High error rate
      for (let i = 0; i < 10; i++) {
        monitor.recordRequest();
        monitor.recordError();
      }

      expect(monitor.shouldAdjustConfiguration()).toBe(true);

      // Reset and test high response time
      monitor = new LocalModelMonitor();
      monitor.recordResponseTime(35000); // 35 seconds

      expect(monitor.shouldAdjustConfiguration()).toBe(true);
    });
  });

  describe('isLocalModelError', () => {
    it('should detect connection errors', () => {
      expect(isLocalModelError(new Error('Connection refused'))).toBe(true);
      expect(isLocalModelError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isLocalModelError('connection refused')).toBe(true);
    });

    it('should detect model loading errors', () => {
      expect(isLocalModelError(new Error('Model not loaded'))).toBe(true);
      expect(isLocalModelError(new Error('Model not found'))).toBe(true);
      expect(isLocalModelError('model loading')).toBe(true);
    });

    it('should detect memory errors', () => {
      expect(isLocalModelError(new Error('Out of memory'))).toBe(true);
      expect(isLocalModelError(new Error('CUDA out of memory'))).toBe(true);
    });

    it('should detect timeout and context errors', () => {
      expect(isLocalModelError(new Error('Inference timeout'))).toBe(true);
      expect(isLocalModelError(new Error('Context length exceeded'))).toBe(
        true,
      );
      expect(isLocalModelError('token limit exceeded')).toBe(true);
    });

    it('should handle case insensitive matching', () => {
      expect(isLocalModelError(new Error('CONNECTION REFUSED'))).toBe(true);
      expect(isLocalModelError(new Error('Model Not Found'))).toBe(true);
    });

    it('should not detect non-local errors', () => {
      expect(isLocalModelError(new Error('API key invalid'))).toBe(false);
      expect(isLocalModelError(new Error('Rate limit exceeded'))).toBe(false);
      expect(isLocalModelError('Unauthorized')).toBe(false);
    });
  });

  describe('getLocalModelRetryConfig', () => {
    it('should return optimized retry configuration', () => {
      const config = getLocalModelRetryConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.initialDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(8000);
      expect(config.backoffMultiplier).toBe(1.5);
      expect(typeof config.shouldRetry).toBe('function');
    });

    it('should not retry permanent local model failures', () => {
      const config = getLocalModelRetryConfig();

      expect(config.shouldRetry(new Error('Out of memory'))).toBe(false);
      expect(config.shouldRetry(new Error('Model not found'))).toBe(false);
      expect(config.shouldRetry(new Error('Context length exceeded'))).toBe(
        false,
      );
    });

    it('should retry transient local model failures', () => {
      const config = getLocalModelRetryConfig();

      expect(config.shouldRetry(new Error('Connection refused'))).toBe(true);
      expect(config.shouldRetry(new Error('Model loading'))).toBe(true);
      expect(config.shouldRetry(new Error('Inference timeout'))).toBe(true);
    });

    it('should use default retry logic for non-local errors', () => {
      const config = getLocalModelRetryConfig();

      expect(config.shouldRetry(new Error('Some other error'))).toBe(true);
      expect(config.shouldRetry('Random error')).toBe(true);
    });
  });

  describe('Performance and stress testing', () => {
    it('should handle rapid detection calls efficiently', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        isLocalModel('http://localhost:8080', 'llama-7b');
        getLocalModelTokenLimit('qwen2.5-14b');
        getLocalModelSamplingParams();
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });

    it('should handle concurrent monitor operations', () => {
      const monitor = new LocalModelMonitor();

      // Simulate concurrent operations
      const promises = Array.from({ length: 100 }, (_, i) => {
        return Promise.resolve().then(() => {
          monitor.recordRequest();
          monitor.recordResponseTime(i * 10);
          if (i % 10 === 0) monitor.recordError();
        });
      });

      return Promise.all(promises).then(() => {
        const metrics = monitor.getMetrics();
        expect(metrics.responseTime).toBeGreaterThan(0);
        expect(metrics.errorRate).toBeGreaterThan(0);
        expect(metrics.errorRate).toBeLessThan(1);
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should work correctly with real-world model configurations', () => {
      const scenarios = [
        {
          baseUrl: 'http://localhost:11434',
          model: 'llama3.2:8b',
          expectedLocal: true,
        },
        {
          baseUrl: 'http://192.168.1.100:8080',
          model: 'qwen2.5:14b-instruct',
          expectedLocal: true,
        },
        {
          baseUrl: 'https://api.openai.com',
          model: 'gpt-4',
          expectedLocal: false,
        },
        {
          baseUrl: 'https://dashscope.aliyuncs.com',
          model: 'qwen-max',
          expectedLocal: false,
        },
      ];

      scenarios.forEach(({ baseUrl, model, expectedLocal }) => {
        expect(isLocalModel(baseUrl, model)).toBe(expectedLocal);

        if (expectedLocal) {
          expect(getLocalModelTokenLimit(model)).toBeGreaterThan(0);
          expect(getCompressionThreshold(true)).toBeLessThan(0.9);
        }
      });
    });

    it('should handle configuration edge cases that caused previous issues', () => {
      // Empty/undefined configurations (common source of bugs)
      expect(() => isLocalModel(undefined, undefined)).not.toThrow();
      expect(() => getLocalModelTokenLimit('')).not.toThrow();
      expect(() => detectLocalModelCapabilities()).not.toThrow();

      // Malformed but parseable inputs
      expect(() => isLocalModel('not-a-url', 'not-a-model')).not.toThrow();
      expect(() =>
        getLocalModelTokenLimit('model-with-no-size-info'),
      ).not.toThrow();
    });
  });
});
