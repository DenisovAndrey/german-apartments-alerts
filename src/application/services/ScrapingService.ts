import { IListingProvider } from '../../domain/ports/IListingProvider.js';
import { IListingRepository } from '../../domain/ports/IListingRepository.js';
import { Listing } from '../../domain/entities/Listing.js';
import { User } from '../../domain/entities/User.js';
import { ILogger, LoggerFactory } from '../../infrastructure/logging/Logger.js';

const CHECKPOINT_COUNT = 5;

export interface ProviderStatus {
  name: string;
  enabled: boolean;
  lastScrapeCount: number;
  consecutiveErrors: number;
  healthy: boolean;
}

export interface UserScrapeResult {
  user: User;
  allListings: Listing[];
  newListings: Listing[];
  byProvider: Map<string, Listing[]>;
  providerStatuses: ProviderStatus[];
}

export class ScrapingService {
  private readonly logger: ILogger;

  constructor(
    private readonly repository: IListingRepository,
    private readonly maxResultsPerProvider: number
  ) {
    this.logger = LoggerFactory.create('ScrapingService');
  }

  async scrapeForUser(user: User, providers: IListingProvider[]): Promise<UserScrapeResult> {
    const enabledProviders = providers.filter((p) => p.isEnabled());
    const byProvider = new Map<string, Listing[]>();
    const providerStatuses: ProviderStatus[] = [];
    const allNewListings: Listing[] = [];

    await Promise.all(
      enabledProviders.map(async (provider) => {
        const listings = await provider.scrape(this.maxResultsPerProvider);
        byProvider.set(provider.name, listings);

        // Find new listings using checkpoint hashes (fallback logic)
        const checkpointHashes = await this.repository.getCheckpoints(user.id, provider.name);
        const checkpoints = new Set(checkpointHashes);
        const newListings = this.findNewListings(listings, checkpoints);

        // Update checkpoints to the first N listing hashes
        if (listings.length > 0) {
          const newCheckpoints = listings.slice(0, CHECKPOINT_COUNT).map((l) => l.hash);
          await this.repository.setCheckpoints(user.id, provider.name, newCheckpoints);
        }

        allNewListings.push(...newListings);

        // Track provider status
        const consecutiveErrors = (provider as any).getConsecutiveErrors?.() ?? 0;
        const status: ProviderStatus = {
          name: provider.name,
          enabled: true,
          lastScrapeCount: listings.length,
          consecutiveErrors,
          healthy: consecutiveErrors === 0 && listings.length > 0,
        };

        providerStatuses.push(status);
      })
    );

    const allListings = Array.from(byProvider.values()).flat();

    // Log unhealthy providers
    const unhealthyProviders = providerStatuses.filter((s) => !s.healthy);
    if (unhealthyProviders.length > 0) {
      this.logger.warn(`⚠️ Unhealthy providers for user ${user.name}`, {
        userId: user.id,
        unhealthy: unhealthyProviders.map((p) => ({
          name: p.name,
          errors: p.consecutiveErrors,
          lastCount: p.lastScrapeCount,
        })),
      });
    }

    return { user, allListings, newListings: allNewListings, byProvider, providerStatuses };
  }

  private findNewListings(listings: Listing[], checkpoints: Set<string>): Listing[] {
    if (checkpoints.size === 0) {
      // First run: only return 1 listing as confirmation
      return listings.slice(0, 1);
    }

    const newListings: Listing[] = [];
    for (const listing of listings) {
      if (checkpoints.has(listing.hash)) {
        break;
      }
      newListings.push(listing);
    }
    return newListings;
  }

  async getProviderCountForUser(userId: string): Promise<number> {
    return this.repository.getProviderCountForUser(userId);
  }
}
