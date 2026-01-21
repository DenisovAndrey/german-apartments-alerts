import { BaseProvider } from './BaseProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';

export interface BrowserProviderOptions {
  crawlContainer: string;
  crawlFields: Record<string, string>;
  waitForSelector?: string;
  sortByDateParam?: string;
  sortByDatePathSegment?: string;
}

export abstract class BrowserBasedProvider extends BaseProvider {
  protected abstract readonly options: BrowserProviderOptions;

  constructor(
    url: string | undefined,
    protected readonly browserService: IBrowserService
  ) {
    super(url);
  }

  async scrape(maxResults: number): Promise<Listing[]> {
    if (!this.isEnabled()) return [];

    const startTime = Date.now();

    try {
      let fullUrl = this.url!;

      // Add sort by date param if not already present
      if (this.options.sortByDateParam && !fullUrl.includes(this.options.sortByDateParam)) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + this.options.sortByDateParam;
      }
      if (this.options.sortByDatePathSegment && !fullUrl.includes(this.options.sortByDatePathSegment)) {
        const url = new URL(fullUrl);
        url.pathname = url.pathname.replace(/\/?$/, '/' + this.options.sortByDatePathSegment);
        fullUrl = url.toString();
      }

      const rawListings = await this.browserService.scrape(
        fullUrl,
        this.options.crawlContainer,
        this.options.crawlFields,
        this.options.waitForSelector
      );

      const validListings = rawListings.filter((l) => this.isValidListing(l));
      const listings = validListings.slice(0, maxResults).map((l) => this.transformListing(l));

      if (rawListings.length === 0) {
        throw new Error('No listings found - possible blocking or selector change');
      }

      if (validListings.length < rawListings.length * 0.5) {
        this.logger.warn(`Many invalid listings filtered out`, {
          raw: rawListings.length,
          valid: validListings.length,
          filtered: rawListings.length - validListings.length,
        });
      }

      this.resetErrors();
      return listings;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, { duration: `${Date.now() - startTime}ms` });
      return [];
    }
  }

  protected transformListing(raw: RawListing): Listing {
    return this.normalizeListing(raw, this.name);
  }
}
