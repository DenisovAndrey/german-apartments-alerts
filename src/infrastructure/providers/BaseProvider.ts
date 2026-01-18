import { IListingProvider } from '../../domain/ports/IListingProvider.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';
import { ILogger, LoggerFactory } from '../logging/Logger.js';
import { buildHash } from '../utils/hash.js';

export interface ProviderError {
  provider: string;
  error: Error;
  timestamp: Date;
  possibleCause: string;
}

export abstract class BaseProvider implements IListingProvider {
  abstract readonly name: string;
  abstract readonly id: string;
  protected readonly logger: ILogger;
  private consecutiveErrors = 0;
  private lastError: ProviderError | null = null;

  constructor(protected readonly url: string | undefined) {
    this.logger = LoggerFactory.create(this.constructor.name);
  }

  abstract scrape(maxResults: number): Promise<Listing[]>;

  isEnabled(): boolean {
    return !!this.url;
  }

  getLastError(): ProviderError | null {
    return this.lastError;
  }

  getConsecutiveErrors(): number {
    return this.consecutiveErrors;
  }

  protected resetErrors(): void {
    if (this.consecutiveErrors > 0) {
      this.logger.info(`Provider recovered after ${this.consecutiveErrors} consecutive errors`);
    }
    this.consecutiveErrors = 0;
    this.lastError = null;
  }

  protected handleError(error: Error, context?: Record<string, unknown>): void {
    this.consecutiveErrors++;
    const possibleCause = this.detectPossibleCause(error);

    this.lastError = {
      provider: this.name,
      error,
      timestamp: new Date(),
      possibleCause,
    };

    this.logger.error(
      `Scraping failed (attempt #${this.consecutiveErrors})`,
      error,
      {
        possibleCause,
        consecutiveErrors: this.consecutiveErrors,
        url: this.url?.substring(0, 50) + '...',
        ...context,
      }
    );

    if (this.consecutiveErrors >= 3) {
      this.logger.warn(
        `⚠️ ALERT: ${this.name} has failed ${this.consecutiveErrors} times in a row. Possible blocking or site changes!`,
        { possibleCause }
      );
    }
  }

  private detectPossibleCause(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return 'Request timeout - site may be slow or blocking';
    }
    if (message.includes('403') || message.includes('forbidden')) {
      return 'HTTP 403 Forbidden - likely IP blocked or bot detection';
    }
    if (message.includes('429') || message.includes('too many')) {
      return 'HTTP 429 Too Many Requests - rate limited';
    }
    if (message.includes('captcha')) {
      return 'CAPTCHA detected - bot protection triggered';
    }
    if (message.includes('selector') || message.includes('element')) {
      return 'Selector not found - site structure may have changed';
    }
    if (message.includes('navigation') || message.includes('net::')) {
      return 'Navigation failed - network issue or site down';
    }
    if (message.includes('blocked') || message.includes('denied')) {
      return 'Access denied - likely blocked by the website';
    }

    return 'Unknown error - check logs for details';
  }

  protected normalizeListing(raw: RawListing, source: string): Listing {
    const title = raw.title?.replace('NEU', '').trim() || 'N/A';
    const address = raw.address?.replace(/\(.*\),.*$/, '').trim() || 'N/A';
    const hash = buildHash(raw.id, raw.price);

    return {
      id: raw.id || hash,
      title,
      price: raw.price || null,
      size: raw.size || null,
      address,
      link: raw.link || '',
      description: raw.description || null,
      image: raw.image || null,
      hash,
      source,
    };
  }

  protected isValidListing(raw: RawListing): boolean {
    return !!(raw.link && !raw.link.includes('undefined') && (raw.title || raw.price));
  }
}
