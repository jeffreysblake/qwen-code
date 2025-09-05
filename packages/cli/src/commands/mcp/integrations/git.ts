/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MCPServerConfig } from '@qwen-code/qwen-code-core';
import { BaseMCPIntegration } from './base.js';
import { execSync } from 'child_process';

export interface GitIntegrationOptions {
  repositoryPath?: string;
  allowWrite?: boolean;
  allowDangerousOperations?: boolean;
  timeout?: number;
  includeTools?: string[];
  excludeTools?: string[];
}

/**
 * Git MCP Integration
 * Provides advanced Git operations including merge conflict resolution
 */
export class GitMCPIntegration extends BaseMCPIntegration {
  constructor() {
    super(
      'git-advanced',
      'Advanced Git operations including merge, rebase, conflict resolution, and repository management. Provides AI-powered assistance for complex Git workflows.'
    );
  }

  async checkDependencies(): Promise<boolean> {
    // Check if Node.js version is compatible (>=20.0.0 for the cyanheads implementation)
    if (!this.checkNodeVersion('20.0.0')) {
      console.error('❌ Node.js version 20.0.0 or higher is required for Git MCP');
      return false;
    }

    // Check if Git is installed
    if (!this.commandExists('git')) {
      console.error('❌ Git is required but not found. Please install Git first.');
      return false;
    }

    // Check if npm is available
    if (!this.commandExists('npm')) {
      console.error('❌ npm is required but not found');
      return false;
    }

    return true;
  }

  async installDependencies(): Promise<void> {
    // Install the comprehensive git-mcp-server from cyanheads
    try {
      console.log('📦 Installing git-mcp-server...');
      await this.installPackage('git-mcp-server');
      console.log('✅ Git MCP server installed successfully');
    } catch (_error) {
      // Fallback to npx if global install fails
      console.log('⚠️  Global install failed, will use npx instead');
      try {
        execSync('npx --yes git-mcp-server --help', { stdio: 'pipe', timeout: 30000 });
        console.log('✅ Git MCP server is available via npx');
      } catch (_npxError) {
        throw new Error('Failed to install or verify Git MCP server availability');
      }
    }
  }

  getServerConfig(options: GitIntegrationOptions = {}): MCPServerConfig {
    const {
      repositoryPath = this.getWorkspaceRoot(),
      allowWrite = true,
      allowDangerousOperations = false,
      timeout = 60000, // Git operations can take time
      includeTools,
      excludeTools,
    } = options;

    // Try global install first, fall back to npx
    const useGlobal = this.commandExists('git-mcp-server');

    return {
      command: useGlobal ? 'git-mcp-server' : 'npx',
      args: useGlobal ? [] : ['--yes', 'git-mcp-server'],
      env: {
        // Set the repository path
        GIT_MCP_REPOSITORY_PATH: repositoryPath,
        // Control access levels
        GIT_MCP_ALLOW_WRITE: allowWrite.toString(),
        GIT_MCP_ALLOW_DANGEROUS: allowDangerousOperations.toString(),
        // Set Git configuration for better MCP integration
        GIT_CONFIG_GLOBAL_USER_NAME: this.getGitConfig('user.name') || 'Qwen Code AI',
        GIT_CONFIG_GLOBAL_USER_EMAIL: this.getGitConfig('user.email') || 'ai@qwencode.local',
      },
      timeout,
      trust: true,
      description: this.description,
      includeTools,
      excludeTools,
    };
  }

  async validateConfig(config: MCPServerConfig): Promise<boolean> {
    if (!config.command) {
      console.error('❌ No command specified for Git MCP');
      return false;
    }

    // Validate that the repository path exists and is a git repository
    const repoPath = config.env?.['GIT_MCP_REPOSITORY_PATH'] || this.getWorkspaceRoot();
    if (!this.isGitRepository(repoPath)) {
      console.error(`❌ ${repoPath} is not a Git repository`);
      return false;
    }

    return true;
  }

  /**
   * Install with safe read-only settings
   */
  async installReadOnly(): Promise<void> {
    await this.install({
      allowWrite: false,
      allowDangerousOperations: false,
      includeTools: [
        'git_status',
        'git_log',
        'git_diff',
        'git_show',
        'git_branch_list',
        'git_tag_list',
        'git_remote_list',
        'git_stash_list',
      ],
    });
  }

