/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MCPServerConfig } from '@qwen-code/qwen-code-core';
import { BaseMCPIntegration } from './base.js';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface FileSystemIntegrationOptions {
  allowedDirectories?: string[];
  readOnly?: boolean;
  watchFiles?: boolean;
  maxFileSize?: number;
  timeout?: number;
  includeTools?: string[];
  excludeTools?: string[];
}

/**
 * File System MCP Integration
 * Provides secure file system access with directory monitoring and advanced operations
 */
export class FileSystemMCPIntegration extends BaseMCPIntegration {
  constructor() {
    super(
      'filesystem',
      'Secure file system access with read/write operations, directory monitoring, search capabilities, and file watching for real-time updates.',
    );
  }

  async checkDependencies(): Promise<boolean> {
    // Check if Node.js version is compatible
    if (!this.checkNodeVersion('18.0.0')) {
      console.error(
        '❌ Node.js version 18.0.0 or higher is required for File System MCP',
      );
      return false;
    }

    // Check if npm/npx is available
    if (!this.commandExists('npx')) {
      console.error('❌ npx is required but not found');
      return false;
    }

    return true;
  }

  async installDependencies(): Promise<void> {
    try {
      console.log('🧪 Testing File System MCP server availability...');

      // Try official implementation first
      try {
        execSync('npx --yes @modelcontextprotocol/server-filesystem --help', {
          stdio: 'pipe',
          timeout: 30000,
        });
        console.log('✅ Official File System MCP server is available');
        return;
      } catch {
        console.log(
          '📦 Official server not available, trying enhanced implementation...',
        );
      }

      // Try enhanced implementation with monitoring
      try {
        execSync('npx --yes mcp-file-operations-server --help', {
          stdio: 'pipe',
          timeout: 30000,
        });
        console.log(
          '✅ Enhanced File System MCP server with monitoring is available',
        );
        return;
      } catch {
        console.log(
          '📦 Enhanced server not available, trying secure implementation...',
        );
      }

      // Try secure implementation
      try {
        execSync('npx --yes mcp_server_filesystem --help', {
          stdio: 'pipe',
          timeout: 30000,
        });
        console.log('✅ Secure File System MCP server is available');
        return;
      } catch {
        throw new Error('No compatible File System MCP server found');
      }
    } catch (error) {
      throw new Error(
        `Failed to verify File System MCP server availability: ${error}`,
      );
    }
  }

