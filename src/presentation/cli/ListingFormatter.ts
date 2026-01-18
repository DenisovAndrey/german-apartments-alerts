import { Listing } from '../../domain/entities/Listing.js';
import { UserScrapeResult, ProviderStatus } from '../../application/services/ScrapingService.js';

export class ListingFormatter {
  private readonly separator = '-'.repeat(60);

  formatListing(listing: Listing, isNew = false): string {
    const newBadge = isNew ? ' [NEW]' : '';
    const sourceBadge = `[${listing.source}]`;

    return `
${this.separator}${newBadge} ${sourceBadge}
Title: ${listing.title}
Price: ${listing.price || 'N/A'}
Size: ${listing.size || 'N/A'}
Address: ${listing.address}
Link: ${listing.link}
${this.separator}`;
  }

  formatUserSummary(result: UserScrapeResult): string {
    const providerSummary = Array.from(result.byProvider.entries())
      .map(([name, listings]) => {
        const status = result.providerStatuses.find((s) => s.name === name);
        const healthIndicator = status?.healthy ? '✓' : '✗';
        return `${name}: ${listings.length} ${healthIndicator}`;
      })
      .join(' | ');

    return `
[${result.user.name}] ${providerSummary}
Total: ${result.allListings.length} | New: ${result.newListings.length}`;
  }

  formatProviderHealth(statuses: ProviderStatus[]): string {
    const unhealthy = statuses.filter((s) => !s.healthy);
    if (unhealthy.length === 0) return '';

    const lines = ['\n⚠️  PROVIDER HEALTH WARNINGS:'];
    for (const status of unhealthy) {
      if (status.consecutiveErrors > 0) {
        lines.push(`  - ${status.name}: ${status.consecutiveErrors} consecutive errors`);
      } else if (status.lastScrapeCount === 0) {
        lines.push(`  - ${status.name}: No listings returned (possible blocking)`);
      }
    }
    return lines.join('\n');
  }

  formatHeader(users: { name: string; providerCount: number }[], intervalMs: number, maxResults: number): string {
    const header = [
      'Multi-User Apartment Scraper',
      '='.repeat(70),
      `Users: ${users.map((u) => `${u.name} (${u.providerCount} providers)`).join(', ')}`,
      `Interval: ${intervalMs / 1000} seconds | Max results per provider: ${maxResults}`,
      '='.repeat(70),
    ];

    return header.join('\n');
  }

  formatTimestamp(): string {
    return new Date().toLocaleString('de-DE');
  }
}
