import { IListingRepository } from '../../domain/ports/IListingRepository.js';

export class InMemoryListingRepository implements IListingRepository {
  private readonly checkpoints = new Map<string, string[]>();

  private getKey(userId: string, provider: string): string {
    return `${userId}:${provider}`;
  }

  async getCheckpoints(userId: string, provider: string): Promise<string[]> {
    return this.checkpoints.get(this.getKey(userId, provider)) ?? [];
  }

  async setCheckpoints(userId: string, provider: string, hashes: string[]): Promise<void> {
    this.checkpoints.set(this.getKey(userId, provider), hashes);
  }

  async getProviderCountForUser(userId: string): Promise<number> {
    let count = 0;
    for (const key of this.checkpoints.keys()) {
      if (key.startsWith(`${userId}:`)) {
        count++;
      }
    }
    return count;
  }

  async clearUser(userId: string): Promise<void> {
    for (const key of this.checkpoints.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.checkpoints.delete(key);
      }
    }
  }
}
