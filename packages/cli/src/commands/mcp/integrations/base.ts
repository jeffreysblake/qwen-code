/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MCPServerConfig } from '@qwen-code/qwen-code-core';
import { loadSettings, SettingScope } from '../../../config/settings.js';
import { execSync } from 'child_process';
import * as fs from 'fs';

/**
 * Base class for MCP integration helpers
 */
export abstract class BaseMCPIntegration {
  readonly name: string;
  readonly description: string;

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  /**
   * Check if the required dependencies are installed
   */
  abstract checkDependencies(): Promise<boolean>;

  /**
   * Install the required dependencies
   */
  abstract installDependencies(): Promise<void>;

  /**
   * Get the MCP server configuration
   */
  abstract getServerConfig(options?: Record<string, unknown>): MCPServerConfig;

  /**
   * Validate the server configuration
   */
  abstract validateConfig(config: MCPServerConfig): Promise<boolean>;

  /**
   * Install and configure the MCP server
   */
  async install(options?: Record<string, unknown>): Promise<void> {
    console.log(`🔌 Installing ${this.name} MCP integration...`);

    // Check dependencies
    const hasDeps = await this.checkDependencies();
    if (!hasDeps) {
      console.log(`📦 Installing dependencies for ${this.name}...`);
      await this.installDependencies();
    }

    // Get server configuration
    const config = this.getServerConfig(options);

    // Validate configuration
    const isValid = await this.validateConfig(config);
    if (!isValid) {
      throw new Error(`Invalid configuration for ${this.name}`);
    }

    // Add to settings
    const settings = loadSettings(process.cwd());
    const settingsScope = SettingScope.Workspace;

    const existingSettings = settings.forScope(settingsScope).settings;
    const mcpServers = existingSettings.mcpServers || {};

    mcpServers[this.name] = config;
    settings.setValue(settingsScope, 'mcpServers', mcpServers);

    console.log(`✅ ${this.name} MCP integration installed successfully!`);
    console.log(`   Use 'qwen mcp list' to see available servers.`);
  }

  /**
   * Remove the MCP server configuration
   */
  async uninstall(): Promise<void> {
    console.log(`🗑️  Removing ${this.name} MCP integration...`);

    const settings = loadSettings(process.cwd());
    const settingsScope = SettingScope.Workspace;

    const existingSettings = settings.forScope(settingsScope).settings;
    const mcpServers = existingSettings.mcpServers || {};

    if (mcpServers[this.name]) {
      delete mcpServers[this.name];
      settings.setValue(settingsScope, 'mcpServers', mcpServers);
      console.log(`✅ ${this.name} MCP integration removed successfully!`);
    } else {
      console.log(`⚠️  ${this.name} MCP integration not found.`);
    }
  }

  /**
   * Check if a command exists
   */
  protected commandExists(command: string): boolean {
    try {
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      try {
        execSync(`where ${command}`, { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Check if a Node.js package is installed globally
   */
  protected isPackageInstalled(packageName: string): boolean {
    try {
      execSync(`npm list -g ${packageName}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install a Node.js package globally
   */
  protected async installPackage(packageName: string): Promise<void> {
    console.log(`📦 Installing ${packageName}...`);
    try {
      execSync(`npm install -g ${packageName}`, { stdio: 'inherit' });
    } catch (error) {
      throw new Error(`Failed to install ${packageName}: ${error}`);
    }
  }

  /**
   * Get the Node.js version
   */
  protected getNodeVersion(): string {
    try {
      return execSync('node --version', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  }

  /**
   * Check if Node.js version meets minimum requirement
   */
  protected checkNodeVersion(minVersion: string): boolean {
    const currentVersion = this.getNodeVersion();
    if (!currentVersion) return false;

    const current = currentVersion.replace('v', '').split('.').map(Number);
    const min = minVersion.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (current[i] > min[i]) return true;
      if (current[i] < min[i]) return false;
    }
    return true;
  }

  /**
   * Create a directory if it doesn't exist
   */
  protected ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Check if a file exists
   */
  protected fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Get the workspace root directory
   */
  protected getWorkspaceRoot(): string {
    return process.cwd();
  }
}

/**
 * MCP Integration registry
 */
export class MCPIntegrationRegistry {
  private static integrations = new Map<string, BaseMCPIntegration>();

  static register(integration: BaseMCPIntegration): void {
    this.integrations.set(integration.name, integration);
  }

  static get(name: string): BaseMCPIntegration | undefined {
    return this.integrations.get(name);
  }

  static list(): BaseMCPIntegration[] {
    return Array.from(this.integrations.values());
  }

  static getNames(): string[] {
    return Array.from(this.integrations.keys());
  }
}
