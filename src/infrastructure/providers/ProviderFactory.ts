import { IListingProvider } from '../../domain/ports/IListingProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { ProvidersConfig } from '../../config/providers.config.js';
import { ImmoScoutProvider } from './ImmoScoutProvider.js';
import { ImmoweltProvider } from './ImmoweltProvider.js';
import { ImmonetProvider } from './ImmonetProvider.js';
import { KleinanzeigenProvider } from './KleinanzeigenProvider.js';

export class ProviderFactory {
  constructor(private readonly browserService: IBrowserService) {}

  createProvidersForConfig(config: ProvidersConfig): IListingProvider[] {
    const providers: IListingProvider[] = [];

    if (config.immoscout) {
      providers.push(new ImmoScoutProvider(config.immoscout));
    }
    if (config.immowelt) {
      providers.push(new ImmoweltProvider(config.immowelt, this.browserService));
    }
    if (config.immonet) {
      providers.push(new ImmonetProvider(config.immonet, this.browserService));
    }
    if (config.kleinanzeigen) {
      providers.push(new KleinanzeigenProvider(config.kleinanzeigen, this.browserService));
    }

    return providers;
  }
}
