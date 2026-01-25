import { BaseProvider } from './BaseProvider.js';
import { Listing } from '../../domain/entities/Listing.js';

interface SparkasseEstate {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  images?: string[];
  mainFacts?: Array<{
    category: string;
    label: string;
    value: string;
  }>;
  lat?: number;
  lng?: number;
}

interface NextDataResponse {
  props?: {
    pageProps?: {
      totalItems?: number;
      firstPageEstates?: SparkasseEstate[];
    };
  };
}

export class SparkasseProvider extends BaseProvider {
  readonly name = 'Sparkasse';
  readonly id = 'sparkasse';

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Remove #map hash to ensure list mode (not map mode)
      parsed.hash = '';

      // Always force sort by newest (sortBy=date_desc)
      parsed.searchParams.set('sortBy', 'date_desc');

      return parsed.toString();
    } catch {
      // Fallback: remove #map and handle sortBy
      let cleanUrl = url.replace(/#map$/, '');
      if (cleanUrl.includes('sortBy=')) {
        return cleanUrl.replace(/sortBy=[^&]+/, 'sortBy=date_desc');
      }
      const separator = cleanUrl.includes('?') ? '&' : '?';
      return cleanUrl + separator + 'sortBy=date_desc';
    }
  }

  private extractNextData(html: string): NextDataResponse | null {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[1]) as NextDataResponse;
    } catch {
      this.logger.debug('Failed to parse __NEXT_DATA__ JSON');
      return null;
    }
  }

  async scrape(maxResults: number): Promise<Listing[]> {
    if (!this.isEnabled()) return [];

    const startTime = Date.now();
    const searchUrl = this.normalizeUrl(this.url!);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const nextData = this.extractNextData(html);

      if (!nextData?.props?.pageProps?.firstPageEstates) {
        throw new Error('No listings found in page data - possible format change');
      }

      const estates = nextData.props.pageProps.firstPageEstates;

      if (estates.length === 0) {
        this.logger.warn('No listings found in Sparkasse response');
        return [];
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

  private transformEstate(estate: SparkasseEstate): Listing {
    // Extract size and rooms from mainFacts
    const areaFact = estate.mainFacts?.find((f) => f.category === 'AREA');
    const roomsFact = estate.mainFacts?.find((f) => f.category === 'ROOMS');

    const size = areaFact?.value || '';
    const rooms = roomsFact ? `${roomsFact.value} Zimmer` : '';
    const sizeAndRooms = [size, rooms].filter(Boolean).join(', ');

    // Get first image
    const image = estate.images?.[0];

    return this.normalizeListing(
      {
        id: estate.id,
        title: estate.title,
        price: estate.price || 'Preis auf Anfrage',
        size: sizeAndRooms,
        link: `https://immobilien.sparkasse.de/expose/${estate.id}.html`,
        address: estate.subtitle || 'Keine Adresse',
        image,
      },
      this.name
    );
  }
}
