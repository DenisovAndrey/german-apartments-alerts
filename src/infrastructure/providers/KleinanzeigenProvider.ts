import { BrowserBasedProvider, BrowserProviderOptions } from './BrowserBasedProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';

export class KleinanzeigenProvider extends BrowserBasedProvider {
  readonly name = 'Kleinanzeigen';
  readonly id = 'kleinanzeigen';

  protected readonly options: BrowserProviderOptions = {
    crawlContainer: '#srchrslt-adtable .ad-listitem',
    crawlFields: {
      id: '.aditem@data-adid',
      price: '.aditem-main--middle--price-shipping--price',
      size: '.aditem-main .text-module-end',
      title: '.aditem-main .text-module-begin a',
      link: '.aditem-main .text-module-begin a@href',
      description: '.aditem-main .aditem-main--middle--description',
      address: '.aditem-main--top--left',
    },
    waitForSelector: 'body',
  };

  constructor(url: string | undefined, browserService: IBrowserService) {
    super(url ? KleinanzeigenProvider.ensureSortByNewest(url) : undefined, browserService);
  }

  private static ensureSortByNewest(url: string): string {
    if (url.includes('sortierung:neu')) return url;
    // Insert sortierung:neu before the category code (c203, c196, etc.)
    return url.replace(/(\/c\d+)/, '/sortierung:neu$1');
  }

  protected transformListing(raw: RawListing): Listing {
    const listing = this.normalizeListing(raw, this.name);

    // Fix relative links
    if (listing.link && !listing.link.startsWith('http')) {
      listing.link = `https://www.kleinanzeigen.de${listing.link}`;
    }

    return listing;
  }
}
