/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { 
  getAvailableIntegrations,
  getIntegration,
  getIntegrationInfo,
  installIntegration,
  uninstallIntegration,
  PlaywrightMCPIntegration,
  GitMCPIntegration,
  DatabaseMCPIntegration,
  FileSystemMCPIntegration,
} from './integrations/index.js';

interface IntegrateOptions {
  name: string;
  list?: boolean;
  info?: boolean;
  uninstall?: boolean;
  interactive?: boolean;
  // Playwright options
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  preset?: 'development' | 'testing' | 'scraping';
  // Git options
  readOnly?: boolean;
  advanced?: boolean;
  // Database options
  type?: 'sqlite' | 'postgresql' | 'mysql' | 'multi';
  connectionString?: string;
  database?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  // File System options
  directories?: string[];
  watchFiles?: boolean;
}

async function handleIntegration(options: IntegrateOptions) {
  const { name, list, info, uninstall: remove } = options;

  // List available integrations
  if (list) {
    console.log('🔌 Available MCP Integrations:\n');
    const integrations = getAvailableIntegrations();
    
    for (const integration of integrations) {
      console.log(`📦 ${integration.name}`);
      console.log(`   ${integration.description}`);
      console.log('');
    }
    
    console.log('💡 Use "qwen mcp integrate <name>" to install an integration');
    console.log('💡 Use "qwen mcp integrate <name> --info" for detailed information');
    return;
  }

  if (!name) {
    console.error('❌ Integration name is required. Use --list to see available integrations.');
    process.exit(1);
  }

  // Show integration info
  if (info) {
    const integrationInfo = getIntegrationInfo(name);
    if (!integrationInfo) {
      console.error(`❌ Unknown integration: ${name}`);
      process.exit(1);
    }

    console.log(`📦 ${integrationInfo.name}`);
    console.log(`📖 ${integrationInfo.description}\n`);

    if (integrationInfo.tools) {
      console.log('🛠️  Available Tools:');
      integrationInfo.tools.forEach((tool: string) => {
        console.log(`   • ${tool}`);
      });
      console.log('');
    }

    if (integrationInfo.examples) {
      console.log('💡 Usage Examples:');
      Object.entries(integrationInfo.examples).forEach(([task, example]) => {
        console.log(`   ${task}: "${example}"`);
      });
      console.log('');
    }

    if (integrationInfo.security) {
      console.log('🔒 Security Recommendations:');
      integrationInfo.security.forEach((rec: string) => {
        console.log(`   ${rec}`);
      });
      console.log('');
    }

    return;
  }

  // Uninstall integration
  if (remove) {
    try {
      await uninstallIntegration(name);
    } catch (error) {
      console.error(`❌ Failed to uninstall ${name}:`, error);
      process.exit(1);
    }
    return;
  }

  // Install integration
  try {
    const integration = getIntegration(name);
    if (!integration) {
      console.error(`❌ Unknown integration: ${name}`);
      console.log('\n💡 Use "qwen mcp integrate --list" to see available integrations');
      process.exit(1);
    }

    // Handle specific integration types with custom options
    if (integration instanceof PlaywrightMCPIntegration) {
      await installPlaywrightIntegration(integration, options);
    } else if (integration instanceof GitMCPIntegration) {
      await installGitIntegration(integration, options);
    } else if (integration instanceof DatabaseMCPIntegration) {
      await installDatabaseIntegration(integration, options);
    } else if (integration instanceof FileSystemMCPIntegration) {
      await installFileSystemIntegration(integration, options);
    } else {
      // Generic installation
      await installIntegration(name, options);
    }

    console.log(`\n✅ Successfully installed ${name} MCP integration!`);
    console.log('💡 Use "qwen mcp list" to see all configured MCP servers');
    
  } catch (error) {
    console.error(`❌ Failed to install ${name}:`, error);
    process.exit(1);
  }
}

async function installPlaywrightIntegration(
  integration: PlaywrightMCPIntegration, 
  options: IntegrateOptions
) {
  const { preset, headless, browser } = options;

  switch (preset) {
    case 'development':
      await integration.installForDevelopment();
      break;
    case 'testing':
      await integration.installForTesting();
      break;
    case 'scraping':
      await integration.installForScraping();
      break;
    default:
      await integration.install({
        headless: headless ?? true,
        browser: browser ?? 'chromium',
      });
  }
}

