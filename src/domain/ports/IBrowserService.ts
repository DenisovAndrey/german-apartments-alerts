import { RawListing } from '../entities/Listing.js';

export interface IBrowserService {
  initialize(): Promise<void>;
  scrape(
    url: string,
    containerSelector: string,
    fields: Record<string, string>,
    waitForSelector?: string
  ): Promise<RawListing[]>;
  close(): Promise<void>;
}
