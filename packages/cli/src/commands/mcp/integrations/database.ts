/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MCPServerConfig } from '@qwen-code/qwen-code-core';
import { BaseMCPIntegration } from './base.js';
import { execSync } from 'child_process';

export interface DatabaseIntegrationOptions {
  databaseType: 'sqlite' | 'postgresql' | 'mysql' | 'multi';
  connectionString?: string;
  databasePath?: string; // For SQLite
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  readOnly?: boolean;
  timeout?: number;
  includeTools?: string[];
  excludeTools?: string[];
}

/**
 * Database MCP Integration
 * Provides SQL database access for SQLite, PostgreSQL, and MySQL
 */
export class DatabaseMCPIntegration extends BaseMCPIntegration {
  private databaseType: string;

  constructor(
    databaseType: 'sqlite' | 'postgresql' | 'mysql' | 'multi' = 'multi',
  ) {
    super(
      `database-${databaseType}`,
      `${databaseType.toUpperCase()} database access with SQL query execution, schema inspection, and data analysis capabilities.`,
    );
    this.databaseType = databaseType;
  }

  async checkDependencies(): Promise<boolean> {
    // Check if Node.js version is compatible
    if (!this.checkNodeVersion('18.0.0')) {
      console.error(
        '❌ Node.js version 18.0.0 or higher is required for Database MCP',
      );
      return false;
    }

    // Check if npm is available
    if (!this.commandExists('npm')) {
      console.error('❌ npm is required but not found');
      return false;
    }

    // Check database-specific dependencies
    switch (this.databaseType) {
      case 'sqlite':
        // SQLite doesn't require external database installation
        break;
      case 'postgresql':
        // Check if psql is available (optional but recommended)
        if (!this.commandExists('psql')) {
          console.warn(
            '⚠️  PostgreSQL client (psql) not found. MCP server will still work, but some features may be limited.',
          );
        }
        break;
      case 'mysql':
        // Check if mysql client is available (optional but recommended)
        if (!this.commandExists('mysql')) {
          console.warn(
            '⚠️  MySQL client not found. MCP server will still work, but some features may be limited.',
          );
        }
        break;
      default:
        throw new Error(`Unsupported database type: ${this.databaseType}`);
    }

    return true;
  }

