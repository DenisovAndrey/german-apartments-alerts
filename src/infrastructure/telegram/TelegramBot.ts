import { Telegraf, Context, Markup } from 'telegraf';
import { DatabaseConnection, DbUser } from '../database/Database.js';
import { ILogger, LoggerFactory } from '../logging/Logger.js';
import { Listing } from '../../domain/entities/Listing.js';

const SUPPORTED_PROVIDERS = ['immoscout', 'immowelt', 'immonet', 'kleinanzeigen'] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const PROVIDER_NAMES: Record<SupportedProvider, string> = {
  immoscout: 'ImmobilienScout24',
  immowelt: 'Immowelt',
  immonet: 'Immonet',
  kleinanzeigen: 'Kleinanzeigen',
};

// Must match provider.name in each provider class (used for checkpoint storage)
const CHECKPOINT_NAMES: Record<SupportedProvider, string> = {
  immoscout: 'ImmoScout',
  immowelt: 'Immowelt',
  immonet: 'Immonet',
  kleinanzeigen: 'Kleinanzeigen',
};

interface UserState {
  awaitingUrlFor?: SupportedProvider;
}

export class TelegramBot {
  private readonly bot: Telegraf;
  private readonly logger: ILogger;
  private readonly userStates: Map<number, UserState> = new Map();

  constructor(
    token: string,
    private readonly db: DatabaseConnection
  ) {
    this.logger = LoggerFactory.create('TelegramBot');
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
    this.bot.command('immonet', (ctx) => this.handleProviderCommand(ctx, 'immonet'));
    this.bot.command('kleinanzeigen', (ctx) => this.handleProviderCommand(ctx, 'kleinanzeigen'));

    this.bot.command('remove_immoscout', (ctx) => this.handleRemoveProvider(ctx, 'immoscout'));
    this.bot.command('remove_immowelt', (ctx) => this.handleRemoveProvider(ctx, 'immowelt'));
    this.bot.command('remove_immonet', (ctx) => this.handleRemoveProvider(ctx, 'immonet'));
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

    for (const provider of SUPPORTED_PROVIDERS) {
      this.bot.action(`remove_${provider}`, async (ctx) => {
        await ctx.answerCbQuery();
        const user = await this.ensureUserFromCallback(ctx);
        if (!user) return;

        const removed = await this.db.deleteUserProvider(user.id, provider);
        await this.db.clearProviderCheckpoint(user.id, CHECKPOINT_NAMES[provider]);
        await ctx.deleteMessage();
        if (removed) {
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

    const user = await this.db.createUser(from.id, from.username ?? null, from.first_name);

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
        `- Immonet\n` +
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
      immonet:
        `Immonet setup:\n\n` +
        `1. Go to immonet.de\n` +
        `2. Search for apartments in your city\n` +
        `3. Apply filters (price, rooms, size)\n` +
        `4. Copy URL from browser\n\n` +
        `Example URL:\n` +
        `immonet.de/immobiliensuche/mieten/wohnung/berlin`,
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
      if (!state?.awaitingUrlFor) {
        await this.showMainMenu(ctx);
        return;
      }

      const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      if (!text) return;

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

      await this.db.setUserProvider(user.id, provider, url);
      await this.db.clearProviderCheckpoint(user.id, CHECKPOINT_NAMES[provider]);
      this.userStates.delete(from.id);

      this.logger.info(`User ${user.first_name} set ${provider} search`);
      await ctx.reply(`✅ ${provider} search saved!\n\nYou'll receive a confirmation when the first listing is found.`);
      await this.showMainMenu(ctx);
    } catch (error) {
      this.logger.error(`Error in handleTextMessage: ${error}`);
      await ctx.reply(`Error processing URL: ${error}`);
      await this.showMainMenu(ctx);
    }
  }

  private validateProviderUrl(url: string, provider: SupportedProvider): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);
      const expectedDomains: Record<SupportedProvider, string[]> = {
        immoscout: ['immobilienscout24.de', 'www.immobilienscout24.de'],
        immowelt: ['immowelt.de', 'www.immowelt.de'],
        immonet: ['immonet.de', 'www.immonet.de'],
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
    if (unconfigured.length > 0) {
      lines.push('Available to add:');
      for (const provider of unconfigured) {
        lines.push(`○ ${PROVIDER_NAMES[provider]}`);
        buttons.push([Markup.button.callback(`Add ${PROVIDER_NAMES[provider]}`, `add_${provider}`)]);
      }
    }

    buttons.push([Markup.button.callback('Close', 'close_message')]);

    const keyboard = Markup.inlineKeyboard(buttons);
    await ctx.reply(lines.join('\n'), keyboard);
  }

  private async handleRemoveProvider(ctx: Context, provider: SupportedProvider): Promise<void> {
    const user = await this.ensureUser(ctx);
    if (!user) return;

    const removed = await this.db.deleteUserProvider(user.id, provider);
    await this.db.clearProviderCheckpoint(user.id, CHECKPOINT_NAMES[provider]);
    if (removed) {
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
      { command: 'list', description: 'Show your searches' },
      { command: 'immoscout', description: 'Add ImmobilienScout24 search' },
      { command: 'immowelt', description: 'Add Immowelt search' },
      { command: 'immonet', description: 'Add Immonet search' },
      { command: 'kleinanzeigen', description: 'Add Kleinanzeigen search' },
      { command: 'clear', description: 'Remove all searches' },
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

    for (const listing of listings) {
      const message = this.formatListingMessage(listing);
      try {
        await this.bot.telegram.sendMessage(telegramId, message, { parse_mode: 'HTML' });
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
