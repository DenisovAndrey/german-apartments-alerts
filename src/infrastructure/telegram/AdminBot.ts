import { Telegraf, Context } from 'telegraf';
import { DatabaseConnection } from '../database/Database.js';
import { ILogger, LoggerFactory } from '../logging/Logger.js';
import { FileLogger, LogEvent } from '../logging/FileLogger.js';
import { MonitoringService } from '../monitoring/MonitoringService.js';
import * as fs from 'fs';
import * as path from 'path';

export interface ErrorDetails {
  type: string;
  message: string;
  provider?: string;
  source?: string;
  stack?: string;
  url?: string;
}

export class AdminBot {
  private readonly bot: Telegraf;
  private readonly logger: ILogger;
  private readonly adminUserId: number | null;
  private backupInterval: NodeJS.Timeout | null = null;

  constructor(
    token: string,
    private readonly db: DatabaseConnection,
    adminUserId?: string
  ) {
    this.logger = LoggerFactory.create('AdminBot');
    this.bot = new Telegraf(token);
    this.adminUserId = adminUserId ? parseInt(adminUserId, 10) : null;
    this.setupCommands();
  }

  private isAuthorized(ctx: Context): boolean {
    const userId = ctx.from?.id;
    return !!(userId && this.adminUserId && userId === this.adminUserId);
  }

  private setupCommands(): void {
    this.bot.command('users', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;

      try {
        const users = await this.db.getAllUsers();
        if (users.length === 0) {
          await ctx.reply('No users registered.');
          return;
        }

        const lines: string[] = [];
        let activeCount = 0;
        for (const user of users) {
          const providers = await this.db.getUserProviders(user.id);
          const name = user.username ? `@${user.username}` : user.first_name;
          const isActive = providers.length > 0;
          if (isActive) activeCount++;
          lines.push(`• ${name} - ${providers.length} provider(s)${isActive ? '' : ' (inactive)'}`);
        }
        const header = `Users: ${users.length} total, ${activeCount} active\n`;
        await ctx.reply(header + lines.join('\n'));
      } catch (err) {
        this.logger.error('Error in /users command', err as Error);
      }
    });

