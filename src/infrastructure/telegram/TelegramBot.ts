import { Telegraf, Context, Markup } from 'telegraf';
import { DatabaseConnection, DbUser } from '../database/Database.js';
import { ILogger, LoggerFactory } from '../logging/Logger.js';
import { MonitoringService } from '../monitoring/MonitoringService.js';
import { Listing } from '../../domain/entities/Listing.js';

const SUPPORTED_PROVIDERS = ['immoscout', 'immowelt', 'kleinanzeigen'] as const;
const DEPRECATED_PROVIDERS = ['immonet'] as const;
const ALL_PROVIDERS = [...SUPPORTED_PROVIDERS, ...DEPRECATED_PROVIDERS] as const;
type AllProvider = (typeof ALL_PROVIDERS)[number];
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const PROVIDER_NAMES: Record<SupportedProvider, string> = {
  immoscout: 'ImmobilienScout24',
  immowelt: 'Immowelt',
  kleinanzeigen: 'Kleinanzeigen',
};

const ALL_PROVIDER_NAMES: Record<AllProvider, string> = {
  ...PROVIDER_NAMES,
  immonet: 'Immonet (use Immowelt)',
};

// Must match provider.name in each provider class (used for checkpoint storage)
const CHECKPOINT_NAMES: Record<SupportedProvider, string> = {
  immoscout: 'ImmoScout',
  immowelt: 'Immowelt',
  kleinanzeigen: 'Kleinanzeigen',
};

interface UserState {
  awaitingUrlFor?: SupportedProvider;
}

export class TelegramBot {
  private readonly bot: Telegraf;
  private readonly logger: ILogger;
  private readonly monitoring: MonitoringService;
  private readonly userStates: Map<number, UserState> = new Map();

  constructor(
    token: string,
    private readonly db: DatabaseConnection
  ) {
    this.logger = LoggerFactory.create('TelegramBot');
    this.monitoring = MonitoringService.getInstance();
    this.bot = new Telegraf(token);
    this.setupCommands();
    this.setupCallbacks();
  }

  private setupCommands(): void {
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('list', (ctx) => this.handleList(ctx));
    this.bot.command('clear', (ctx) => this.handleClear(ctx));
    this.bot.command('help', (ctx) => this.handleHelp(ctx));

    this.bot.command('immoscout', (ctx) => this.handleProviderCommand(ctx, 'immoscout'));
    this.bot.command('immowelt', (ctx) => this.handleProviderCommand(ctx, 'immowelt'));
    this.bot.command('immonet', (ctx) =>
      ctx.reply(
        '⚠️ Immonet has merged with Immowelt.\n\n' +
          'All listings are now the same on both platforms.\n\n' +
          'Please use /immowelt instead.'
      )
    );
    this.bot.command('kleinanzeigen', (ctx) => this.handleProviderCommand(ctx, 'kleinanzeigen'));

    this.bot.command('remove_immoscout', (ctx) => this.handleRemoveProvider(ctx, 'immoscout'));
    this.bot.command('remove_immowelt', (ctx) => this.handleRemoveProvider(ctx, 'immowelt'));
    this.bot.command('remove_kleinanzeigen', (ctx) => this.handleRemoveProvider(ctx, 'kleinanzeigen'));

    this.bot.on('text', (ctx) => this.handleTextMessage(ctx));
    this.bot.on('message', (ctx) => this.handleAnyMessage(ctx));
  }

  private setupCallbacks(): void {
    this.bot.action('cancel_url_input', async (ctx) => {
      await ctx.answerCbQuery();
      const from = ctx.from;
      if (!from) return;

      this.userStates.delete(from.id);
      await ctx.deleteMessage();
      await this.showMainMenu(ctx);
    });

    this.bot.action('confirm_clear_yes', async (ctx) => {
      await ctx.answerCbQuery();
      const user = await this.ensureUserFromCallback(ctx);
      if (!user) return;

      await this.db.deleteAllUserProviders(user.id);
      await this.db.clearUser(user.id);
      this.logger.info(`User ${user.first_name} cleared all searches`);
      await ctx.deleteMessage();
      await ctx.reply('✅ All searches removed.');
      await this.showMainMenu(ctx);
    });

    this.bot.action('confirm_clear_no', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.deleteMessage();
      await this.showMainMenu(ctx);
    });

