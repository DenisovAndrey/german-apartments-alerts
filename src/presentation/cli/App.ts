import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { ScrapingService, UserScrapeResult } from '../../application/services/ScrapingService.js';
import { WatchListingsUseCase, UserWithProviders } from '../../application/usecases/WatchListingsUseCase.js';
import { ListingFormatter } from './ListingFormatter.js';
import { AppConfig, loadUsersConfig } from '../../config/index.js';
import { User } from '../../domain/entities/User.js';
import { Listing } from '../../domain/entities/Listing.js';
import { BrowserService } from '../../infrastructure/browser/BrowserService.js';
import { DatabaseCheckpointRepository } from '../../infrastructure/repositories/DatabaseCheckpointRepository.js';
import { DatabaseConnection } from '../../infrastructure/database/Database.js';
import { ProviderFactory } from '../../infrastructure/providers/index.js';
import { TelegramBot } from '../../infrastructure/telegram/TelegramBot.js';
import { AdminBot } from '../../infrastructure/telegram/AdminBot.js';
import { MonitoringService } from '../../infrastructure/monitoring/MonitoringService.js';
import { ProvidersConfig } from '../../config/providers.config.js';
import { ILogger, LoggerFactory } from '../../infrastructure/logging/Logger.js';

export class App {
  private browserService!: IBrowserService;
  private db!: DatabaseConnection;
  private repository!: DatabaseCheckpointRepository;
  private scrapingService!: ScrapingService;
  private watchUseCase!: WatchListingsUseCase;
  private formatter!: ListingFormatter;
  private providerFactory!: ProviderFactory;
  private telegramBot?: TelegramBot;
  private adminBot?: AdminBot;
  private readonly logger: ILogger;
  private readonly monitoring: MonitoringService;

  constructor(private readonly appConfig: AppConfig) {
    this.logger = LoggerFactory.create('App');
    this.monitoring = MonitoringService.getInstance();
  }

  async initialize(): Promise<void> {
    this.browserService = new BrowserService();
    this.db = new DatabaseConnection(this.appConfig.databaseUrl);
    await this.db.initialize();

    this.repository = new DatabaseCheckpointRepository(this.db);
    this.formatter = new ListingFormatter();
    this.providerFactory = new ProviderFactory(this.browserService);

    this.scrapingService = new ScrapingService(this.repository, this.appConfig.maxResultsPerProvider);
    this.watchUseCase = new WatchListingsUseCase(this.scrapingService, this.appConfig.intervalMs);

    if (this.appConfig.telegramBotToken) {
      this.telegramBot = new TelegramBot(this.appConfig.telegramBotToken, this.db);
    } else {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set, bot disabled');
    }

    if (this.appConfig.adminBotToken) {
      this.adminBot = new AdminBot(
        this.appConfig.adminBotToken,
        this.db,
        this.appConfig.adminUserId
      );
      this.monitoring.setAdminBot(this.adminBot);
    } else {
      this.logger.info('ADMIN_TELEGRAM_BOT_TOKEN not set, admin bot disabled');
    }
  }

  async run(): Promise<void> {
    await this.initialize();

    if (this.telegramBot) {
      await this.telegramBot.start();
    }

    if (this.adminBot) {
      await this.adminBot.start();
    }

    this.setupShutdownHandlers();
    await this.startWatching();
  }

  private async startWatching(): Promise<void> {
    const usersWithProviders = await this.loadUsersFromDatabase();

    if (usersWithProviders.length === 0) {
      const envUsers = this.loadUsersFromEnv();
      if (envUsers.length > 0) {
        this.logger.info(`No users in database, using ${envUsers.length} user(s) from .env`);
        this.printHeader(envUsers);
        await this.watchUseCase.start(envUsers, (result) => this.handleUserResult(result));
      } else {
        this.logger.info('No users configured. Waiting for users to register via Telegram...');
        await this.waitForUsers();
      }
    } else {
      this.printHeader(usersWithProviders);
      await this.watchUseCase.start(
        usersWithProviders,
        (result) => this.handleUserResult(result),
        () => this.loadUsersFromDatabase()
      );
    }

    console.log(`\nWatching for new listings every ${this.appConfig.intervalMs / 1000} seconds...`);
    console.log('Press Ctrl+C to stop.\n');
  }

  private async waitForUsers(): Promise<void> {
    const checkInterval = setInterval(async () => {
      const usersWithProviders = await this.loadUsersFromDatabase();
      if (usersWithProviders.length > 0) {
        clearInterval(checkInterval);
        this.logger.info(`Found ${usersWithProviders.length} user(s), starting scraper`);
        this.printHeader(usersWithProviders);
        await this.watchUseCase.start(
          usersWithProviders,
          (result) => this.handleUserResult(result),
          () => this.loadUsersFromDatabase()
        );
      }
    }, 10000);
  }

  private async loadUsersFromDatabase(): Promise<UserWithProviders[]> {
    const dbUsers = await this.db.getAllUsers();
    const usersWithProviders: UserWithProviders[] = [];

    for (const dbUser of dbUsers) {
      const dbProviders = await this.db.getUserProviders(dbUser.id);
      if (dbProviders.length === 0) continue;

      const providersConfig: ProvidersConfig = {};
      for (const p of dbProviders) {
        (providersConfig as Record<string, string>)[p.provider] = p.url;
      }

      const user: User = {
        id: dbUser.id,
        name: dbUser.first_name,
        providers: providersConfig,
      };

      usersWithProviders.push({
        user,
        providers: this.providerFactory.createProvidersForConfig(providersConfig),
      });
    }

    return usersWithProviders;
  }

  private loadUsersFromEnv(): UserWithProviders[] {
    const users = loadUsersConfig();
    return users.map((user) => ({
      user,
      providers: this.providerFactory.createProvidersForConfig(user.providers),
    }));
  }

  private printHeader(usersWithProviders: UserWithProviders[]): void {
    const userSummaries = usersWithProviders.map(({ user, providers }) => ({
      name: user.name,
      providerCount: providers.filter((p) => p.isEnabled()).length,
    }));

    console.log(
      this.formatter.formatHeader(userSummaries, this.appConfig.intervalMs, this.appConfig.maxResultsPerProvider)
    );
  }

  private handleUserResult(result: UserScrapeResult): void {
    const timestamp = this.formatter.formatTimestamp();
    console.log(`\n[${timestamp}] Results for ${result.user.name}:`);

    if (result.newListings.length > 0) {
      console.log(`Found ${result.newListings.length} NEW listing(s) for ${result.user.name}:`);
      for (const listing of result.newListings) {
        console.log(this.formatter.formatListing(listing, true));
      }

      this.sendTelegramNotifications(result.user.id, result.newListings);
    }

    console.log(this.formatter.formatUserSummary(result));

    const healthWarnings = this.formatter.formatProviderHealth(result.providerStatuses);
    if (healthWarnings) {
      console.log(healthWarnings);
    }
  }

  private sendTelegramNotifications(userId: string, listings: Listing[]): void {
    if (!this.telegramBot) return;
    if (!userId.startsWith('tg_')) return;

    const telegramId = parseInt(userId.substring(3), 10);
    if (isNaN(telegramId)) return;

    this.telegramBot.notifyNewListings(telegramId, listings).catch((err) => {
      this.logger.error(`Failed to send Telegram notifications: ${err}`);
    });
  }

  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      console.log('\nShutting down...');
      this.watchUseCase.stop();
      this.telegramBot?.stop();
      this.adminBot?.stop();
      await this.browserService.close();
      await this.db.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
