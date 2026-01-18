import { Listing } from '../entities/Listing.js';

export interface IListingProvider {
  readonly name: string;
  readonly id: string;

  scrape(maxResults: number): Promise<Listing[]>;
  isEnabled(): boolean;
}