  getServerConfig(options: FileSystemIntegrationOptions = {}): MCPServerConfig {
    const {
      allowedDirectories = [this.getWorkspaceRoot()],
      readOnly = false,
      watchFiles = true,
      maxFileSize = 10 * 1024 * 1024, // 10MB default
      timeout = 30000,
      includeTools,
      excludeTools,
    } = options;

    // Validate and resolve allowed directories
    const resolvedDirectories = allowedDirectories.map((dir) => {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved)) {
        console.warn(
          `⚠️  Directory ${resolved} does not exist, creating it...`,
        );
        this.ensureDirectory(resolved);
      }
      return resolved;
    });

    // Choose the best available server implementation
    const command = 'npx';
    let args: string[] = [];

    // Try to detect which server is available
    const serverOptions = [
      {
        name: 'official',
        args: [
          '--yes',
          '@modelcontextprotocol/server-filesystem',
          ...resolvedDirectories,
        ],
        check: () => {
          try {
            execSync(
              'npx --yes @modelcontextprotocol/server-filesystem --help',
              { stdio: 'ignore' },
            );
            return true;
          } catch {
            return false;
          }
        },
      },
      {
        name: 'enhanced',
        args: ['--yes', 'mcp-file-operations-server'],
        check: () => {
          try {
            execSync('npx --yes mcp-file-operations-server --help', {
              stdio: 'ignore',
            });
            return true;
          } catch {
            return false;
          }
        },
      },
      {
        name: 'secure',
        args: ['--yes', 'mcp_server_filesystem'],
        check: () => {
          try {
            execSync('npx --yes mcp_server_filesystem --help', {
              stdio: 'ignore',
            });
            return true;
          } catch {
            return false;
          }
        },
      },
    ];

    // Use the first available server
    for (const server of serverOptions) {
      if (server.check()) {
        args = server.args;
        console.log(`🔌 Using ${server.name} File System MCP server`);
        break;
      }
    }

    if (args.length === 0) {
      // Fallback to official server
      args = [
        '--yes',
        '@modelcontextprotocol/server-filesystem',
        ...resolvedDirectories,
      ];
    }

    return {
      command,
      args,
      env: {
        // File system configuration
        FS_MCP_ALLOWED_DIRECTORIES: resolvedDirectories.join(':'),
        FS_MCP_READ_ONLY: readOnly.toString(),
        FS_MCP_WATCH_FILES: watchFiles.toString(),
        FS_MCP_MAX_FILE_SIZE: maxFileSize.toString(),
        // Security settings
        FS_MCP_FOLLOW_SYMLINKS: 'false',
        FS_MCP_ALLOW_HIDDEN: 'true',
      },
      timeout,
      trust: true,
      description: this.description,
      includeTools,
      excludeTools,
    };
  }

  async validateConfig(config: MCPServerConfig): Promise<boolean> {
    if (!config.command || config.command !== 'npx') {
      console.error('❌ Invalid command configuration for File System MCP');
      return false;
    }

    if (!config.args || config.args.length < 2) {
      console.error('❌ Invalid args configuration for File System MCP');
      return false;
    }

    // Validate allowed directories
    const allowedDirs =
      config.env?.['FS_MCP_ALLOWED_DIRECTORIES']?.split(':') || [];
    for (const dir of allowedDirs) {
      if (!fs.existsSync(dir)) {
        console.error(`❌ Allowed directory does not exist: ${dir}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Install with read-only access to specific directories
   */
  async installReadOnly(directories: string[]): Promise<void> {
    await this.install({
      allowedDirectories: directories,
      readOnly: true,
      watchFiles: false,
      includeTools: [
        'read_file',
        'list_directory',
        'search_files',
        'get_file_info',
        'read_multiple_files',
      ],
    });
  }

  /**
   * Install with full access for development
   */
  async installDevelopment(projectRoot?: string): Promise<void> {
    const directories = projectRoot ? [projectRoot] : [this.getWorkspaceRoot()];

    await this.install({
      allowedDirectories: directories,
      readOnly: false,
      watchFiles: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB for development
      includeTools: [
        'read_file',
        'write_file',
        'create_directory',
        'list_directory',
        'move_file',
        'copy_file',
        'delete_file',
        'search_files',
        'watch_files',
      ],
    });
  }

  /**
   * Install with monitoring capabilities
   */
  async installWithMonitoring(directories: string[]): Promise<void> {
    await this.install({
      allowedDirectories: directories,
      readOnly: false,
      watchFiles: true,
      includeTools: [
        'read_file',
        'write_file',
        'list_directory',
        'search_files',
        'watch_files',
        'get_file_changes',
        'monitor_directory',
      ],
    });
  }

  /**
   * Get available file system operation tools
   */
  getAvailableTools(): string[] {
    return [
      // Basic file operations
      'read_file', // Read file contents
      'write_file', // Write to files
      'append_file', // Append to files
      'delete_file', // Delete files
      'copy_file', // Copy files
      'move_file', // Move/rename files

      // Directory operations
      'list_directory', // List directory contents
      'create_directory', // Create directories
      'delete_directory', // Delete directories
      'copy_directory', // Copy directories recursively
      'move_directory', // Move/rename directories

      // Search and query operations
      'search_files', // Search for files by name/pattern
      'search_content', // Search within file contents
      'find_files', // Advanced file finding
      'get_file_info', // Get file metadata
      'get_directory_size', // Calculate directory size

      // Batch operations
      'read_multiple_files', // Read multiple files at once
      'write_multiple_files', // Write multiple files
      'process_files', // Process files in batch

      // Monitoring operations
      'watch_files', // Watch files for changes
      'monitor_directory', // Monitor directory changes
      'get_file_changes', // Get change notifications
      'stop_watching', // Stop file watching

      // Advanced operations
      'create_symlink', // Create symbolic links
      'get_file_permissions', // Get file permissions
      'set_file_permissions', // Set file permissions
      'compress_files', // Compress files/directories
      'extract_archive', // Extract compressed files

      // Streaming operations (for large files)
      'stream_read', // Stream large file reading
      'stream_write', // Stream large file writing
      'patch_file', // Apply patches to files
    ];
  }

  /**
   * Get usage examples for common file system tasks
   */
  getUsageExamples(): Record<string, string> {
    return {
      'Read a file': 'Read the contents of package.json',
      'Write to a file': 'Write "Hello World" to hello.txt',
      'List directory': 'List all files in the src/ directory',
      'Search files': 'Find all TypeScript files in the project',
      'Search content': 'Search for "TODO" in all JavaScript files',
      'Copy files': 'Copy all .ts files from src/ to dist/',
      'Monitor changes': 'Watch the src/ directory for file changes',
      'Create directory': 'Create a new directory called "components"',
      'Get file info': 'Get information about the README.md file',
      'Compress directory': 'Create a zip archive of the project folder',
    };
  }

  /**
   * Get security best practices
   */
  getSecurityBestPractices(): string[] {
    return [
      '🔒 Always specify explicit allowed directories',
      '🚫 Avoid granting access to system directories (/, /etc, /usr)',
      '👀 Use read-only mode for sensitive operations',
      '📁 Regularly review and audit allowed directories',
      '🔍 Monitor file access patterns for suspicious activity',
      '💾 Set reasonable file size limits to prevent abuse',
      '🔗 Disable symlink following in production environments',
      '🛡️  Validate file paths to prevent directory traversal attacks',
      '📝 Log all file system operations for security audits',
    ];
  }

  /**
   * Get recommended directory structures for different use cases
   */
  getRecommendedDirectories(): Record<string, string[]> {
    const workspaceRoot = this.getWorkspaceRoot();

    return {
      'Development Project': [
        path.join(workspaceRoot, 'src'),
        path.join(workspaceRoot, 'docs'),
        path.join(workspaceRoot, 'tests'),
        path.join(workspaceRoot, 'config'),
      ],
      'Content Management': [
        path.join(workspaceRoot, 'content'),
        path.join(workspaceRoot, 'assets'),
        path.join(workspaceRoot, 'templates'),
      ],
      'Data Processing': [
        path.join(workspaceRoot, 'data', 'input'),
        path.join(workspaceRoot, 'data', 'output'),
        path.join(workspaceRoot, 'data', 'processed'),
      ],
      Documentation: [
        path.join(workspaceRoot, 'docs'),
        path.join(workspaceRoot, 'README.md'),
        path.join(workspaceRoot, 'examples'),
      ],
    };
  }
}
