import { BaseProvider } from './BaseProvider.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';
// @ts-ignore - Fredy doesn't have types
import * as immoscout from 'fredy/lib/provider/immoscout.js';

export class ImmoScoutProvider extends BaseProvider {
  readonly name = 'ImmoScout';
  readonly id = 'immoscout';

  private ensureSortByNewest(url: string): string {
    if (url.includes('sorting=')) return url;
    // Mobile API uses -firstactivation for newest first (not sorting=2 which is web-only)
    return url + (url.includes('?') ? '&' : '?') + 'sorting=-firstactivation';
  }

  async scrape(maxResults: number): Promise<Listing[]> {
    if (!this.isEnabled()) return [];

    const startTime = Date.now();
    const sortedUrl = this.ensureSortByNewest(this.url!);

    try {
      this.logger.info(`Starting API scrape`, { url: sortedUrl.substring(0, 60) + '...' });

      immoscout.init({ enabled: true, url: sortedUrl }, []);
      const listings = await immoscout.config.getListings(immoscout.config.url);

      if (!listings || listings.length === 0) {
        throw new Error('No listings returned - possible API error or blocking');
      }

      const result = listings.slice(0, maxResults).map((l: RawListing) => {
        const normalized = immoscout.config.normalize(l);
        return this.normalizeListing(normalized, this.name);
      });

      const duration = Date.now() - startTime;
      this.logger.info(`API scrape completed successfully`, {
        listings: result.length,
        duration: `${duration}ms`,
      });

      this.resetErrors();
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, { duration: `${Date.now() - startTime}ms` });
      return [];
    }
  }
}
