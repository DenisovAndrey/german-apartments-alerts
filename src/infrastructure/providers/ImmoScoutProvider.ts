import { BaseProvider } from './BaseProvider.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';
// @ts-ignore - Fredy doesn't have types
import * as immoscout from 'fredy/lib/provider/immoscout.js';

export class ImmoScoutProvider extends BaseProvider {
  readonly name = 'ImmoScout';
  readonly id = 'immoscout';

  private ensureSortByNewest(url: string): string {
    try {
      const parsed = new URL(url);
      // Always force sorting by newest (mobile API format)
      // This ensures we always get the latest listings first
      parsed.searchParams.set('sorting', '-firstactivation');
      return parsed.toString();
    } catch {
      // Fallback for invalid URLs - replace or add sorting parameter
      const sortingRegex = /([?&])sorting=[^&]*/;
      if (sortingRegex.test(url)) {
        return url.replace(sortingRegex, '$1sorting=-firstactivation');
      }
      return url + (url.includes('?') ? '&' : '?') + 'sorting=-firstactivation';
    }
  }

  async scrape(maxResults: number): Promise<Listing[]> {
    if (!this.isEnabled()) return [];

    const startTime = Date.now();
    const sortedUrl = this.ensureSortByNewest(this.url!);

    try {
      immoscout.init({ enabled: true, url: sortedUrl }, []);
      const listings = await immoscout.config.getListings(immoscout.config.url);

      if (!listings || listings.length === 0) {
        throw new Error('No listings returned - possible API error or blocking');
      }

      const result = listings.slice(0, maxResults).map((l: RawListing) => {
        const normalized = immoscout.config.normalize(l);
        return this.normalizeListing(normalized, this.name);
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
