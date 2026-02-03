import { FileLogger } from '../logging/FileLogger.js';
import { AdminBot, ErrorDetails } from '../telegram/AdminBot.js';

interface RecentError {
  provider: string;
  userId?: string;
  url?: string;
  message: string;
  timestamp: number;
}

const ERROR_WINDOW_MS = 60 * 1000; // 60 seconds
const ERROR_THRESHOLD = 4; // Notify when 4+ unique users have errors

export class MonitoringService {
  private static instance: MonitoringService | null = null;
  private readonly fileLogger: FileLogger;
  private adminBot: AdminBot | null = null;
  private errorAlertsEnabled = true;
  private recentErrors: RecentError[] = [];
  private lastNotificationTime = 0;

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

  setErrorAlertsEnabled(enabled: boolean): void {
    this.errorAlertsEnabled = enabled;
  }

  isErrorAlertsEnabled(): boolean {
    return this.errorAlertsEnabled;
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
    url?: string,
    _userName?: string
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    this.fileLogger.logScrapingError(provider, errorMessage, userId, url);

    if (!this.errorAlertsEnabled) return;

    // Add to recent errors
    const now = Date.now();
    this.recentErrors.push({
      provider,
      userId,
      url,
      message: errorMessage,
      timestamp: now,
    });

    // Clean up old errors outside the window
    this.recentErrors = this.recentErrors.filter(
      (e) => now - e.timestamp < ERROR_WINDOW_MS
    );

    // Count unique users with errors
    const uniqueUsers = new Set(this.recentErrors.map((e) => e.userId || e.url));

    // Only notify if threshold reached and we haven't notified recently
    if (uniqueUsers.size >= ERROR_THRESHOLD && now - this.lastNotificationTime > ERROR_WINDOW_MS) {
      this.lastNotificationTime = now;

      // Group errors by provider
      const byProvider = new Map<string, number>();
      for (const e of this.recentErrors) {
        byProvider.set(e.provider, (byProvider.get(e.provider) || 0) + 1);
      }

      const providerSummary = Array.from(byProvider.entries())
        .map(([p, count]) => `${p}: ${count}`)
        .join(', ');

      const details: ErrorDetails = {
        type: 'ScrapingError',
        message: `${uniqueUsers.size} users affected in last 60 seconds.\nBy provider: ${providerSummary}`,
        provider: 'Multiple',
        source: 'Scraper',
      };
      await this.adminBot?.notifyError(details);
    }
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