    this.bot.command('count', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;

      try {
        const users = await this.db.getAllUsers();
        let activeCount = 0;
        for (const user of users) {
          const providers = await this.db.getUserProviders(user.id);
          if (providers.length > 0) activeCount++;
        }
        await ctx.reply(`Total users: ${users.length}\nActive users: ${activeCount}`);
      } catch (err) {
        this.logger.error('Error in /count command', err as Error);
      }
    });

    this.bot.command('count_queries', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;

      try {
        const users = await this.db.getAllUsers();
        const counts: Record<string, number> = {};

        for (const user of users) {
          const providers = await this.db.getUserProviders(user.id);
          for (const p of providers) {
            counts[p.provider] = (counts[p.provider] || 0) + 1;
          }
        }

        if (Object.keys(counts).length === 0) {
          await ctx.reply('No queries configured.');
          return;
        }

        const lines = ['Queries by provider:'];
        for (const [provider, count] of Object.entries(counts)) {
          lines.push(`• ${provider}: ${count}`);
        }
        lines.push(`\nTotal: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
        await ctx.reply(lines.join('\n'));
      } catch (err) {
        this.logger.error('Error in /count_queries command', err as Error);
      }
    });

    this.bot.command('logs', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;

      try {
        const logs = FileLogger.getInstance().getRecentLogs(20);
        if (logs.length === 0) {
          await ctx.reply('No logs found.');
          return;
        }

        const formatted = logs.map((log) => this.formatLogEntry(log)).join('\n\n');
        const message = `Recent logs (${logs.length}):\n\n${formatted}`.substring(0, 4000);
        await ctx.reply(message);
      } catch (err) {
        this.logger.error('Error in /logs command', err as Error);
      }
    });

    this.bot.command('backup', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;
      await this.sendBackup();
    });

    this.bot.command('toggle_errors', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;

      try {
        const monitoring = MonitoringService.getInstance();
        const currentState = monitoring.isErrorAlertsEnabled();
        monitoring.setErrorAlertsEnabled(!currentState);
        const newState = !currentState ? 'enabled' : 'disabled';
        await ctx.reply(`🔔 Scraping error alerts ${newState}`);
      } catch (err) {
        this.logger.error('Error in /toggle_errors command', err as Error);
      }
    });
  }

  private formatLogEntry(log: LogEvent): string {
    const time = new Date(log.timestamp).toLocaleString('en-GB', { timeZone: 'Europe/Berlin' });
    const icon = this.getLogIcon(log.type);
    const details = this.formatLogData(log.type, log.data);
    return `${icon} [${time}]\n${details}`;
  }

  private getLogIcon(type: string): string {
    const icons: Record<string, string> = {
      USER_REGISTERED: '👤',
      SEARCH_ADDED: '➕',
      SEARCH_UPDATED: '✏️',
      SEARCH_REMOVED: '➖',
      SCRAPING_ERROR: '⚠️',
      CRITICAL_ERROR: '🚨',
    };
    return icons[type] || '📝';
  }

  private formatLogData(type: string, data: Record<string, unknown>): string {
    switch (type) {
      case 'USER_REGISTERED':
        return `New user: ${data.username ? `@${data.username}` : data.firstName}`;
      case 'SEARCH_ADDED':
        return `${data.userName} added ${data.provider}`;
      case 'SEARCH_UPDATED':
        return `${data.userName} updated ${data.provider}`;
      case 'SEARCH_REMOVED':
        return `${data.userName} removed ${data.provider}`;
      case 'SCRAPING_ERROR':
        return `${data.provider}: ${data.error}${data.url ? `\nURL: ${data.url}` : ''}`;
      case 'CRITICAL_ERROR':
        return `${data.source}: ${data.error}`;
      default:
        return JSON.stringify(data);
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting Admin bot...');

    // Set command menu only for the admin user
    if (this.adminUserId) {
      await this.bot.telegram.setMyCommands(
        [
          { command: 'users', description: 'List all users with provider counts' },
          { command: 'count', description: 'Show total and active user counts' },
          { command: 'count_queries', description: 'Show queries by provider' },
          { command: 'logs', description: 'Show recent activity logs' },
          { command: 'backup', description: 'Send database backup file' },
          { command: 'toggle_errors', description: 'Toggle scraping error alerts' },
        ],
        { scope: { type: 'chat', chat_id: this.adminUserId } }
      );
    }

    this.bot.catch((err) => {
      this.logger.error(`Admin bot error: ${err}`);
    });
    this.bot.launch({ dropPendingUpdates: true }).then(() => {
      this.logger.info('Admin bot polling started');
    }).catch((err) => {
      this.logger.error(`Failed to start Admin bot: ${err}`);
    });
  }

  stop(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
    this.bot.stop('SIGTERM');
    this.logger.info('Admin bot stopped');
  }

  startDailyBackup(): void {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    this.backupInterval = setInterval(() => {
      this.sendBackup().catch((err) => {
        this.logger.error('Failed to send daily backup', err as Error);
      });
    }, TWENTY_FOUR_HOURS);
    this.logger.info('Daily backup scheduled');
  }

  private async sendBackup(): Promise<void> {
    if (!this.adminUserId) return;

    try {
      const data = await this.db.exportAllData();
      const backupDir = './data';
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `backup-${timestamp}.json`;
      const filepath = path.join(backupDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');

      await this.bot.telegram.sendDocument(this.adminUserId, {
        source: filepath,
        filename,
      }, {
        caption: `📦 Database backup\nUsers: ${data.users.length}\nProviders: ${data.providers.length}`,
      });

      fs.unlinkSync(filepath);
      this.logger.info('Backup sent successfully');
    } catch (err) {
      this.logger.error('Failed to send backup', err as Error);
      await this.sendNotification(`❌ Backup failed: ${err}`);
    }
  }

  async notifyUserRegistered(_userId: string, username: string | null, firstName: string): Promise<void> {
    const name = username ? `@${username}` : firstName;
    await this.sendNotification(`👤 New user: ${name}`);
  }

  async notifySearchAdded(userName: string, provider: string): Promise<void> {
    await this.sendNotification(`➕ ${userName} added ${provider} search`);
  }

  async notifySearchUpdated(userName: string, provider: string): Promise<void> {
    await this.sendNotification(`✏️ ${userName} updated ${provider} search`);
  }

  async notifySearchRemoved(userName: string, provider: string): Promise<void> {
    await this.sendNotification(`➖ ${userName} removed ${provider} search`);
  }

  async notifyError(details: ErrorDetails): Promise<void> {
    const lines = ['🚨 Error'];
    if (details.source) lines[0] += ` in ${details.source}`;
    if (details.provider) lines[0] += ` [${details.provider}]`;
    lines.push('');
    lines.push(`Type: ${details.type}`);
    lines.push(`Message: ${details.message}`);
    if (details.url) {
      lines.push(`URL: ${details.url}`);
    }
    if (details.stack) {
      const trimmedStack = details.stack.split('\n').slice(0, 5).join('\n');
      lines.push(`\nStack:\n${trimmedStack}`);
    }
    const message = lines.join('\n').substring(0, 4000);
    await this.sendNotification(message);
  }

  private async sendNotification(message: string): Promise<void> {
    if (!this.adminUserId) return;
    try {
      await this.bot.telegram.sendMessage(this.adminUserId, message);
    } catch (err) {
      this.logger.error(`Failed to send admin notification: ${err}`);
    }
  }
}
