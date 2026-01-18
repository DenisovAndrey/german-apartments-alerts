import { BrowserBasedProvider, BrowserProviderOptions } from './BrowserBasedProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';

export class ImmonetProvider extends BrowserBasedProvider {
  readonly name = 'Immonet';
  readonly id = 'immonet';

  // Same selectors as Immowelt - they share the same platform
  protected readonly options: BrowserProviderOptions = {
    crawlContainer:
      'div[data-testid="serp-core-scrollablelistview-testid"]:not(div[data-testid="serp-enlargementlist-testid"] div[data-testid="serp-card-testid"]) div[data-testid="serp-core-classified-card-testid"]',
    crawlFields: {
      id: 'a@href',
      price: 'div[data-testid="cardmfe-price-testid"]',
      size: 'div[data-testid="cardmfe-keyfacts-testid"]',
      title: 'div[data-testid="cardmfe-description-box-text-test-id"] > div:nth-of-type(2)',
      link: 'a@href',
      address: 'div[data-testid="cardmfe-description-box-address"]',
      image: 'div[data-testid="cardmfe-picture-box-opacity-layer-test-id"] img@src',
    },
    waitForSelector: 'div[data-testid="serp-gridcontainer-testid"]',
    sortByDateParam: 'order=DateDesc',
  };

  constructor(url: string | undefined, browserService: IBrowserService) {
    // Immonet has merged with Immowelt - convert URLs to use Immowelt domain
    super(url ? ImmonetProvider.convertToImmowelt(url) : url, browserService);
  }

  private static convertToImmowelt(url: string): string {
    try {
      const parsed = new URL(url);
      // Replace immonet.de with immowelt.de
      parsed.hostname = parsed.hostname.replace('immonet.de', 'immowelt.de');

      // Convert /immobiliensuche/{action}/{type}/{city} to /liste/{city}/{types}/{action}
      const pathMatch = parsed.pathname.match(/^\/immobiliensuche\/(mieten|kaufen)\/(wohnung|haus)\/([^/]+)/);
      if (pathMatch) {
        const [, action, type, city] = pathMatch;
        const typeMap: Record<string, string> = { wohnung: 'wohnungen', haus: 'haeuser' };
        parsed.pathname = `/liste/${city}/${typeMap[type] || type}/${action}`;
      }

      return parsed.toString();
    } catch {
      return url;
    }
  }

  protected transformListing(raw: RawListing): Listing {
    const listing = this.normalizeListing(raw, this.name);

    // Fix relative links (same as Immowelt)
    if (listing.link && !listing.link.startsWith('http')) {
      listing.link = `https://www.immowelt.de${listing.link.startsWith('/') ? '' : '/'}${listing.link}`;
    }

    return listing;
  }
}
