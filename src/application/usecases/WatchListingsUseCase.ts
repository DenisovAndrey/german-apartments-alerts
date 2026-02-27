import { ScrapingService, UserScrapeResult } from '../services/ScrapingService.js';
import { User } from '../../domain/entities/User.js';
import { IListingProvider } from '../../domain/ports/IListingProvider.js';
import { MonitoringService } from '../../infrastructure/monitoring/MonitoringService.js';

export type OnUserResultCallback = (result: UserScrapeResult) => void;
export type UserLoaderCallback = () => Promise<UserWithProviders[]>;

export interface UserWithProviders {
  user: User;
  providers: IListingProvider[];
}

export class WatchListingsUseCase {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly scrapingService: ScrapingService,
    private readonly intervalMs: number
  ) {}

  async start(
    initialUsers: UserWithProviders[],
    onUserResult: OnUserResultCallback,
    userLoader?: UserLoaderCallback
  ): Promise<void> {
    await this.scrapeAllUsers(initialUsers, onUserResult);

    this.intervalId = setInterval(async () => {
      const users = userLoader ? await userLoader() : initialUsers;
      await this.scrapeAllUsers(users, onUserResult);
    }, this.intervalMs);
  }

  private async scrapeAllUsers(
    usersWithProviders: UserWithProviders[],
    onUserResult: OnUserResultCallback
  ): Promise<void> {
    const monitoring = MonitoringService.getInstance();
    monitoring.onIterationStart();

    for (const { user, providers } of usersWithProviders) {
      const result = await this.scrapingService.scrapeForUser(user, providers);
      onUserResult(result);
    }

    await monitoring.onIterationEnd();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