  /**
   * Install with full write access for development
   */
  async installDevelopment(): Promise<void> {
    await this.install({
      allowWrite: true,
      allowDangerousOperations: false,
      timeout: 120000, // Longer timeout for complex operations
      includeTools: [
        'git_add',
        'git_commit',
        'git_push',
        'git_pull',
        'git_merge',
        'git_checkout',
        'git_branch_create',
        'git_branch_delete',
        'git_stash_save',
        'git_stash_pop',
      ],
    });
  }

  /**
   * Install with advanced operations for repository management
   */
  async installAdvanced(): Promise<void> {
    await this.install({
      allowWrite: true,
      allowDangerousOperations: true,
      timeout: 180000, // Very long timeout for complex operations
      includeTools: [
        'git_rebase',
        'git_cherry_pick',
        'git_reset',
        'git_revert',
        'git_merge_abort',
        'git_rebase_abort',
        'git_worktree_add',
        'git_worktree_remove',
        'git_submodule_update',
        'git_clean',
      ],
    });
  }

  /**
   * Get Git configuration value
   */
  private getGitConfig(key: string): string | null {
    try {
      return execSync(`git config --global ${key}`, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }

  /**
   * Check if a directory is a Git repository
   */
  private isGitRepository(dirPath: string): boolean {
    try {
      execSync(`git -C "${dirPath}" rev-parse --git-dir`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available Git operation tools
   */
  getAvailableTools(): string[] {
    return [
      // Repository management
      'git_init',
      'git_clone',
      'git_status',
      'git_remote_list',
      'git_remote_add',
      'git_remote_remove',
      
      // File operations
      'git_add',
      'git_rm',
      'git_mv',
      'git_checkout_file',
      
      // Commit operations
      'git_commit',
      'git_commit_amend',
      'git_show',
      'git_log',
      'git_diff',
      
      // Branch operations
      'git_branch_list',
      'git_branch_create',
      'git_branch_delete',
      'git_branch_rename',
      'git_checkout',
      'git_switch',
      
      // Merge and rebase
      'git_merge',
      'git_merge_abort',
      'git_rebase',
      'git_rebase_abort',
      'git_cherry_pick',
      
      // Remote operations
      'git_fetch',
      'git_pull',
      'git_push',
      
      // Stash operations
      'git_stash_list',
      'git_stash_save',
      'git_stash_pop',
      'git_stash_drop',
      
      // Advanced operations
      'git_reset',
      'git_revert',
      'git_clean',
      'git_tag_list',
      'git_tag_create',
      'git_tag_delete',
      
      // Worktree operations
      'git_worktree_list',
      'git_worktree_add',
      'git_worktree_remove',
      
      // Submodule operations
      'git_submodule_list',
      'git_submodule_add',
      'git_submodule_update',
    ];
  }

  /**
   * Get usage examples for common Git tasks
   */
  getUsageExamples(): Record<string, string> {
    return {
      'Check repository status': 'Show the current status of the Git repository',
      'Create a new branch': 'Create a new branch called "feature/new-feature"',
      'Merge branches': 'Merge the "feature/new-feature" branch into main',
      'Resolve merge conflicts': 'Help me resolve the merge conflicts in src/app.js',
      'Rebase interactive': 'Start an interactive rebase for the last 3 commits',
      'Cherry-pick commit': 'Cherry-pick commit abc123 from main branch',
      'View commit history': 'Show the last 10 commits with their changes',
      'Push changes': 'Push the current branch to origin',
      'Create and switch branch': 'Create a new branch "hotfix/bug-123" and switch to it',
      'Stash changes': 'Stash the current uncommitted changes',
    };
  }

  /**
   * Get conflict resolution strategies
   */
  getConflictResolutionStrategies(): Record<string, string> {
    return {
      'ours': 'Keep changes from the current branch (ours)',
      'theirs': 'Keep changes from the incoming branch (theirs)',
      'union': 'Keep changes from both branches',
      'patience': 'Use patience algorithm for complex merges',
      'histogram': 'Use histogram algorithm for better merge results',
      'minimal': 'Minimize the size of the diff',
    };
  }
}