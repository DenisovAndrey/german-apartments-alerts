import { BaseProvider } from './BaseProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { Listing } from '../../domain/entities/Listing.js';

interface NuxtEstate {
  id: string;
  title: string;
  town: string;
  zip: string;
  latitude: number;
  longitude: number;
  type: string;
  purchasePrice?: number;
  formattedPriceString?: string;
  purchasePriceOnRequest?: boolean;
  livingSpace?: number;
  leadingSpaceString?: string;
  roomNumber?: number;
  exposeUrl: string;
  titleImage?: {
    url: string;
    title?: string;
  };
  version: string;
}

export class DeutscheBankProvider extends BaseProvider {
  readonly name = 'Deutsche Bank';
  readonly id = 'deutschebank';

  constructor(
    url: string | undefined,
    private readonly browserService: IBrowserService
  ) {
    super(url);
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Always force sort by newest (sort=3)
      parsed.searchParams.set('sort', '3');

      return parsed.toString();
    } catch {
      // Fallback: replace existing sort or append
      if (url.includes('sort=')) {
        return url.replace(/sort=\d+/, 'sort=3');
      }
      const separator = url.includes('?') ? '&' : '?';
      return url + separator + 'sort=3';
    }
  }

  async scrape(maxResults: number): Promise<Listing[]> {
    if (!this.isEnabled()) return [];

    const startTime = Date.now();
    const searchUrl = this.normalizeUrl(this.url!);

    try {
      // Use browser to load page and extract __NUXT__ state
      const estates = await this.browserService.evaluate<NuxtEstate[]>(
        searchUrl,
        `(() => {
          const nuxt = window.__NUXT__;
          if (nuxt && nuxt.state && nuxt.state.estateList && nuxt.state.estateList.list) {
            return nuxt.state.estateList.list;
          }
          return [];
        })()`,
        'div[class*="estate"]' // Wait for estate content to load
      );

      if (!estates || estates.length === 0) {
        throw new Error('No listings found in page data - possible format change');
      }

      const listings = estates.slice(0, maxResults).map((estate) => this.transformEstate(estate));

      this.resetErrors();
      return listings;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, { duration: `${Date.now() - startTime}ms` });
      return [];
    }
  }

  private transformEstate(estate: NuxtEstate): Listing {
    // Format price
    const priceFormatted = estate.purchasePriceOnRequest
      ? 'Preis auf Anfrage'
      : estate.formattedPriceString || (estate.purchasePrice ? `${estate.purchasePrice.toLocaleString('de-DE')} €` : 'Preis auf Anfrage');

    // Format size and rooms
    const size = estate.leadingSpaceString || (estate.livingSpace ? `${estate.livingSpace} m²` : '');
    const rooms = estate.roomNumber ? `${estate.roomNumber} Zimmer` : '';
    const sizeAndRooms = [size, rooms].filter(Boolean).join(', ');

    // Build address
    const address = [estate.zip, estate.town].filter(Boolean).join(' ');

    return this.normalizeListing(
      {
        id: estate.id,
        title: estate.title,
        price: priceFormatted,
        size: sizeAndRooms,
        link: estate.exposeUrl,
        address: address || 'Keine Adresse',
        image: estate.titleImage?.url,
      },
      this.name
    );
  }
}
