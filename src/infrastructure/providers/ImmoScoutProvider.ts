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
      // Remove web-only sorting parameter (sorting=1, sorting=2, etc.)
      // and replace with mobile API format
      const existingSorting = parsed.searchParams.get('sorting');
      if (existingSorting && /^\d+$/.test(existingSorting)) {
        // Web format (numeric) - replace with mobile API format
        parsed.searchParams.set('sorting', '-firstactivation');
      } else if (!existingSorting) {
        // No sorting - add mobile API format
        parsed.searchParams.set('sorting', '-firstactivation');
      }
      // If sorting is already in mobile format (e.g., -firstactivation), keep it
      return parsed.toString();
    } catch {
      // Fallback for invalid URLs
      if (url.includes('sorting=')) return url;
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
