export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

export class ConsoleLogger implements ILogger {
  constructor(private readonly name: string) {}

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private formatContext(context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) return '';
    return ' ' + JSON.stringify(context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    console.log(`[${this.formatTimestamp()}] [DEBUG] [${this.name}] ${message}${this.formatContext(context)}`);
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.log(`[${this.formatTimestamp()}] [INFO] [${this.name}] ${message}${this.formatContext(context)}`);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[${this.formatTimestamp()}] [WARN] [${this.name}] ${message}${this.formatContext(context)}`);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const errorDetails = error
      ? ` | Error: ${error.message}${error.stack ? `\nStack: ${error.stack}` : ''}`
      : '';
    console.error(`[${this.formatTimestamp()}] [ERROR] [${this.name}] ${message}${errorDetails}${this.formatContext(context)}`);
  }
}

export class LoggerFactory {
  static create(name: string): ILogger {
    return new ConsoleLogger(name);
  }
}