async function installGitIntegration(
  integration: GitMCPIntegration, 
  options: IntegrateOptions
) {
  const { readOnly, advanced } = options;

  if (readOnly) {
    await integration.installReadOnly();
  } else if (advanced) {
    await integration.installAdvanced();
  } else {
    await integration.installDevelopment();
  }
}

async function installDatabaseIntegration(
  integration: DatabaseMCPIntegration, 
  options: IntegrateOptions
) {
  const { 
    type, 
    connectionString, 
    database, 
    host, 
    port, 
    username, 
    password,
    readOnly 
  } = options;

  const dbOptions: any = {
    databaseType: type || 'sqlite',
    readOnly: readOnly ?? true,
  };

  if (connectionString) {
    dbOptions.connectionString = connectionString;
  } else if (database) {
    dbOptions.database = database;
    dbOptions.host = host || 'localhost';
    if (port) dbOptions.port = port;
    if (username) dbOptions.username = username;
    if (password) dbOptions.password = password;
  }

  await integration.install(dbOptions);
}

async function installFileSystemIntegration(
  integration: FileSystemMCPIntegration, 
  options: IntegrateOptions
) {
  const { directories, readOnly, watchFiles } = options;

  if (readOnly && directories) {
    await integration.installReadOnly(directories);
  } else if (directories && watchFiles) {
    await integration.installWithMonitoring(directories);
  } else {
    await integration.installDevelopment();
  }
}

export const integrateCommand: CommandModule = {
  command: 'integrate [name]',
  describe: 'Install and manage pre-configured MCP integrations',
  builder: (yargs) => {
    return yargs
      .positional('name', {
        describe: 'Name of the integration to install',
        type: 'string',
      })
      .option('list', {
        alias: 'l',
        describe: 'List available integrations',
        type: 'boolean',
      })
      .option('info', {
        alias: 'i',
        describe: 'Show detailed information about an integration',
        type: 'boolean',
      })
      .option('uninstall', {
        alias: 'u',
        describe: 'Uninstall an integration',
        type: 'boolean',
      })
      .option('interactive', {
        describe: 'Interactive installation with guided setup',
        type: 'boolean',
        default: false,
      })
      // Playwright options
      .option('headless', {
        describe: 'Run browser in headless mode (Playwright)',
        type: 'boolean',
      })
      .option('browser', {
        describe: 'Browser type for Playwright',
        choices: ['chromium', 'firefox', 'webkit'] as const,
      })
      .option('preset', {
        describe: 'Playwright preset configuration',
        choices: ['development', 'testing', 'scraping'] as const,
      })
      // Git options
      .option('read-only', {
        describe: 'Install in read-only mode (Git)',
        type: 'boolean',
      })
      .option('advanced', {
        describe: 'Enable advanced/dangerous Git operations',
        type: 'boolean',
      })
      // Database options
      .option('type', {
        describe: 'Database type',
        choices: ['sqlite', 'postgresql', 'mysql', 'multi'] as const,
      })
      .option('connection-string', {
        describe: 'Database connection string',
        type: 'string',
      })
      .option('database', {
        describe: 'Database name',
        type: 'string',
      })
      .option('host', {
        describe: 'Database host',
        type: 'string',
      })
      .option('port', {
        describe: 'Database port',
        type: 'number',
      })
      .option('username', {
        describe: 'Database username',
        type: 'string',
      })
      .option('password', {
        describe: 'Database password',
        type: 'string',
      })
      // File System options
      .option('directories', {
        describe: 'Allowed directories (File System)',
        type: 'array',
        string: true,
      })
      .option('watch-files', {
        describe: 'Enable file watching (File System)',
        type: 'boolean',
      })
      .example([
        ['$0 mcp integrate --list', 'List all available integrations'],
        ['$0 mcp integrate playwright --info', 'Show Playwright integration details'],
        ['$0 mcp integrate playwright --preset=development', 'Install Playwright for development'],
        ['$0 mcp integrate git-advanced --read-only', 'Install Git integration in read-only mode'],
        ['$0 mcp integrate database-sqlite --type=sqlite', 'Install SQLite database integration'],
        ['$0 mcp integrate filesystem --directories=./src,./docs', 'Install File System with specific directories'],
      ]);
  },
  handler: (args: any) => handleIntegration(args as IntegrateOptions),
};