export interface ProviderConfig {
  name: string;
  id: string;
  url: string;
  enabled: boolean;
}

export interface BrowserProviderConfig extends ProviderConfig {
  crawlContainer: string;
  crawlFields: Record<string, string>;
  waitForSelector?: string;
  sortByDateParam?: string;
}
