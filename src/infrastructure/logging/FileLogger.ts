import * as fs from 'fs';
import * as path from 'path';

export type LogEventType =
  | 'USER_REGISTERED'
  | 'SEARCH_ADDED'
  | 'SEARCH_UPDATED'
  | 'SEARCH_REMOVED'
  | 'SCRAPING_ERROR'
  | 'CRITICAL_ERROR';

export interface LogEvent {
  timestamp: string;
  type: LogEventType;
  data: Record<string, unknown>;
}

export class FileLogger {
  private static instance: FileLogger | null = null;
  private readonly logPath: string;

  private constructor(logDir: string = './data') {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logPath = path.join(logDir, 'app.log');
  }

  static getInstance(): FileLogger {
    if (!FileLogger.instance) {
      FileLogger.instance = new FileLogger();
    }
    return FileLogger.instance;
  }

  private write(event: LogEvent): void {
    try {
      const line = JSON.stringify(event) + '\n';
      fs.appendFileSync(this.logPath, line, 'utf8');
    } catch (err) {
      console.error(`[FileLogger] Failed to write log: ${err}`);
    }
  }

  logUserRegistered(userId: string, username: string | null, firstName: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      type: 'USER_REGISTERED',
      data: { userId, username, firstName },
    });
  }

  logSearchAdded(userId: string, userName: string, provider: string, url: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      type: 'SEARCH_ADDED',
      data: { userId, userName, provider, url },
    });
  }

  logSearchUpdated(userId: string, userName: string, provider: string, url: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      type: 'SEARCH_UPDATED',
      data: { userId, userName, provider, url },
    });
  }

  logSearchRemoved(userId: string, userName: string, provider: string, url?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      type: 'SEARCH_REMOVED',
      data: { userId, userName, provider, url },
    });
  }

  logScrapingError(provider: string, error: string, userId?: string, url?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      type: 'SCRAPING_ERROR',
      data: { provider, error, userId, url },
    });
  }

  logCriticalError(source: string, error: string, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      type: 'CRITICAL_ERROR',
      data: { source, error, ...context },
    });
  }

  getRecentLogs(count: number = 20): LogEvent[] {
    try {
      if (!fs.existsSync(this.logPath)) {
        return [];
      }
      const content = fs.readFileSync(this.logPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const recentLines = lines.slice(-count);
      return recentLines.map((line) => JSON.parse(line) as LogEvent);
    } catch {
      return [];
    }
  }
}
