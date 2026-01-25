import { RawListing } from '../entities/Listing.js';

export interface IBrowserService {
  initialize(): Promise<void>;
  scrape(
    url: string,
    containerSelector: string,
    fields: Record<string, string>,
    waitForSelector?: string
  ): Promise<RawListing[]>;
  evaluate<T>(url: string, script: string, waitForSelector?: string): Promise<T>;
  close(): Promise<void>;
}
