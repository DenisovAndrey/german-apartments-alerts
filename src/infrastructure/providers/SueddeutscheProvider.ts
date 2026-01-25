import { BaseProvider } from './BaseProvider.js';
import { Listing } from '../../domain/entities/Listing.js';

interface AtomEntry {
  title: string;
  id: string;
  link: string;
  summary: string;
  price: number;
  rooms: string;
  area: string;
  postalCode: string;
  locality: string;
  image?: string;
}

export class SueddeutscheProvider extends BaseProvider {
  readonly name = 'Süddeutsche';
  readonly id = 'sueddeutsche';

  private convertToAtomUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Convert /suche?... or /suche/... to /suche.atom?...
      if (parsed.pathname.includes('/suche')) {
        parsed.pathname = '/suche.atom';
      }

      // Always force sort by newest
      parsed.searchParams.set('s', 'most_recently_updated_first');

      return parsed.toString();
    } catch {
      // Fallback: append sort parameter
      const separator = url.includes('?') ? '&' : '?';
      return url + separator + 's=most_recently_updated_first';
    }
  }

  private parseAtomFeed(xml: string): AtomEntry[] {
    const entries: AtomEntry[] = [];

    // Extract all <entry>...</entry> blocks
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entryXml = match[1];

      const getValue = (tag: string): string => {
        const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`);
        const match = entryXml.match(regex);
        return match ? match[1].trim() : '';
      };

      // Extract link href (first link without rel attribute or with rel="alternate")
      const linkMatch = entryXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/);
      const link = linkMatch ? linkMatch[1] : '';

      // Extract image from media:thumbnail
      const imageMatch = entryXml.match(/<media:thumbnail[^>]*url=["']([^"']+)["'][^>]*\/?>/);
      const image = imageMatch ? imageMatch[1] : undefined;

      // Extract price from cm:price
      const priceMatch = entryXml.match(/<cm:price[^>]*>([^<]*)<\/cm:price>/);
      const price = priceMatch ? parseInt(priceMatch[1], 10) : 0;

      const entry: AtomEntry = {
        title: getValue('title'),
        id: getValue('id'),
        link: link,
        summary: getValue('summary'),
        price,
        rooms: getValue('cm:rooms'),
        area: getValue('cm:area'),
        postalCode: getValue('cm:postalCode'),
        locality: getValue('cm:locality'),
        image,
      };

      if (entry.id && entry.title) {
        entries.push(entry);
      }
    }

    return entries;
  }

  async scrape(maxResults: number): Promise<Listing[]> {
    if (!this.isEnabled()) return [];

    const startTime = Date.now();
    const atomUrl = this.convertToAtomUrl(this.url!);

    try {
      const response = await fetch(atomUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/atom+xml, application/xml, text/xml',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      const entries = this.parseAtomFeed(xml);

      if (entries.length === 0) {
        throw new Error('No listings found in Atom feed - possible format change or blocking');
      }

      const listings = entries.slice(0, maxResults).map((entry) => this.transformEntry(entry));

      this.resetErrors();
      return listings;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, { duration: `${Date.now() - startTime}ms` });
      return [];
    }
  }

  private transformEntry(entry: AtomEntry): Listing {
    // Format price
    const priceFormatted = entry.price > 0 ? `${entry.price.toLocaleString('de-DE')} €` : 'Preis auf Anfrage';

    // Format size (already includes m² unit in some cases)
    const sizeFormatted = entry.area ? `${entry.area.replace(',', '.')} m²` : '';

    // Build address from locality and postal code
    const address = [entry.postalCode, entry.locality].filter(Boolean).join(' ');

    return this.normalizeListing(
      {
        id: entry.id,
        title: entry.title,
        price: priceFormatted,
        size: sizeFormatted,
        link: entry.link || entry.id,
        address: address,
        description: entry.summary,
        image: entry.image,
      },
      this.name
    );
  }
}