    this.bot.action('close_message', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.deleteMessage();
      await this.showMainMenu(ctx);
    });

    this.bot.action('show_list', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.deleteMessage();
      await this.handleList(ctx);
    });

    this.bot.action('show_help', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.deleteMessage();
      await this.handleHelp(ctx);
    });

    // Listing message buttons - don't delete the listing
    this.bot.action('listing_show_list', async (ctx) => {
      await ctx.answerCbQuery();
      await this.handleList(ctx);
    });

    this.bot.action('listing_show_help', async (ctx) => {
      await ctx.answerCbQuery();
      await this.handleHelp(ctx);
    });

    for (const provider of SUPPORTED_PROVIDERS) {
      this.bot.action(`remove_${provider}`, async (ctx) => {
        await ctx.answerCbQuery();
        const user = await this.ensureUserFromCallback(ctx);
        if (!user) return;

        const providers = await this.db.getUserProviders(user.id);
        const existingProvider = providers.find((p) => p.provider === provider);
        const removedUrl = existingProvider?.url;

        const removed = await this.db.deleteUserProvider(user.id, provider);
        await this.db.clearProviderCheckpoint(user.id, CHECKPOINT_NAMES[provider]);
        await ctx.deleteMessage();
        if (removed) {
          await this.monitoring.logSearchRemoved(user.id, user.first_name, PROVIDER_NAMES[provider], removedUrl);
          this.logger.info(`User ${user.first_name} removed ${provider} search`);
          await ctx.reply(`✅ Removed ${PROVIDER_NAMES[provider]} search.`);
        } else {
          await ctx.reply(`No search found for ${PROVIDER_NAMES[provider]}.`);
        }
        await this.showMainMenu(ctx);
      });

      this.bot.action(`edit_${provider}`, async (ctx) => {
        await ctx.answerCbQuery();
        const user = await this.ensureUserFromCallback(ctx);
        if (!user) return;

        await ctx.deleteMessage();
        await this.startProviderSetup(ctx, user, provider);
      });

      this.bot.action(`add_${provider}`, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          const user = await this.ensureUserFromCallback(ctx);
          if (!user) {
            await ctx.reply('Error: Could not identify user.');
            return;
          }

          await ctx.deleteMessage();
          await this.startProviderSetup(ctx, user, provider);
        } catch (error) {
          this.logger.error(`Error in add_${provider} callback: ${error}`);
          await ctx.reply(`Error: ${error}`);
        }
      });
    }

    // Deprecated provider callbacks
    this.bot.action('add_immonet', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.deleteMessage();
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Add Immowelt instead', 'add_immowelt')],
        [Markup.button.callback('Close', 'close_message')],
      ]);
      await ctx.reply(
        '⚠️ Immonet has merged with Immowelt.\n\n' +
          'All listings are now the same on both platforms.\n\n' +
          'Please use Immowelt instead.',
        keyboard
      );
    });
  }

  private async ensureUserFromCallback(ctx: Context): Promise<DbUser | null> {
    const from = ctx.from;
    if (!from) {
      return null;
    }

    let user = await this.db.findUserByTelegramId(from.id);
    if (!user) {
      user = await this.db.createUser(from.id, from.username ?? null, from.first_name);
    }
    return user;
  }

  private async showMainMenu(ctx: Context): Promise<void> {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Manage Notifications', 'show_list')],
      [Markup.button.callback('Help', 'show_help')],
    ]);
    await ctx.reply('What would you like to do?', keyboard);
  }

  private async handleStart(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;

    const existingUser = await this.db.findUserByTelegramId(from.id);
    const isNewUser = !existingUser;
    const user = await this.db.createUser(from.id, from.username ?? null, from.first_name);

    if (isNewUser) {
      await this.monitoring.logUserRegistered(user.id, user.username, user.first_name);
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Manage Notifications', 'show_list')],
      [Markup.button.callback('Help', 'show_help')],
      [Markup.button.callback('Close', 'close_message')],
    ]);

    await ctx.reply(
      `Welcome ${user.first_name}!\n\n` +
        `Standard platform notifications are sent via email with 30+ minute delays. ` +
        `By that time, landlords have already received hundreds of messages.\n\n` +
        `This bot monitors listings and notifies you INSTANTLY when something new appears. ` +
        `Be among the first to respond and dramatically increase your chances.\n\n` +
        `All major platforms in one place:\n` +
        `- ImmobilienScout24\n` +
        `- Immowelt\n` +
        `- Kleinanzeigen`,
      keyboard
    );
  }

  private async handleProviderCommand(ctx: Context, provider: SupportedProvider): Promise<void> {
    const user = await this.ensureUser(ctx);
    if (!user) return;

    await this.startProviderSetup(ctx, user, provider);
  }

  private async startProviderSetup(ctx: Context, user: DbUser, provider: SupportedProvider): Promise<void> {
    const telegramId = Number(user.telegram_id);
    this.userStates.set(telegramId, { awaitingUrlFor: provider });
    this.logger.info(`User ${user.first_name} (${telegramId}) started ${provider} setup`);

    const instructions: Record<SupportedProvider, string> = {
      immoscout:
        `ImmobilienScout24 setup:\n\n` +
        `1. Go to immobilienscout24.de\n` +
        `2. Search for apartments in your city\n` +
        `3. Apply filters (price, rooms, size)\n` +
        `4. Copy URL from browser\n\n` +
        `Example URL:\n` +
        `immobilienscout24.de/Suche/de/berlin/berlin/wohnung-mieten?price=-1500.0&roomsMin=2`,
      immowelt:
        `Immowelt setup:\n\n` +
        `1. Go to immowelt.de\n` +
        `2. Search for apartments in your city\n` +
        `3. Apply filters (price, rooms, size)\n` +
        `4. Copy URL from browser\n\n` +
        `Example URL:\n` +
        `immowelt.de/liste/berlin/wohnungen/mieten?pma=1500&rmi=2`,
      kleinanzeigen:
        `Kleinanzeigen setup:\n\n` +
        `1. Go to kleinanzeigen.de\n` +
        `2. Search in "Immobilien" category\n` +
        `3. Select your city and apply filters\n` +
        `4. Copy URL from browser\n\n` +
        `Example URL:\n` +
        `kleinanzeigen.de/s-wohnung-mieten/berlin/anzeige:angebote/c203l3331`,
    };

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Cancel', 'cancel_url_input')],
    ]);
    await ctx.reply(`${instructions[provider]}\n\nSend a message with your search URL for ${PROVIDER_NAMES[provider]}:`, keyboard);
  }

  private async handleAnyMessage(ctx: Context): Promise<void> {
    if (ctx.message && 'text' in ctx.message) return;

    const from = ctx.from;
    if (!from) return;

    const state = this.userStates.get(from.id);
    if (!state?.awaitingUrlFor) {
      await this.showMainMenu(ctx);
    }
  }

  private async handleTextMessage(ctx: Context): Promise<void> {
    try {
      const from = ctx.from;
      if (!from) return;

      const state = this.userStates.get(from.id);
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      if (!text) return;

      if (!state?.awaitingUrlFor) {
        await this.showMainMenu(ctx);
        return;
      }

      const url = text.replace(/\s+/g, '');
      const provider = state.awaitingUrlFor;

      const validation = this.validateProviderUrl(url, provider);
      if (!validation.valid) {
        this.userStates.delete(from.id);
        if (validation.error === 'immoscout_no_city') {
          await ctx.reply('❌ ImmoScout requires a city or geocodes in the URL.\n\nExamples:\n.../bayern/muenchen/wohnung-mieten\n...?geocodes=1276002059,1276003001');
        } else if (validation.error === 'immoscout_shape_not_supported') {
          await ctx.reply('❌ ImmoScout shape/polygon search is not supported.\n\nPlease use a city-based search URL.');
        } else {
          await ctx.reply('❌ Incorrect URL, cancelled.');
        }
        await this.showMainMenu(ctx);
        return;
      }

      const user = await this.ensureUser(ctx);
      if (!user) return;

      // Clean URL to remove problematic parameters (e.g., saveSearchId for ImmoScout)
      const cleanedUrl = this.cleanProviderUrl(url, provider);

      const existingProviders = await this.db.getUserProviders(user.id);
      const isUpdate = existingProviders.some((p) => p.provider === provider);

      await this.db.setUserProvider(user.id, provider, cleanedUrl);
      await this.db.clearProviderCheckpoint(user.id, CHECKPOINT_NAMES[provider]);
      this.userStates.delete(from.id);

      if (isUpdate) {
        await this.monitoring.logSearchUpdated(user.id, user.first_name, PROVIDER_NAMES[provider], cleanedUrl);
      } else {
        await this.monitoring.logSearchAdded(user.id, user.first_name, PROVIDER_NAMES[provider], cleanedUrl);
      }

      this.logger.info(`User ${user.first_name} set ${provider} search`);
      await ctx.reply(`✅ ${PROVIDER_NAMES[provider]} search saved!\n\nYou'll receive a confirmation when the first listing is found.`);
      await this.showMainMenu(ctx);
    } catch (error) {
      this.logger.error(`Error in handleTextMessage: ${error}`);
      await ctx.reply(`Error processing URL: ${error}`);
      await this.showMainMenu(ctx);
    }
  }

  private validateProviderUrl(
    url: string,
    provider: SupportedProvider
  ): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);
      const expectedDomains: Record<SupportedProvider, string[]> = {
        immoscout: ['immobilienscout24.de', 'www.immobilienscout24.de'],
        immowelt: ['immowelt.de', 'www.immowelt.de'],
        kleinanzeigen: ['kleinanzeigen.de', 'www.kleinanzeigen.de'],
      };

      if (!expectedDomains[provider].includes(parsed.hostname)) {
        return { valid: false, error: 'wrong_domain' };
      }

      if (provider === 'immoscout') {
        if (parsed.pathname.includes('/shape/')) {
          return { valid: false, error: 'immoscout_shape_not_supported' };
        }
        const hasGeocodes = parsed.searchParams.has('geocodes');
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        // Valid: /Suche/de/bayern/muenchen/wohnung-mieten (5 parts)
        // Valid: /Suche/de/wohnung-mieten?geocodes=... (geocodes param)
        // Invalid: /Suche/de/bayern/wohnung-mieten (4 parts - no city, no geocodes)
        if (!hasGeocodes && pathParts.length < 5) {
          return { valid: false, error: 'immoscout_no_city' };
        }
      }


      return { valid: true };
    } catch {
      return { valid: false, error: 'invalid_url' };
    }
  }

  private cleanProviderUrl(url: string, provider: SupportedProvider): string {
    try {
      const parsed = new URL(url);

      // Remove hash fragment (e.g., #/ at the end)
      parsed.hash = '';

      if (provider === 'immoscout') {
        // Remove saveSearchId - it's user-specific and breaks the mobile API
        parsed.searchParams.delete('saveSearchId');
        // Normalize enteredFrom to result_list
        if (parsed.searchParams.has('enteredFrom')) {
          parsed.searchParams.set('enteredFrom', 'result_list');
        }
      }

      return parsed.toString();
    } catch {
      return url;
    }
  }

  private async handleList(ctx: Context): Promise<void> {
    const user = await this.ensureUser(ctx);
    if (!user) return;

    const userProviders = await this.db.getUserProviders(user.id);
    const configuredSet = new Set(userProviders.map((p) => p.provider));

    const lines: string[] = [];
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

    for (const provider of SUPPORTED_PROVIDERS) {
      if (configuredSet.has(provider)) {
        lines.push(`✓ ${PROVIDER_NAMES[provider]}`);
        buttons.push([
          Markup.button.callback(`Edit ${PROVIDER_NAMES[provider]}`, `edit_${provider}`),
          Markup.button.callback(`Remove ${PROVIDER_NAMES[provider]}`, `remove_${provider}`),
        ]);
      }
    }

    if (lines.length > 0) {
      lines.push('');
    }

    const unconfigured = SUPPORTED_PROVIDERS.filter((p) => !configuredSet.has(p));
    if (unconfigured.length > 0 || DEPRECATED_PROVIDERS.length > 0) {
      lines.push('Available to add:');
      for (const provider of unconfigured) {
        lines.push(`○ ${PROVIDER_NAMES[provider]}`);
        buttons.push([Markup.button.callback(`Add ${PROVIDER_NAMES[provider]}`, `add_${provider}`)]);
      }
      for (const provider of DEPRECATED_PROVIDERS) {
        lines.push(`○ ${ALL_PROVIDER_NAMES[provider]}`);
        buttons.push([Markup.button.callback(`Add ${ALL_PROVIDER_NAMES[provider]}`, `add_${provider}`)]);
      }
    }

    buttons.push([Markup.button.callback('Close', 'close_message')]);

    const keyboard = Markup.inlineKeyboard(buttons);
    await ctx.reply(lines.join('\n'), keyboard);
  }

  private async handleRemoveProvider(ctx: Context, provider: SupportedProvider): Promise<void> {
    const user = await this.ensureUser(ctx);
    if (!user) return;

    const providers = await this.db.getUserProviders(user.id);
    const existingProvider = providers.find((p) => p.provider === provider);
    const removedUrl = existingProvider?.url;

    const removed = await this.db.deleteUserProvider(user.id, provider);
    await this.db.clearProviderCheckpoint(user.id, CHECKPOINT_NAMES[provider]);
    if (removed) {
      await this.monitoring.logSearchRemoved(user.id, user.first_name, PROVIDER_NAMES[provider], removedUrl);
      this.logger.info(`User ${user.first_name} removed ${provider} search`);
      await ctx.reply(`✅ Removed ${PROVIDER_NAMES[provider]} search`);
    } else {
      await ctx.reply(`No search found for ${PROVIDER_NAMES[provider]}`);
    }
  }

  private async handleClear(ctx: Context): Promise<void> {
    const user = await this.ensureUser(ctx);
    if (!user) return;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Yes, delete all', 'confirm_clear_yes'),
        Markup.button.callback('Cancel', 'confirm_clear_no'),
      ],
    ]);
    await ctx.reply('This will delete ALL your searches. Are you sure?', keyboard);
  }

  private async handleHelp(ctx: Context): Promise<void> {
    const user = await this.ensureUser(ctx);
    const configuredSet = new Set<string>();

    if (user) {
      const userProviders = await this.db.getUserProviders(user.id);
      userProviders.forEach((p) => configuredSet.add(p.provider));
    }

    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const provider of SUPPORTED_PROVIDERS) {
      if (configuredSet.has(provider)) {
        buttons.push([
          Markup.button.callback(`Edit ${PROVIDER_NAMES[provider]}`, `edit_${provider}`),
          Markup.button.callback(`Remove ${PROVIDER_NAMES[provider]}`, `remove_${provider}`),
        ]);
      } else {
        buttons.push([Markup.button.callback(`Add ${PROVIDER_NAMES[provider]}`, `add_${provider}`)]);
      }
    }
    for (const provider of DEPRECATED_PROVIDERS) {
      buttons.push([Markup.button.callback(`Add ${ALL_PROVIDER_NAMES[provider]}`, `add_${provider}`)]);
    }
    buttons.push([Markup.button.callback('Manage Notifications', 'show_list')]);
    buttons.push([Markup.button.callback('Close', 'close_message')]);

    const keyboard = Markup.inlineKeyboard(buttons);

    await ctx.reply(
      `How to set up searches:\n\n` +
        `1. Go to the platform website\n` +
        `2. Set your filters (city, price, rooms, etc.)\n` +
        `3. Copy the URL from browser address bar\n` +
        `4. Click a button below to add or edit a platform`,
      keyboard
    );
  }

  private async ensureUser(ctx: Context): Promise<DbUser | null> {
    const from = ctx.from;
    if (!from) {
      await ctx.reply('Could not identify user.');
      return null;
    }

    let user = await this.db.findUserByTelegramId(from.id);
    if (!user) {
      user = await this.db.createUser(from.id, from.username ?? null, from.first_name);
    }
    return user;
  }

  async start(): Promise<void> {
    this.logger.info('Starting Telegram bot...');

    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'list', description: 'Manage notifications' },
      { command: 'clear', description: 'Remove all notifications' },
      { command: 'help', description: 'Show help' },
    ]);

    this.bot.catch((err) => {
      this.logger.error(`Bot error: ${err}`);
    });
    this.bot.launch({ dropPendingUpdates: true }).then(() => {
      this.logger.info('Telegram bot polling started');
    }).catch((err) => {
      this.logger.error(`Failed to start Telegram bot: ${err}`);
    });
    this.logger.info('Telegram bot initialized');
  }

  stop(): void {
    this.bot.stop('SIGTERM');
    this.logger.info('Telegram bot stopped');
  }

  async notifyNewListings(telegramId: number, listings: Listing[]): Promise<void> {
    if (listings.length === 0) return;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Manage Notifications', 'listing_show_list'),
        Markup.button.callback('Help', 'listing_show_help'),
      ],
    ]);

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      const message = this.formatListingMessage(listing);
      const isLast = i === listings.length - 1;

      try {
        if (isLast) {
          await this.bot.telegram.sendMessage(telegramId, message, { parse_mode: 'HTML', ...keyboard });
        } else {
          await this.bot.telegram.sendMessage(telegramId, message, { parse_mode: 'HTML' });
        }
      } catch (error) {
        this.logger.error(`Failed to send notification to ${telegramId}: ${error}`);
      }
    }
  }

  private formatListingMessage(listing: Listing): string {
    const lines: string[] = [];
    lines.push(`🏠 <b>New listing from ${listing.source}</b>`);
    lines.push('');
    lines.push(`<b>${this.escapeHtml(listing.title)}</b>`);
    if (listing.price) lines.push(`💰 ${this.escapeHtml(listing.price)}`);
    if (listing.size) lines.push(`📐 ${this.escapeHtml(listing.size)}`);
    if (listing.address) lines.push(`📍 ${this.escapeHtml(listing.address)}`);
    lines.push('');
    lines.push(`<a href="${listing.link}">View listing</a>`);
    return lines.join('\n');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

}
