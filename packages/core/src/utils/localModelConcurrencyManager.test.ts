/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalModelConcurrencyManager,
  ConcurrencyConfig,
} from './localModelConcurrencyManager.js';

describe('LocalModelConcurrencyManager', () => {
  let manager: LocalModelConcurrencyManager;
  let baseConfig: ConcurrencyConfig;

  beforeEach(() => {
    baseConfig = {
      maxConcurrentRequests: 2,
      queueTimeout: 5000,
      adaptiveThrottling: true,
    };
    manager = new LocalModelConcurrencyManager(baseConfig);
  });

  describe('Basic functionality', () => {
    it('should execute requests within concurrency limits', async () => {
      // const results: number[] = [];
      let activeCount = 0;
      let maxConcurrent = 0;

      const createRequest = (id: number, delay: number) => async () => {
        activeCount++;
        maxConcurrent = Math.max(maxConcurrent, activeCount);

        await new Promise((resolve) => setTimeout(resolve, delay));

        activeCount--;
        return id;
      };

      const promises = [
        manager.executeRequest('req1', createRequest(1, 100)),
        manager.executeRequest('req2', createRequest(2, 100)),
        manager.executeRequest('req3', createRequest(3, 100)),
        manager.executeRequest('req4', createRequest(4, 100)),
      ];

      const results_final = await Promise.all(promises);

      expect(results_final).toEqual([1, 2, 3, 4]);
      expect(maxConcurrent).toBeLessThanOrEqual(
        baseConfig.maxConcurrentRequests,
      );
    });

    it('should handle request failures gracefully', async () => {
      const createFailingRequest = (shouldFail: boolean) => async () => {
        if (shouldFail) {
          throw new Error('Request failed');
        }
        return 'success';
      };

      const promises = [
        manager.executeRequest('success1', createFailingRequest(false)),
        manager.executeRequest('fail1', createFailingRequest(true)),
        manager.executeRequest('success2', createFailingRequest(false)),
      ];

      const results = await Promise.allSettled(promises);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');

      if (results[0].status === 'fulfilled') {
        expect(results[0].value).toBe('success');
      }
      if (results[2].status === 'fulfilled') {
        expect(results[2].value).toBe('success');
      }
    });

    it('should respect queue timeout', async () => {
      const config: ConcurrencyConfig = {
        maxConcurrentRequests: 1,
        queueTimeout: 100, // Very short timeout
        adaptiveThrottling: false,
      };

      const timeoutManager = new LocalModelConcurrencyManager(config);

      const longRequest = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'completed';
      };

      // Start a long-running request that will block others
      const firstPromise = timeoutManager.executeRequest('long', longRequest);

      // This should timeout while waiting for the first to complete
      const timeoutPromise = timeoutManager.executeRequest(
        'timeout',
        async () => 'should timeout',
      );

      const results = await Promise.allSettled([firstPromise, timeoutPromise]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');

      if (results[1].status === 'rejected') {
        expect(results[1].reason.message).toContain('timed out in queue');
      }
    });
  });

  describe('Abort signal handling', () => {
    it('should handle abort signals properly', async () => {
      const abortController = new AbortController();

      // Start request and then abort it
      const requestPromise = manager.executeRequest(
        'abortable',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'should be aborted';
        },
        abortController.signal,
      );

      // Abort after short delay
      setTimeout(() => abortController.abort(), 50);

      await expect(requestPromise).rejects.toThrow('Request was aborted');
    });

    it('should handle abort of queued requests', async () => {
      const config: ConcurrencyConfig = {
        maxConcurrentRequests: 1,
        queueTimeout: 5000,
        adaptiveThrottling: false,
      };

      const abortManager = new LocalModelConcurrencyManager(config);
      const abortController = new AbortController();

      // Start a long request to block the queue
      const blockingPromise = abortManager.executeRequest(
        'blocking',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'blocking completed';
        },
      );

      // Queue a request that we'll abort
      const abortablePromise = abortManager.executeRequest(
        'abortable',
        async () => {
          return 'should be aborted';
        },
        abortController.signal,
      );

      // Abort the queued request
      setTimeout(() => abortController.abort(), 50);

      const results = await Promise.allSettled([
        blockingPromise,
        abortablePromise,
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');

      if (results[1].status === 'rejected') {
        expect(results[1].reason.message).toContain('aborted');
      }
    });
  });

  describe('Performance metrics and adaptive throttling', () => {
    it('should track performance metrics correctly', async () => {
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          manager.executeRequest(`req${i}`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 50 + i * 10));
            return i;
          }),
        );
      }

      await Promise.all(promises);

      const metrics = manager.getMetrics();
      expect(metrics.activeRequests).toBe(0);
      expect(metrics.queuedRequests).toBe(0);
      expect(metrics.averageResponseTime).toBeGreaterThan(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('should reduce concurrency limit on high error rate', async () => {
      const adaptiveManager = new LocalModelConcurrencyManager({
        ...baseConfig,
        adaptiveThrottling: true,
        maxConcurrentRequests: 4,
      });

      // Generate many failing requests to increase error rate
      const failingPromises = [];
      for (let i = 0; i < 10; i++) {
        failingPromises.push(
          adaptiveManager
            .executeRequest(`fail${i}`, async () => {
              throw new Error('Simulated failure');
            })
            .catch(() => 'failed'), // Catch to prevent unhandled rejection
        );
      }

      await Promise.all(failingPromises);

      const metricsAfterFailures = adaptiveManager.getMetrics();
      expect(metricsAfterFailures.errorRate).toBeGreaterThan(0.5);
      expect(metricsAfterFailures.effectiveConcurrencyLimit).toBeLessThan(4);
    });

    it('should reduce concurrency limit on slow responses', async () => {
      const slowManager = new LocalModelConcurrencyManager({
        ...baseConfig,
        adaptiveThrottling: true,
        maxConcurrentRequests: 4,
      });

      // Generate slow requests
      await slowManager.executeRequest('slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'slow response';
      });

      // Simulate very slow response to trigger adaptive throttling
      // We need to artificially set the average response time for testing
      (slowManager as any).performanceMetrics.averageResponseTime = 35000; // 35 seconds

      const metrics = slowManager.getMetrics();
      expect(metrics.effectiveConcurrencyLimit).toBeLessThan(4);
    });

    it('should track queue wait times', async () => {
      const config: ConcurrencyConfig = {
        maxConcurrentRequests: 1,
        queueTimeout: 5000,
        adaptiveThrottling: false,
      };

      const queueManager = new LocalModelConcurrencyManager(config);

      const promises = [];

      // First request will execute immediately
      promises.push(
        queueManager.executeRequest('immediate', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'immediate';
        }),
      );

      // These will be queued
      for (let i = 0; i < 3; i++) {
        promises.push(
          queueManager.executeRequest(`queued${i}`, async () => {
            return `queued${i}`;
          }),
        );
      }

      await Promise.all(promises);

      const metrics = queueManager.getMetrics();
      expect(metrics.averageQueueWaitTime).toBeGreaterThan(0);
    });
  });

  describe('Stress testing', () => {
    it('should handle high concurrency requests without issues', async () => {
      const stressConfig: ConcurrencyConfig = {
        maxConcurrentRequests: 5,
        queueTimeout: 10000,
        adaptiveThrottling: true,
      };

      const stressManager = new LocalModelConcurrencyManager(stressConfig);

      const promises = [];
      const expectedResults: number[] = [];

      // Create 100 concurrent requests
      for (let i = 0; i < 100; i++) {
        expectedResults.push(i);
        promises.push(
          stressManager.executeRequest(`stress${i}`, async () => {
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 50),
            );
            return i;
          }),
        );
      }

      const results = await Promise.all(promises);

      // All requests should complete successfully
      expect(results.sort((a, b) => a - b)).toEqual(expectedResults);

      const metrics = stressManager.getMetrics();
      expect(metrics.activeRequests).toBe(0);
      expect(metrics.queuedRequests).toBe(0);
    }, 15000); // Extended timeout for stress test

    it('should handle rapid request submission and cancellation', async () => {
      const rapidConfig: ConcurrencyConfig = {
        maxConcurrentRequests: 2,
        queueTimeout: 1000,
        adaptiveThrottling: false,
      };

      const rapidManager = new LocalModelConcurrencyManager(rapidConfig);

      const controllers: AbortController[] = [];
      const promises: Promise<any>[] = [];

      // Submit many requests rapidly
      for (let i = 0; i < 50; i++) {
        const controller = new AbortController();
        controllers.push(controller);

        promises.push(
          rapidManager
            .executeRequest(
              `rapid${i}`,
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return i;
              },
              controller.signal,
            )
            .catch((error) => ({ error: error.message })),
        );

        // Randomly abort some requests
        if (Math.random() < 0.3) {
          setTimeout(() => controller.abort(), Math.random() * 50);
        }
      }

      const results = await Promise.all(promises);

      // Some should succeed, some should be aborted
      const successes = results.filter((r) => typeof r === 'number');
      const aborted = results.filter(
        (r) => r.error && r.error.includes('abort'),
      );

      expect(successes.length + aborted.length).toBe(50);
      expect(aborted.length).toBeGreaterThan(0); // Some should have been aborted
    });

    it('should maintain stability under mixed success/failure scenarios', async () => {
      const mixedManager = new LocalModelConcurrencyManager({
        maxConcurrentRequests: 3,
        queueTimeout: 5000,
        adaptiveThrottling: true,
      });

      const promises = [];

      for (let i = 0; i < 50; i++) {
        promises.push(
          mixedManager
            .executeRequest(`mixed${i}`, async () => {
              const delay = Math.random() * 100;
              await new Promise((resolve) => setTimeout(resolve, delay));

              // 30% chance of failure
              if (Math.random() < 0.3) {
                throw new Error(`Random failure ${i}`);
              }

              return i;
            })
            .catch((error) => ({ error: true, id: i })),
        );
      }

      const results = await Promise.all(promises);

      const successes = results.filter((r) => typeof r === 'number');
      const failures = results.filter((r) => typeof r === 'object' && r && 'error' in r && r.error === true);

      expect(successes.length + failures.length).toBe(50);
      expect(successes.length).toBeGreaterThan(0);
      expect(failures.length).toBeGreaterThan(0);

      // Manager should still be functional
      const finalMetrics = mixedManager.getMetrics();
      expect(finalMetrics.activeRequests).toBe(0);
      expect(finalMetrics.queuedRequests).toBe(0);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle immediate request execution when under limit', async () => {
      const result = await manager.executeRequest(
        'immediate',
        async () => 'immediate result',
      );
      expect(result).toBe('immediate result');

      const metrics = manager.getMetrics();
      expect(metrics.activeRequests).toBe(0);
    });

    it('should handle empty request function results', async () => {
      const results = await Promise.all([
        manager.executeRequest('undefined', async () => undefined),
        manager.executeRequest('null', async () => null),
        manager.executeRequest('empty-string', async () => ''),
        manager.executeRequest('zero', async () => 0),
        manager.executeRequest('false', async () => false),
      ]);

      expect(results).toEqual([undefined, null, '', 0, false]);
    });

    it('should handle requests that throw non-Error objects', async () => {
      const promises = [
        manager
          .executeRequest('string-error', async () => {
            throw 'string error';
          })
          .catch((err) => err),
        manager
          .executeRequest('object-error', async () => {
            throw { message: 'object error' };
          })
          .catch((err) => err),
        manager
          .executeRequest('number-error', async () => {
            throw 404;
          })
          .catch((err) => err),
      ];

      const results = await Promise.all(promises);

      // All should be converted to Error objects
      results.forEach((result) => {
        expect(result).toBeInstanceOf(Error);
      });
    });

    it('should handle configuration updates dynamically', async () => {
      const initialMetrics = manager.getMetrics();
      expect(initialMetrics.effectiveConcurrencyLimit).toBe(2);

      manager.updateConfig({ maxConcurrentRequests: 5 });

      const updatedMetrics = manager.getMetrics();
      expect(updatedMetrics.effectiveConcurrencyLimit).toBe(5);
    });

    it('should handle queue clearing', async () => {
      const config: ConcurrencyConfig = {
        maxConcurrentRequests: 1,
        queueTimeout: 5000,
        adaptiveThrottling: false,
      };

      const queueClearManager = new LocalModelConcurrencyManager(config);

      // Start a blocking request
      const blockingPromise = queueClearManager.executeRequest(
        'blocking',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'blocking';
        },
      );

      // Queue several requests
      const queuedPromises = [];
      for (let i = 0; i < 5; i++) {
        queuedPromises.push(
          queueClearManager
            .executeRequest(`queued${i}`, async () => `queued${i}`)
            .catch((err) => ({ error: err.message })),
        );
      }

      // Clear the queue after a short delay
      setTimeout(() => queueClearManager.clearQueue(), 50);

      const results = await Promise.allSettled([
        blockingPromise,
        ...queuedPromises,
      ]);

      // Blocking request should succeed
      expect(results[0].status).toBe('fulfilled');

      // Queued requests should be rejected
      for (let i = 1; i < results.length; i++) {
        expect(results[i].status).toBe('rejected');
      }
    });
  });

  describe('Memory and resource management', () => {
    it('should not leak memory with many completed requests', async () => {
      // const initialMetrics = manager.getMetrics();

      // Execute many requests
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(manager.executeRequest(`mem${i}`, async () => i));
      }

      await Promise.all(promises);

      const finalMetrics = manager.getMetrics();

      // Should not accumulate completed requests
      expect(finalMetrics.activeRequests).toBe(0);
      expect(finalMetrics.queuedRequests).toBe(0);

      // Queue wait times should be limited to prevent memory growth
      expect(
        (manager as any).performanceMetrics.queueWaitTimes.length,
      ).toBeLessThanOrEqual(100);
    });

    it('should handle optimal configuration generation', () => {
      const optimalConfig = LocalModelConcurrencyManager.getOptimalConfig();

      expect(optimalConfig.maxConcurrentRequests).toBeGreaterThan(0);
      expect(optimalConfig.maxConcurrentRequests).toBeLessThanOrEqual(4);
      expect(optimalConfig.queueTimeout).toBe(120000);
      expect(optimalConfig.adaptiveThrottling).toBe(true);
    });
  });

  describe('Real-world usage patterns', () => {
    it('should handle typical local model request patterns', async () => {
      // Simulate realistic local model usage: some quick, some slow, occasional failures
      const requests = [
        { id: 'quick1', delay: 50, shouldFail: false },
        { id: 'slow1', delay: 500, shouldFail: false },
        { id: 'quick2', delay: 30, shouldFail: false },
        { id: 'failing1', delay: 100, shouldFail: true },
        { id: 'quick3', delay: 40, shouldFail: false },
        { id: 'slow2', delay: 800, shouldFail: false },
        { id: 'quick4', delay: 60, shouldFail: false },
      ];

      const promises = requests.map(({ id, delay, shouldFail }) =>
        manager
          .executeRequest(id, async () => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (shouldFail) throw new Error(`${id} failed`);
            return `${id} completed`;
          })
          .catch((err) => ({ error: err.message, id })),
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => typeof r === 'string');
      const failures = results.filter((r) => typeof r === 'object' && r.error);

      expect(successes.length).toBe(6);
      expect(failures.length).toBe(1);

      const metrics = manager.getMetrics();
      expect(metrics.errorRate).toBeCloseTo(1 / 7, 1); // 1 failure out of 7 requests
    });

    it('should handle burst traffic patterns', async () => {
      const burstConfig: ConcurrencyConfig = {
        maxConcurrentRequests: 3,
        queueTimeout: 2000,
        adaptiveThrottling: true,
      };

      const burstManager = new LocalModelConcurrencyManager(burstConfig);

      // Simulate burst traffic: many requests at once, then idle
      const burst1Promises = [];
      for (let i = 0; i < 20; i++) {
        burst1Promises.push(
          burstManager.executeRequest(`burst1-${i}`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return `burst1-${i}`;
          }),
        );
      }

      // Wait for first burst to complete
      await Promise.all(burst1Promises);

      // Small idle period
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second burst
      const burst2Promises = [];
      for (let i = 0; i < 15; i++) {
        burst2Promises.push(
          burstManager.executeRequest(`burst2-${i}`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return `burst2-${i}`;
          }),
        );
      }

      const burst2Results = await Promise.all(burst2Promises);

      expect(burst2Results.length).toBe(15);

      const finalMetrics = burstManager.getMetrics();
      expect(finalMetrics.activeRequests).toBe(0);
      expect(finalMetrics.queuedRequests).toBe(0);
    });
  });
});
