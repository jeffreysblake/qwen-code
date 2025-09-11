/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utilities for detecting and optimizing local model deployments
 */

export interface LocalModelConfig {
  maxConcurrentRequests?: number;
  adaptiveTimeout?: boolean;
  memoryConstraints?: {
    maxContextSize?: number;
    aggressiveCompression?: boolean;
  };
  hardwareOptimization?: {
    useGPU?: boolean;
    batchSize?: number;
    modelQuantization?: string; // '8bit', '4bit', 'fp16'
  };
}

export interface LocalModelMetrics {
  memoryUsage?: NodeJS.MemoryUsage;
  responseTime?: number;
  tokenThroughput?: number;
  errorRate?: number;
}

/**
 * Detects if the current model configuration is for a local deployment
 */
export function isLocalModel(baseUrl?: string, model?: string): boolean {
  // Check environment variables and base URL patterns
  const openaiBaseUrl = baseUrl || process.env['OPENAI_BASE_URL'] || '';

  // Common local deployment patterns
  const localPatterns = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '192.168.',
    '10.0.',
    '172.16.',
    'local',
    ':1234',
    ':8080',
    ':11434', // Ollama default
    ':8000', // Common local API port
  ];

  const isLocalUrl = localPatterns.some((pattern) =>
    openaiBaseUrl.toLowerCase().includes(pattern),
  );

  // Model name patterns that indicate local deployment
  const localModelPatterns = [
    'local',
    'ollama',
    'llama',
    'mistral',
    'qwen',
    'codellama',
    'vicuna',
    'alpaca',
  ];

  const isLocalModelName = model
    ? localModelPatterns.some((pattern) =>
        model.toLowerCase().includes(pattern),
      )
    : false;

  return isLocalUrl || isLocalModelName;
}

/**
 * Gets optimal token limit for local models
 */
export function getLocalModelTokenLimit(model: string): number {
  // Check for explicit environment variable override
  const configLimit = process.env['LOCAL_MODEL_TOKEN_LIMIT'];
  if (configLimit) {
    const limit = parseInt(configLimit, 10);
    if (!isNaN(limit) && limit > 0) {
      return limit;
    }
  }

  // Model-specific limits based on common local deployments
  const modelLower = model.toLowerCase();

  if (modelLower.includes('qwen2.5-72b') || modelLower.includes('llama-70b')) {
    return 80000; // Large models can handle more context
  }

  if (modelLower.includes('qwen2.5-32b') || modelLower.includes('llama-30b')) {
    return 80000;
  }

  if (modelLower.includes('qwen2.5-14b') || modelLower.includes('llama-13b')) {
    return 80000;
  }

  if (modelLower.includes('qwen2.5-7b') || modelLower.includes('llama-7b')) {
    return 80000;
  }

  if (
    modelLower.includes('qwen2.5-3b') ||
    modelLower.includes('qwen2.5-1.5b')
  ) {
    return 80000; // Smaller models need conservative limits
  }

  // Conservative default for unknown local models - increased to 80k as requested
  return 80000;
}

/**
 * Detects local model capabilities based on runtime environment
 */
export function detectLocalModelCapabilities(): LocalModelConfig {
  const memoryUsage = process.memoryUsage();
  const totalMemory = memoryUsage.heapTotal + memoryUsage.external;

  // Base configuration
  const config: LocalModelConfig = {
    maxConcurrentRequests: 2,
    adaptiveTimeout: true,
    memoryConstraints: {
      aggressiveCompression: true,
    },
  };

  // Adjust based on available memory
  if (totalMemory > 8e9) {
    // > 8GB
    config.maxConcurrentRequests = 4;
    config.memoryConstraints!.maxContextSize = 80000;
  } else if (totalMemory > 4e9) {
    // > 4GB
    config.maxConcurrentRequests = 2;
    config.memoryConstraints!.maxContextSize = 80000;
  } else {
    // < 4GB
    config.maxConcurrentRequests = 1;
    config.memoryConstraints!.maxContextSize = 80000;
    config.memoryConstraints!.aggressiveCompression = true;
  }

  // Check for GPU availability (basic heuristic)
  const hasGPU =
    process.env['CUDA_VISIBLE_DEVICES'] !== undefined ||
    process.env['CUDA_DEVICE_ORDER'] !== undefined ||
    process.argv.some((arg) => arg.includes('--gpu'));

  if (hasGPU) {
    config.hardwareOptimization = {
      useGPU: true,
      batchSize: 8,
    };
  }

  return config;
}

