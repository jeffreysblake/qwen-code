/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MCPServerConfig } from '@qwen-code/qwen-code-core';
import { BaseMCPIntegration } from './base.js';
import { execSync } from 'child_process';

export interface PlaywrightIntegrationOptions {
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  viewport?: { width: number; height: number };
  timeout?: number;
  includeTools?: string[];
  excludeTools?: string[];
  enableFallback?: boolean; // Enable fallback to non-headless on anti-scraping detection
  retryAttempts?: number; // Number of retry attempts before fallback
}

/**
 * Playwright MCP Integration
 * Provides browser automation capabilities using Playwright through MCP
 */
export class PlaywrightMCPIntegration extends BaseMCPIntegration {
  constructor() {
    super(
      'playwright',
      'Browser automation and web scraping using Playwright. Enables navigation, interaction, screenshots, and content extraction.',
    );
  }

  async checkDependencies(): Promise<boolean> {
    // Check if Node.js version is compatible (>=18.0.0)
    if (!this.checkNodeVersion('18.0.0')) {
      console.error(
        '❌ Node.js version 18.0.0 or higher is required for Playwright MCP',
      );
      return false;
    }

    // Check if npx is available
    if (!this.commandExists('npx')) {
      console.error('❌ npx is required but not found');
      return false;
    }

    return true;
  }

  async installDependencies(): Promise<void> {
    // The official Playwright MCP server can be run directly with npx
    // So we don't need to install anything globally, just verify it works
    try {
      console.log('🧪 Testing Playwright MCP server availability...');
      execSync('npx --yes @playwright/mcp@latest --help', {
        stdio: 'pipe',
        timeout: 30000,
      });
      console.log('✅ Playwright MCP server is available');
    } catch (_error) {
      throw new Error(
        'Failed to verify Playwright MCP server availability. Please check your internet connection and npm configuration.',
      );
    }
  }

  getServerConfig(options: PlaywrightIntegrationOptions = {}): MCPServerConfig {
    const {
      headless = true,
      browser = 'firefox',
      viewport = { width: 1280, height: 720 },
      timeout = 30000,
      includeTools,
      excludeTools,
      enableFallback = true,
      retryAttempts = 2,
    } = options;

    const args = ['@playwright/mcp@latest'];

    // Add browser selection
    args.push('--browser', browser);

    // Add headless mode
    if (headless) {
      args.push('--headless');
    }

    // Add viewport size
    args.push('--viewport-size', `${viewport.width},${viewport.height}`);

    // Add isolated mode to prevent persistent browser data
    args.push('--isolated');

    // Add stealth user agent
    args.push(
      '--user-agent',
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    );

    // Ignore HTTPS errors for better compatibility
    args.push('--ignore-https-errors');

    // Disable sandbox for headless mode (common requirement in containers)
    if (headless) {
      args.push('--no-sandbox');
    }

    // Set output directory to current working directory for screenshots and traces
    args.push('--output-dir', process.cwd());

    return {
      command: 'npx',
      args,
      env: {
        // Keep some fallback environment variables for custom logic
        PLAYWRIGHT_ENABLE_FALLBACK: enableFallback.toString(),
        PLAYWRIGHT_RETRY_ATTEMPTS: retryAttempts.toString(),
      },
      timeout,
      trust: true, // Playwright MCP is from Microsoft, generally trusted
      description: this.description,
      includeTools,
      excludeTools,
    };
  }

  async validateConfig(config: MCPServerConfig): Promise<boolean> {
    if (!config.command || config.command !== 'npx') {
      console.error('❌ Invalid command configuration for Playwright MCP');
      return false;
    }

    if (!config.args || !config.args.includes('@playwright/mcp@latest')) {
      console.error('❌ Invalid args configuration for Playwright MCP');
      return false;
    }

    return true;
  }

  /**
   * Install with recommended settings for different use cases
   */
  async installForDevelopment(): Promise<void> {
    await this.install({
      headless: false, // Show browser for development
      browser: 'firefox',
      viewport: { width: 1280, height: 720 },
      timeout: 60000, // Longer timeout for development
    });
  }

  async installForTesting(): Promise<void> {
    await this.install({
      headless: true, // Headless for CI/CD
      browser: 'firefox',
      viewport: { width: 1920, height: 1080 },
      timeout: 30000,
      includeTools: [
        'browser_navigate',
        'browser_click',
        'browser_type',
        'browser_screenshot',
        'browser_snapshot',
        'browser_evaluate',
      ],
    });
  }

  async installForScraping(): Promise<void> {
    await this.install({
      headless: true, // Always headless for scraping
      browser: 'firefox',
      viewport: { width: 1280, height: 720 },
      timeout: 45000, // Longer timeout for complex pages
      enableFallback: true, // Enable fallback to non-headless on anti-scraping detection
      retryAttempts: 3, // More retries for scraping scenarios
      includeTools: [
        'browser_navigate',
        'browser_evaluate',
        'browser_snapshot',
        'browser_screenshot',
        'browser_network_requests',
      ],
    });
  }

  /**
   * Get available browser automation tools
   */
  getAvailableTools(): string[] {
    return [
      'browser_navigate', // Navigate to URLs
      'browser_click', // Click elements
      'browser_type', // Type text in inputs
      'browser_evaluate', // Execute JavaScript
      'browser_screenshot', // Take screenshots
      'browser_snapshot', // Get accessibility snapshots
      'browser_file_upload', // Upload files
      'browser_press_key', // Press keyboard keys
      'browser_handle_dialog', // Handle dialogs (alerts, confirms)
      'browser_network_requests', // Monitor network requests
      'browser_close', // Close browser
    ];
  }

  /**
   * Get usage examples for common Playwright tasks
   */
  getUsageExamples(): Record<string, string> {
    return {
      'Navigate to a website': 'Navigate to https://example.com',
      'Take a screenshot': 'Take a screenshot of the current page',
      'Click a button': 'Click the "Submit" button on the page',
      'Fill a form': 'Type "john@example.com" in the email field',
      'Extract content': 'Get the text content of all headings on the page',
      'Monitor requests': 'Monitor network requests while loading the page',
      'Handle JavaScript': 'Execute JavaScript: document.title',
    };
  }
}
