import { BrowserBasedProvider, BrowserProviderOptions } from './BrowserBasedProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';

export class ImmoweltProvider extends BrowserBasedProvider {
  readonly name = 'Immowelt';
  readonly id = 'immowelt';

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
    super(url, browserService);
  }

  protected transformListing(raw: RawListing): Listing {
    const listing = this.normalizeListing(raw, this.name);

    if (listing.link && !listing.link.startsWith('http')) {
      listing.link = `https://www.immowelt.de${listing.link.startsWith('/') ? '' : '/'}${listing.link}`;
    }

    return listing;
  }
}
