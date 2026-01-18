import { Telegraf, Context } from 'telegraf';
import { DatabaseConnection } from '../database/Database.js';
import { ILogger, LoggerFactory } from '../logging/Logger.js';
import { FileLogger, LogEvent } from '../logging/FileLogger.js';

export interface ErrorDetails {
  type: string;
  message: string;
  provider?: string;
  source?: string;
  stack?: string;
}

export class AdminBot {
  private readonly bot: Telegraf;
  private readonly logger: ILogger;
  private readonly adminUserId: number | null;

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

        const lines: string[] = [`Users (${users.length}):`];
        for (const user of users) {
          const providers = await this.db.getUserProviders(user.id);
          const name = user.username ? `@${user.username}` : user.first_name;
          lines.push(`• ${name} - ${providers.length} provider(s)`);
        }
        await ctx.reply(lines.join('\n'));
      } catch (err) {
        this.logger.error('Error in /users command', err as Error);
      }
    });

    this.bot.command('count', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;

      try {
        const users = await this.db.getAllUsers();
        await ctx.reply(`Total users: ${users.length}`);
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
        return `${data.provider}: ${data.error}`;
      case 'CRITICAL_ERROR':
        return `${data.source}: ${data.error}`;
      default:
        return JSON.stringify(data);
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting Admin bot...');
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
    this.bot.stop('SIGTERM');
    this.logger.info('Admin bot stopped');
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
