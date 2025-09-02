/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseMCPIntegration, MCPIntegrationRegistry } from './base.js';
import { PlaywrightMCPIntegration } from './playwright.js';
import { GitMCPIntegration } from './git.js';
import { DatabaseMCPIntegration } from './database.js';
import { FileSystemMCPIntegration } from './filesystem.js';

// Register all available integrations
MCPIntegrationRegistry.register(new PlaywrightMCPIntegration());
MCPIntegrationRegistry.register(new GitMCPIntegration());
MCPIntegrationRegistry.register(new DatabaseMCPIntegration('sqlite'));
MCPIntegrationRegistry.register(new DatabaseMCPIntegration('postgresql'));
MCPIntegrationRegistry.register(new DatabaseMCPIntegration('mysql'));
MCPIntegrationRegistry.register(new DatabaseMCPIntegration('multi'));
MCPIntegrationRegistry.register(new FileSystemMCPIntegration());

export {
  BaseMCPIntegration,
  MCPIntegrationRegistry,
  PlaywrightMCPIntegration,
  GitMCPIntegration,
  DatabaseMCPIntegration,
  FileSystemMCPIntegration,
};

/**
 * Get all available MCP integrations
 */
export function getAvailableIntegrations(): BaseMCPIntegration[] {
  return MCPIntegrationRegistry.list();
}

/**
 * Get integration by name
 */
export function getIntegration(name: string): BaseMCPIntegration | undefined {
  return MCPIntegrationRegistry.get(name);
}

/**
 * Get integration names
 */
export function getIntegrationNames(): string[] {
  return MCPIntegrationRegistry.getNames();
}

/**
 * Install an integration with guided setup
 */
export async function installIntegration(name: string, options: any = {}): Promise<void> {
  const integration = getIntegration(name);
  if (!integration) {
    throw new Error(`Unknown integration: ${name}`);
  }

  await integration.install(options);
}

/**
 * Uninstall an integration
 */
export async function uninstallIntegration(name: string): Promise<void> {
  const integration = getIntegration(name);
  if (!integration) {
    throw new Error(`Unknown integration: ${name}`);
  }

  await integration.uninstall();
}

/**
 * List all available integrations with descriptions
 */
export function listIntegrations(): Array<{ name: string; description: string }> {
  return getAvailableIntegrations().map(integration => ({
    name: integration.name,
    description: integration.description,
  }));
}

/**
 * Get integration info including available tools and examples
 */
export function getIntegrationInfo(name: string): any {
  const integration = getIntegration(name);
  if (!integration) {
    return null;
  }

  const info: any = {
    name: integration.name,
    description: integration.description,
  };

  // Add specific methods if they exist
  if ('getAvailableTools' in integration) {
    info.tools = (integration as any).getAvailableTools();
  }

  if ('getUsageExamples' in integration) {
    info.examples = (integration as any).getUsageExamples();
  }

  if ('getSecurityBestPractices' in integration) {
    info.security = (integration as any).getSecurityBestPractices();
  }

  if ('getSecurityRecommendations' in integration) {
    info.security = (integration as any).getSecurityRecommendations();
  }

  return info;
}