  async installDependencies(): Promise<void> {
    try {
      switch (this.databaseType) {
        case 'sqlite':
          console.log('📦 Installing SQLite MCP server...');
          // Try official SQLite MCP server first
          try {
            execSync('npx --yes @modelcontextprotocol/server-sqlite --help', {
              stdio: 'pipe',
              timeout: 30000,
            });
            console.log('✅ Official SQLite MCP server available');
          } catch {
            // Fallback to community implementation
            execSync('npx --yes mcp-sqlite --help', {
              stdio: 'pipe',
              timeout: 30000,
            });
            console.log('✅ Community SQLite MCP server available');
          }
          break;

        case 'postgresql':
          console.log('📦 Installing PostgreSQL MCP server...');
          try {
            execSync('npx --yes @modelcontextprotocol/server-postgres --help', {
              stdio: 'pipe',
              timeout: 30000,
            });
            console.log('✅ Official PostgreSQL MCP server available');
          } catch {
            // Fallback to community implementation
            execSync('npx --yes postgres-mcp --help', {
              stdio: 'pipe',
              timeout: 30000,
            });
            console.log('✅ Community PostgreSQL MCP server available');
          }
          break;

        case 'mysql':
          console.log('📦 Installing MySQL MCP server...');
          execSync('npx --yes mcp-server-mysql --help', {
            stdio: 'pipe',
            timeout: 30000,
          });
          console.log('✅ MySQL MCP server available');
          break;

        case 'multi':
          console.log('📦 Installing Multi-database MCP server...');
          // Install the comprehensive mcp-alchemy server
          try {
            execSync('pip install mcp-alchemy', {
              stdio: 'inherit',
              timeout: 60000,
            });
            console.log('✅ MCP Alchemy multi-database server installed');
          } catch {
            // Try with uvx if pip fails
            execSync('uvx --from mcp-alchemy mcp-alchemy --help', {
              stdio: 'pipe',
              timeout: 30000,
            });
            console.log('✅ MCP Alchemy available via uvx');
          }
          break;
        default:
          throw new Error(`Unsupported database type: ${this.databaseType}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to install ${this.databaseType} MCP server: ${error}`,
      );
    }
  }

  getServerConfig(options?: Record<string, unknown>): MCPServerConfig {
    const dbOptions = (options as unknown as DatabaseIntegrationOptions) || {
      databaseType: this.databaseType as
        | 'sqlite'
        | 'postgresql'
        | 'mysql'
        | 'multi',
    };
    const {
      connectionString,
      databasePath,
      host = 'localhost',
      port,
      database,
      username,
      password,
      readOnly = true,
      timeout = 30000,
      includeTools,
      excludeTools,
    } = dbOptions;

    let command: string;
    let args: string[];
    const env: Record<string, string> = {};

    switch (this.databaseType) {
      case 'sqlite':
        command = 'npx';
        args = ['--yes', '@modelcontextprotocol/server-sqlite'];
        if (databasePath) {
          args.push(databasePath);
        }
        break;

      case 'postgresql':
        command = 'npx';
        args = ['--yes', '@modelcontextprotocol/server-postgres'];
        if (connectionString) {
          env['DATABASE_URL'] = connectionString;
        } else if (host && database) {
          const defaultPort = port || 5432;
          env['DATABASE_URL'] =
            `postgresql://${username}:${password}@${host}:${defaultPort}/${database}`;
        }
        break;

      case 'mysql':
        command = 'npx';
        args = ['--yes', 'mcp-server-mysql'];
        if (connectionString) {
          env['DATABASE_URL'] = connectionString;
        } else if (host && database) {
          const defaultPort = port || 3306;
          env['MYSQL_HOST'] = host;
          env['MYSQL_PORT'] = defaultPort.toString();
          env['MYSQL_DATABASE'] = database;
          env['MYSQL_USER'] = username || 'root';
          if (password) {
            env['MYSQL_PASSWORD'] = password;
          }
        }
        break;

      case 'multi':
        command = 'uvx';
        args = ['--from', 'mcp-alchemy', 'mcp-alchemy'];
        if (connectionString) {
          env['DB_URL'] = connectionString;
        }
        break;

      default:
        throw new Error(`Unsupported database type: ${this.databaseType}`);
    }

    // Add read-only configuration
    if (readOnly) {
      env['READ_ONLY'] = 'true';
      env['ALLOW_DDL'] = 'false';
      env['ALLOW_DML_WRITE'] = 'false';
    }

    return {
      command,
      args,
      env,
      timeout,
      trust: true,
      description: this.description,
      includeTools,
      excludeTools,
    };
  }

  async validateConfig(config: MCPServerConfig): Promise<boolean> {
    if (!config.command) {
      console.error('❌ No command specified for Database MCP');
      return false;
    }

    // Validate database-specific requirements
    switch (this.databaseType) {
      case 'sqlite':
        if (config.args && config.args.length > 2) {
          const dbPath = config.args[config.args.length - 1];
          if (!this.fileExists(dbPath) && !dbPath.includes(':memory:')) {
            console.warn(
              `⚠️  SQLite database file ${dbPath} does not exist. It will be created when first accessed.`,
            );
          }
        }
        break;

      case 'postgresql':
      case 'mysql':
        if (!config.env?.['DATABASE_URL'] && !config.env?.['MYSQL_HOST']) {
          console.error(
            `❌ Database connection information missing for ${this.databaseType}`,
          );
          return false;
        }
        break;

      case 'multi':
        if (!config.env?.['DB_URL']) {
          console.error('❌ Database URL missing for multi-database MCP');
          return false;
        }
        break;
      default:
        console.error(`❌ Unsupported database type: ${this.databaseType}`);
        return false;
    }

    return true;
  }

  /**
   * Install SQLite with a specific database file
   */
  async installSQLite(databasePath: string): Promise<void> {
    await this.install({
      databaseType: 'sqlite',
      databasePath,
      readOnly: false,
    });
  }

  /**
   * Install PostgreSQL with connection details
   */
  async installPostgreSQL(options: {
    host: string;
    port?: number;
    database: string;
    username: string;
    password?: string;
    readOnly?: boolean;
  }): Promise<void> {
    await this.install({
      databaseType: 'postgresql',
      ...options,
    });
  }

  /**
   * Install MySQL with connection details
   */
  async installMySQL(options: {
    host: string;
    port?: number;
    database: string;
    username: string;
    password?: string;
    readOnly?: boolean;
  }): Promise<void> {
    await this.install({
      databaseType: 'mysql',
      ...options,
    });
  }

  /**
   * Install multi-database support with connection string
   */
  async installMultiDatabase(connectionString: string): Promise<void> {
    await this.install({
      databaseType: 'multi',
      connectionString,
      readOnly: true,
    });
  }

  /**
   * Get available database operation tools
   */
  getAvailableTools(): string[] {
    const commonTools = [
      'query', // Execute SQL queries
      'list_tables', // List all tables
      'describe_table', // Get table schema
      'list_columns', // List columns in a table
      'get_table_info', // Get detailed table information
    ];

    const readWriteTools = [
      'create_table', // Create new tables
      'drop_table', // Delete tables
      'insert_data', // Insert data
      'update_data', // Update data
      'delete_data', // Delete data
      'create_index', // Create indexes
      'drop_index', // Delete indexes
    ];

    switch (this.databaseType) {
      case 'sqlite':
        return [
          ...commonTools,
          'attach_database', // Attach additional databases
          'detach_database', // Detach databases
          'vacuum', // Optimize database
          'analyze', // Update query planner statistics
          ...readWriteTools,
        ];

      case 'postgresql':
        return [
          ...commonTools,
          'list_schemas', // List database schemas
          'list_functions', // List stored functions
          'list_views', // List views
          'explain_query', // Get query execution plan
          'analyze_performance', // Performance analysis
          ...readWriteTools,
        ];

      case 'mysql':
        return [
          ...commonTools,
          'list_databases', // List all databases
          'show_processlist', // Show running processes
          'explain_query', // Get query execution plan
          ...readWriteTools,
        ];

      case 'multi':
        return [
          ...commonTools,
          'list_databases',
          'list_schemas',
          'migrate_data', // Data migration between databases
          'compare_schemas', // Compare database schemas
          'sync_data', // Synchronize data between databases
          ...readWriteTools,
        ];

      default:
        return commonTools;
    }
  }

  /**
   * Get usage examples for common database tasks
   */
  getUsageExamples(): Record<string, string> {
    const examples: Record<string, string> = {
      'List all tables': 'Show me all tables in the database',
      'Describe table structure': 'Describe the structure of the "users" table',
      'Query data': 'SELECT * FROM users WHERE age > 25',
      'Count records': 'Count the number of records in the "orders" table',
      'Find duplicates': 'Find duplicate email addresses in the users table',
    };

    switch (this.databaseType) {
      case 'sqlite':
        return {
          ...examples,
          'Attach database': 'Attach another SQLite database file',
          'Vacuum database': 'Optimize the database file size',
          'Create table': 'Create a new table for storing products',
        };

      case 'postgresql':
        return {
          ...examples,
          'List schemas': 'Show all schemas in the database',
          'Explain query': 'Explain the execution plan for a complex query',
          'Performance analysis':
            'Analyze slow queries and suggest optimizations',
        };

      case 'mysql':
        return {
          ...examples,
          'Show databases': 'List all available databases',
          'Show processlist': 'Show currently running database processes',
          'Optimize table': 'Optimize the "large_table" for better performance',
        };

      case 'multi':
        return {
          ...examples,
          'Compare schemas':
            'Compare schema differences between development and production',
          'Migrate data': 'Migrate data from MySQL to PostgreSQL',
          'Sync databases': 'Synchronize data between two database instances',
        };
      default:
        return examples;
    }
  }

  /**
   * Get security recommendations
   */
  getSecurityRecommendations(): string[] {
    return [
      '🔒 Always use read-only mode in production environments',
      '🔑 Use environment variables for database credentials',
      '🚫 Never expose database passwords in configuration files',
      '🛡️  Validate and sanitize all user inputs before querying',
      '📊 Monitor database access and query patterns',
      '🔐 Use SSL/TLS connections for remote databases',
      '👤 Create dedicated database users with minimal privileges',
      '📝 Audit database access and maintain query logs',
    ];
  }
}
