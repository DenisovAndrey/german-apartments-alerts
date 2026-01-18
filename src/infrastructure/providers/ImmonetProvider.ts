import { BrowserBasedProvider, BrowserProviderOptions } from './BrowserBasedProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';

export class ImmonetProvider extends BrowserBasedProvider {
  readonly name = 'Immonet';
  readonly id = 'immonet';

  protected readonly options: BrowserProviderOptions = {
    crawlContainer: 'div[data-testid="serp-core-classified-card-testid"]',
    crawlFields: {
      id: 'button@title',
      title: 'button@title',
      price: 'div[data-testid="cardmfe-price-testid"]',
      size: 'div[data-testid="cardmfe-keyfacts-testid"]',
      address: 'div[data-testid="cardmfe-description-box-address"]',
      image: 'div[data-testid="cardmfe-picture-box-test-id"] img@src',
      link: 'button@data-base',
    },
    waitForSelector: 'div[data-testid="serp-gridcontainer-testid"]',
    sortByDateParam: 'sortby=19',
  };

  constructor(url: string | undefined, browserService: IBrowserService) {
    super(url, browserService);
  }

  protected transformListing(raw: RawListing): Listing {
    const listing = this.normalizeListing(raw, this.name);

    // Immonet returns URL-encoded links in data-base attribute
    if (listing.link) {
      try {
        listing.link = decodeURIComponent(listing.link);
      } catch {
        // If decoding fails, keep original
      }
    }

    return listing;
  }
}
