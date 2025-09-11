/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Concurrency management for local model deployments to prevent resource exhaustion
 */

export interface ConcurrencyConfig {
  maxConcurrentRequests: number;
  queueTimeout: number; // Maximum time to wait in queue (ms)
  adaptiveThrottling: boolean; // Adjust concurrency based on performance
}

export interface RequestQueueItem<T = unknown> {
  id: string;
  startTime: number;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
  abortController?: AbortController;
}

export class LocalModelConcurrencyManager {
  private activeRequests = new Set<string>();
  private requestQueue: RequestQueueItem<unknown>[] = [];
  private config: ConcurrencyConfig;
  private performanceMetrics: {
    averageResponseTime: number;
    errorRate: number;
    queueWaitTimes: number[];
  } = {
    averageResponseTime: 0,
    errorRate: 0,
    queueWaitTimes: [],
  };

  constructor(config: ConcurrencyConfig) {
    this.config = config;
  }

  /**
   * Execute a request with concurrency control
   */
  async executeRequest<T>(
    requestId: string,
    requestFn: () => Promise<T>,
    abortSignal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queueItem: RequestQueueItem<T> = {
        id: requestId,
        startTime: Date.now(),
        resolve: (result: T) => {
          this.removeActiveRequest(requestId);
          this.recordSuccess(Date.now() - queueItem.startTime);
          resolve(result);
          this.processQueue(); // Process next in queue
        },
        reject: (error: Error) => {
          this.removeActiveRequest(requestId);
          this.recordError();
          reject(error);
          this.processQueue(); // Process next in queue
        },
        abortController: abortSignal ? undefined : new AbortController(),
      };

      // Add to queue (cast to unknown type for storage)
      this.requestQueue.push(queueItem as RequestQueueItem<unknown>);

      // Set up timeout for queue wait
      const timeoutId = setTimeout(() => {
        this.removeFromQueue(requestId);
        queueItem.reject(
          new Error(
            `Request ${requestId} timed out in queue after ${this.config.queueTimeout}ms`,
          ),
        );
      }, this.config.queueTimeout);

      // Listen for abort signal
      const abortController = queueItem.abortController || {
        signal: abortSignal!,
      };
      if (abortController.signal) {
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          this.removeFromQueue(requestId);
          this.removeActiveRequest(requestId);
          queueItem.reject(new Error('Request was aborted'));
        });
      }

      // Store cleanup function on queue item
      (queueItem as RequestQueueItem<T> & { cleanup: () => void }).cleanup =
        () => clearTimeout(timeoutId);

      // Store request function on queue item
      (
        queueItem as RequestQueueItem<T> & { requestFn: () => Promise<T> }
      ).requestFn = requestFn;

      // Process queue
      this.processQueue();
    });
  }

  /**
   * Process the request queue, starting requests when concurrency allows
   */
  private async processQueue(): Promise<void> {
    // Check if we can process more requests
    while (
      this.activeRequests.size < this.getEffectiveConcurrencyLimit() &&
      this.requestQueue.length > 0
    ) {
      const queueItem = this.requestQueue.shift()!;

      // Record queue wait time
      const queueWaitTime = Date.now() - queueItem.startTime;
      this.performanceMetrics.queueWaitTimes.push(queueWaitTime);
      if (this.performanceMetrics.queueWaitTimes.length > 100) {
        this.performanceMetrics.queueWaitTimes.shift(); // Keep only last 100
      }

      // Mark as active
      this.activeRequests.add(queueItem.id);

      // Clean up timeout
      if (
        (queueItem as RequestQueueItem<unknown> & { cleanup: () => void })
          .cleanup
      ) {
        (
          queueItem as RequestQueueItem<unknown> & { cleanup: () => void }
        ).cleanup();
      }

      // Execute the request asynchronously (don't await here to avoid blocking queue processing)
      const requestFn = (
        queueItem as RequestQueueItem<unknown> & {
          requestFn: () => Promise<unknown>;
        }
      ).requestFn;
      if (requestFn) {
        this.executeRequestAsync(
          queueItem as RequestQueueItem<unknown>,
          requestFn,
        );
      }
    }
  }

  /**
   * Execute a request asynchronously without blocking the queue
   */
  private async executeRequestAsync(
    queueItem: RequestQueueItem<unknown>,
    requestFn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      const result = await requestFn();
      queueItem.resolve(result);
    } catch (error) {
      queueItem.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Get effective concurrency limit (may be adjusted based on performance)
   */
  private getEffectiveConcurrencyLimit(): number {
    if (!this.config.adaptiveThrottling) {
      return this.config.maxConcurrentRequests;
    }

    // Reduce concurrency if error rate is high or response times are slow
    const baseLimit = this.config.maxConcurrentRequests;

    if (this.performanceMetrics.errorRate > 0.2) {
      return Math.max(1, Math.floor(baseLimit * 0.5)); // 50% reduction for high error rate
    }

    if (this.performanceMetrics.averageResponseTime > 30000) {
      // 30+ second responses
      return Math.max(1, Math.floor(baseLimit * 0.7)); // 30% reduction for slow responses
    }

    return baseLimit;
  }

  /**
   * Remove a request from the queue
   */
  private removeFromQueue(requestId: string): void {
    const index = this.requestQueue.findIndex((item) => item.id === requestId);
    if (index !== -1) {
      this.requestQueue.splice(index, 1);
    }
  }

  /**
   * Remove a request from active requests
   */
  private removeActiveRequest(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  /**
   * Record successful request completion
   */
  private recordSuccess(responseTime: number): void {
    this.updatePerformanceMetrics(responseTime, false);
  }

  /**
   * Record request error
   */
  private recordError(): void {
    this.updatePerformanceMetrics(0, true);
  }

  /**
   * Update performance metrics for adaptive throttling
   */
  private updatePerformanceMetrics(
    responseTime: number,
    isError: boolean,
  ): void {
    // Update error rate (moving average over last 20 requests)
    const errorWeight = 1 / 20;
    this.performanceMetrics.errorRate =
      this.performanceMetrics.errorRate * (1 - errorWeight) +
      (isError ? errorWeight : 0);

    // Update average response time (moving average)
    if (!isError && responseTime > 0) {
      const timeWeight = 0.1; // 10% weight for new measurement
      this.performanceMetrics.averageResponseTime =
        this.performanceMetrics.averageResponseTime * (1 - timeWeight) +
        responseTime * timeWeight;
    }
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): {
    activeRequests: number;
    queuedRequests: number;
    effectiveConcurrencyLimit: number;
    averageResponseTime: number;
    errorRate: number;
    averageQueueWaitTime: number;
  } {
    const avgQueueWait =
      this.performanceMetrics.queueWaitTimes.length > 0
        ? this.performanceMetrics.queueWaitTimes.reduce((a, b) => a + b, 0) /
          this.performanceMetrics.queueWaitTimes.length
        : 0;

    return {
      activeRequests: this.activeRequests.size,
      queuedRequests: this.requestQueue.length,
      effectiveConcurrencyLimit: this.getEffectiveConcurrencyLimit(),
      averageResponseTime: this.performanceMetrics.averageResponseTime,
      errorRate: this.performanceMetrics.errorRate,
      averageQueueWaitTime: avgQueueWait,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ConcurrencyConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Clear all queued requests (useful for shutdown)
   */
  clearQueue(): void {
    this.requestQueue.forEach((item) => {
      item.reject(new Error('Request queue cleared'));
    });
    this.requestQueue = [];
  }

  /**
   * Get optimal concurrency configuration based on system resources
   */
  static getOptimalConfig(): ConcurrencyConfig {
    const memoryUsage = process.memoryUsage();
    const totalMemory = memoryUsage.heapTotal + memoryUsage.external;

    let maxConcurrentRequests = 2; // Conservative default

    if (totalMemory > 8e9) {
      // > 8GB
      maxConcurrentRequests = 4;
    } else if (totalMemory > 4e9) {
      // > 4GB
      maxConcurrentRequests = 2;
    } else {
      // < 4GB
      maxConcurrentRequests = 1;
    }

    return {
      maxConcurrentRequests,
      queueTimeout: 120000, // 2 minutes
      adaptiveThrottling: true,
    };
  }
}
