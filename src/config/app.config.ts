import 'dotenv/config';

export interface AppConfig {
  intervalMs: number;
  maxResultsPerProvider: number;
  databaseUrl: string;
  telegramBotToken?: string;
  adminBotToken?: string;
  adminUserId?: string;
  alertOnScrapingErrors: boolean;
}

export const loadAppConfig = (): AppConfig => ({
  intervalMs: parseInt(process.env.INTERVAL_MS || '60000', 10),
  maxResultsPerProvider: parseInt(process.env.MAX_RESULTS_PER_PROVIDER || '10', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://scraper:scraper123@localhost:5432/scraper',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  adminBotToken: process.env.ADMIN_TELEGRAM_BOT_TOKEN,
  adminUserId: process.env.ADMIN_USER_ID,
  alertOnScrapingErrors: process.env.ALERT_ON_SCRAPING_ERRORS !== 'false',
});