/**
 * Gets compression threshold based on system resources and model type
 */
export function getCompressionThreshold(isLocal: boolean): number {
  if (!isLocal) {
    return 0.9; // Conservative compression for cloud models
  }

  const memoryUsage = process.memoryUsage();
  const heapUsed = memoryUsage.heapUsed;

  // More aggressive compression under memory pressure
  if (heapUsed > 2e9) {
    // > 2GB heap usage
    return 0.3; // Very aggressive
  } else if (heapUsed > 1e9) {
    // > 1GB heap usage
    return 0.5; // Aggressive
  } else {
    return 0.6; // Moderate compression for local models
  }
}

/**
 * Gets optimal sampling parameters for local models
 */
export function getLocalModelSamplingParams(): Record<string, unknown> {
  return {
    temperature: 0.3, // Lower temperature for more consistent local output
    top_p: 0.9,
    top_k: 40,
    repetition_penalty: 1.1, // Help prevent repetition in local models
    max_tokens: Math.min(
      parseInt(process.env['LOCAL_MODEL_MAX_TOKENS'] || '1024', 10),
      2048, // Hard cap to prevent memory issues
    ),
  };
}

/**
 * Monitors local model performance metrics
 */
export class LocalModelMonitor {
  private responseTimeHistory: number[] = [];
  private errorCount = 0;
  private totalRequests = 0;

  recordResponseTime(timeMs: number): void {
    this.responseTimeHistory.push(timeMs);
    // Keep only last 100 measurements
    if (this.responseTimeHistory.length > 100) {
      this.responseTimeHistory.shift();
    }
  }

  recordError(): void {
    this.errorCount++;
  }

  recordRequest(): void {
    this.totalRequests++;
  }

  getMetrics(): LocalModelMetrics {
    const avgResponseTime =
      this.responseTimeHistory.length > 0
        ? this.responseTimeHistory.reduce((a, b) => a + b, 0) /
          this.responseTimeHistory.length
        : 0;

    const errorRate =
      this.totalRequests > 0 ? this.errorCount / this.totalRequests : 0;

    return {
      memoryUsage: process.memoryUsage(),
      responseTime: avgResponseTime,
      errorRate,
      tokenThroughput: this.calculateTokenThroughput(),
    };
  }

  private calculateTokenThroughput(): number {
    // Simple heuristic based on response times
    if (this.responseTimeHistory.length === 0) return 0;

    const avgTime =
      this.responseTimeHistory.reduce((a, b) => a + b, 0) /
      this.responseTimeHistory.length;
    // Assume average of ~100 tokens per response
    return avgTime > 0 ? (100 / avgTime) * 1000 : 0; // tokens per second
  }

  shouldAdjustConfiguration(): boolean {
    const metrics = this.getMetrics();

    // Suggest configuration adjustment if performance is poor
    return (
      (metrics.errorRate || 0) > 0.1 || // > 10% error rate
      (metrics.responseTime || 0) > 30000 || // > 30 second responses
      (metrics.memoryUsage?.heapUsed || 0) > 2e9 // > 2GB heap usage
    );
  }
}

/**
 * Detects common local model error patterns
 */
export function isLocalModelError(error: unknown): boolean {
  const errorMessage =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  const localModelErrorPatterns = [
    'connection refused',
    'econnrefused',
    'model not loaded',
    'model not found',
    'out of memory',
    'cuda out of memory',
    'inference timeout',
    'model loading',
    'context length exceeded',
    'token limit exceeded',
    'ollama',
    'local server',
    'localhost',
  ];

  return localModelErrorPatterns.some((pattern) =>
    errorMessage.includes(pattern),
  );
}

/**
 * Gets retry configuration optimized for local models
 */
export function getLocalModelRetryConfig() {
  return {
    maxAttempts: 3, // Fewer attempts for local models
    initialDelayMs: 1000, // Shorter initial delay
    maxDelayMs: 8000, // Shorter max delay
    backoffMultiplier: 1.5, // Gentler backoff
    shouldRetry: (error: unknown) => {
      if (isLocalModelError(error)) {
        const errorMessage = String(error).toLowerCase();
        // Don't retry on permanent failures
        return !(
          errorMessage.includes('out of memory') ||
          errorMessage.includes('model not found') ||
          errorMessage.includes('context length exceeded')
        );
      }
      return true; // Use default retry logic for non-local errors
    },
  };
}
