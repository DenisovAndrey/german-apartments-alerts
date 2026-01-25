import { IListingProvider } from '../../domain/ports/IListingProvider.js';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { ProvidersConfig } from '../../config/providers.config.js';
import { DatabaseConnection } from '../database/Database.js';
import { ImmoScoutProvider } from './ImmoScoutProvider.js';
import { ImmoweltProvider } from './ImmoweltProvider.js';
import { ImmonetProvider } from './ImmonetProvider.js';
import { KleinanzeigenProvider } from './KleinanzeigenProvider.js';
import { SueddeutscheProvider } from './SueddeutscheProvider.js';
import { PlanetHomeProvider } from './PlanetHomeProvider.js';
import { DeutscheBankProvider } from './DeutscheBankProvider.js';
import { SparkasseProvider } from './SparkasseProvider.js';

export class ProviderFactory {
  constructor(
    private readonly browserService: IBrowserService,
    private readonly database: DatabaseConnection
  ) {}

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
    if (config.sueddeutsche) {
      providers.push(new SueddeutscheProvider(config.sueddeutsche));
    }
    if (config.planethome) {
      providers.push(new PlanetHomeProvider(config.planethome, this.database));
    }
    if (config.deutschebank) {
      providers.push(new DeutscheBankProvider(config.deutschebank, this.browserService));
    }
    if (config.sparkasse) {
      providers.push(new SparkasseProvider(config.sparkasse));
    }

    return providers;
  }
}
