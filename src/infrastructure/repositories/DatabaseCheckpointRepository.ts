import { IListingRepository } from '../../domain/ports/IListingRepository.js';
import { DatabaseConnection } from '../database/Database.js';

export class DatabaseCheckpointRepository implements IListingRepository {
  constructor(private readonly db: DatabaseConnection) {}

  async getCheckpoints(userId: string, provider: string): Promise<string[]> {
    return this.db.getCheckpoints(userId, provider);
  }

  async setCheckpoints(userId: string, provider: string, hashes: string[]): Promise<void> {
    await this.db.setCheckpoints(userId, provider, hashes);
  }

  async getProviderCountForUser(userId: string): Promise<number> {
    return this.db.getProviderCountForUser(userId);
  }

  async clearUser(userId: string): Promise<void> {
    await this.db.clearUser(userId);
  }
}
