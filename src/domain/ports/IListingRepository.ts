export interface IListingRepository {
  getCheckpoints(userId: string, provider: string): Promise<string[]>;
  setCheckpoints(userId: string, provider: string, hashes: string[]): Promise<void>;
  getProviderCountForUser(userId: string): Promise<number>;
  clearUser(userId: string): Promise<void>;
}
