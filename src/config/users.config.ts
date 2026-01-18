import 'dotenv/config';
import { User } from '../domain/entities/User.js';

export const loadUsersConfig = (): User[] => {
  const usersJson = process.env.USERS;
  if (!usersJson) {
    throw new Error('USERS environment variable is not set');
  }

  try {
    return JSON.parse(usersJson);
  } catch (error) {
    throw new Error(`Failed to parse USERS environment variable: ${error}`);
  }
};
