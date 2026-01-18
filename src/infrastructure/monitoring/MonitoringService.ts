import { FileLogger } from '../logging/FileLogger.js';
import { AdminBot, ErrorDetails } from '../telegram/AdminBot.js';

export class MonitoringService {
  private static instance: MonitoringService | null = null;
  private readonly fileLogger: FileLogger;
  private adminBot: AdminBot | null = null;

  private constructor() {
    this.fileLogger = FileLogger.getInstance();
  }

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  setAdminBot(bot: AdminBot): void {
    this.adminBot = bot;
  }

  async logUserRegistered(userId: string, username: string | null, firstName: string): Promise<void> {
    this.fileLogger.logUserRegistered(userId, username, firstName);
    await this.adminBot?.notifyUserRegistered(userId, username, firstName);
  }

  async logSearchAdded(userId: string, userName: string, provider: string, url: string): Promise<void> {
    this.fileLogger.logSearchAdded(userId, userName, provider, url);
    await this.adminBot?.notifySearchAdded(userName, provider);
  }

  async logSearchUpdated(userId: string, userName: string, provider: string, url: string): Promise<void> {
    this.fileLogger.logSearchUpdated(userId, userName, provider, url);
    await this.adminBot?.notifySearchUpdated(userName, provider);
  }

  async logSearchRemoved(userId: string, userName: string, provider: string, url?: string): Promise<void> {
    this.fileLogger.logSearchRemoved(userId, userName, provider, url);
    await this.adminBot?.notifySearchRemoved(userName, provider);
  }

  async logScrapingError(
    provider: string,
    error: Error | string,
    userId?: string,
    url?: string
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    this.fileLogger.logScrapingError(provider, errorMessage, userId, url);

    const details: ErrorDetails = {
      type: error instanceof Error ? error.constructor.name : 'ScrapingError',
      message: errorMessage,
      provider,
      source: 'Scraper',
      stack: error instanceof Error ? error.stack : undefined,
      url,
    };
    await this.adminBot?.notifyError(details);
  }

  async logCriticalError(
    source: string,
    error: Error | string,
    context?: Record<string, unknown>
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    this.fileLogger.logCriticalError(source, errorMessage, context);

    const details: ErrorDetails = {
      type: error instanceof Error ? error.constructor.name : 'Error',
      message: errorMessage,
      source,
      stack: error instanceof Error ? error.stack : undefined,
    };
    await this.adminBot?.notifyError(details);
  }
}
