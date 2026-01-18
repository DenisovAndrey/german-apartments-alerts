import puppeteer, { Browser } from 'puppeteer';
import { IBrowserService } from '../../domain/ports/IBrowserService.js';
import { RawListing } from '../../domain/entities/Listing.js';

export class BrowserService implements IBrowserService {
  private browser: Browser | null = null;
  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    }
  }

  async scrape(
    url: string,
    containerSelector: string,
    fields: Record<string, string>,
    waitForSelector?: string
  ): Promise<RawListing[]> {
    await this.initialize();

    const page = await this.browser!.newPage();
    await page.setUserAgent(this.userAgent);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
      }

      const listings = await page.evaluate(
        (container: string, fieldMap: Record<string, string>) => {
          const cards = document.querySelectorAll(container);
          return Array.from(cards).map((card) => {
            const result: Record<string, string | null> = {};

            for (const [key, selector] of Object.entries(fieldMap)) {
              try {
                let sel = selector.split('|')[0].trim();
                let attr: string | null = null;

                if (sel.includes('@')) {
                  const parts = sel.split('@');
                  sel = parts[0];
                  attr = parts[1];
                }

                const el = sel === '*' ? card : card.querySelector(sel);
                if (el) {
                  result[key] = attr
                    ? el.getAttribute(attr)
                    : el.textContent?.replace(/\n/g, ' ').trim() || null;
                } else {
                  result[key] = null;
                }
              } catch {
                result[key] = null;
              }
            }
            return result;
          });
        },
        containerSelector,
        fields
      );

      return listings as RawListing[];
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
