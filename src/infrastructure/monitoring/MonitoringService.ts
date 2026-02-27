import { FileLogger } from '../logging/FileLogger.js';
import { AdminBot, ErrorDetails } from '../telegram/AdminBot.js';

const CONSECUTIVE_FAILURES_THRESHOLD = 4; // Notify after 4 failed iterations in a row

export class MonitoringService {
  private static instance: MonitoringService | null = null;
  private readonly fileLogger: FileLogger;
  private adminBot: AdminBot | null = null;
  private errorAlertsEnabled = true;
  private currentIterationErrors: Map<string, string[]> = new Map(); // provider -> userIds
  private consecutiveFailedIterations = 0;
  private notifiedForCurrentStreak = false;

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

  onIterationStart(): void {
    this.currentIterationErrors = new Map();
  }

  async onIterationEnd(): Promise<void> {
    if (this.currentIterationErrors.size > 0) {
      this.consecutiveFailedIterations++;

      if (
        this.errorAlertsEnabled &&
        this.consecutiveFailedIterations >= CONSECUTIVE_FAILURES_THRESHOLD &&
        !this.notifiedForCurrentStreak
      ) {
        this.notifiedForCurrentStreak = true;

        const providerSummary = Array.from(this.currentIterationErrors.entries())
          .map(([p, users]) => `${p}: ${users.length}`)
          .join(', ');

        const totalUsers = new Set(
          Array.from(this.currentIterationErrors.values()).flat()
        ).size;

        const details: ErrorDetails = {
          type: 'ScrapingError',
          message: `${this.consecutiveFailedIterations} consecutive iterations with errors.\n${totalUsers} users affected in last iteration.\nBy provider: ${providerSummary}`,
          provider: 'Multiple',
          source: 'Scraper',
        };
        await this.adminBot?.notifyError(details);
      }
    } else {
      this.consecutiveFailedIterations = 0;
      this.notifiedForCurrentStreak = false;
    }
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

    const userKey = userId || url || 'unknown';
    const existing = this.currentIterationErrors.get(provider) || [];
    if (!existing.includes(userKey)) {
      existing.push(userKey);
    }
    this.currentIterationErrors.set(provider, existing);
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
