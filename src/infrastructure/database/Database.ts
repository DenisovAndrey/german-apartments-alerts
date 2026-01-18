import pg from 'pg';
import { ILogger, LoggerFactory } from '../logging/Logger.js';

const { Pool } = pg;

export interface DbUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string;
  created_at: Date;
}

export interface DbUserProvider {
  user_id: string;
  provider: string;
  url: string;
  created_at: Date;
}

export class DatabaseConnection {
  private readonly pool: pg.Pool;
  private readonly logger: ILogger;

  constructor(connectionString: string) {
    this.logger = LoggerFactory.create('Database');
    this.pool = new Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    // Users table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // User providers (search URLs)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_providers (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, provider)
      )
    `);

    // Checkpoints table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        hashes JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, provider)
      )
    `);

    this.logger.info('Database initialized');
  }

  // User methods
  async findUserByTelegramId(telegramId: number): Promise<DbUser | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    return result.rows[0] || null;
  }

  async createUser(telegramId: number, username: string | null, firstName: string): Promise<DbUser> {
    const id = `tg_${telegramId}`;
    const result = await this.pool.query(
      `INSERT INTO users (id, telegram_id, username, first_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name
       RETURNING *`,
      [id, telegramId, username, firstName]
    );
    return result.rows[0];
  }

  async getAllUsers(): Promise<DbUser[]> {
    const result = await this.pool.query('SELECT * FROM users');
    return result.rows;
  }

  // User provider methods
  async getUserProviders(userId: string): Promise<DbUserProvider[]> {
    const result = await this.pool.query(
      'SELECT * FROM user_providers WHERE user_id = $1',
      [userId]
    );
    return result.rows;
  }

  async setUserProvider(userId: string, provider: string, url: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_providers (user_id, provider, url)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         url = EXCLUDED.url`,
      [userId, provider, url]
    );
  }

  async deleteUserProvider(userId: string, provider: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM user_providers WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteAllUserProviders(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM user_providers WHERE user_id = $1', [userId]);
  }

  // Checkpoint methods
  async getCheckpoints(userId: string, provider: string): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT hashes FROM checkpoints WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );

    if (result.rows.length === 0) return [];
    return result.rows[0].hashes;
  }

  async setCheckpoints(userId: string, provider: string, hashes: string[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO checkpoints (user_id, provider, hashes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, provider) DO UPDATE SET
         hashes = EXCLUDED.hashes,
         updated_at = NOW()`,
      [userId, provider, JSON.stringify(hashes)]
    );
  }

  async getProviderCountForUser(userId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT COUNT(*) as count FROM checkpoints WHERE user_id = $1',
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  async clearUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM checkpoints WHERE user_id = $1', [userId]);
  }

  async clearProviderCheckpoint(userId: string, provider: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM checkpoints WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
    this.logger.info('Database connection closed');
  }
}
