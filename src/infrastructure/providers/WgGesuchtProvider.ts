import { BrowserBasedProvider, BrowserProviderOptions } from './BrowserBasedProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { Listing, RawListing } from '../../domain/entities/Listing.js';

export class WgGesuchtProvider extends BrowserBasedProvider {
  readonly name = 'WgGesucht';
  readonly id = 'wggesucht';

  protected readonly options: BrowserProviderOptions = {
    crawlContainer: '.wgg_card.offer_list_item',
    crawlFields: {
      id: '*@data-id',
      title: '.truncate_title a',
      link: '.truncate_title a@href',
      price: '.middle .col-xs-3 b',
      size: '.middle .col-xs-3.text-right b',
      address: '.col-xs-11 span',
      image: '.card_image img.img-responsive@src',
    },
    waitForSelector: '.wgg_card',
    sortByDateParam: 'sort_column=0&sort_order=0',
  };

  constructor(url: string | undefined, browserService: IBrowserService) {
    super(url, browserService);
  }

  protected transformListing(raw: RawListing): Listing {
    const listing = this.normalizeListing(raw, this.name);

    // Fix relative links
    if (listing.link && !listing.link.startsWith('http')) {
      listing.link = `https://www.wg-gesucht.de${listing.link}`;
    }

    // Fix image URL (replace small with large)
    if (listing.image) {
      listing.image = listing.image.replace('.small.', '.large.');
    }

    return listing;
  }
}
