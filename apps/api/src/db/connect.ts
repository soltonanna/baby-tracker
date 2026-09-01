import mongoose from 'mongoose';
import { logger } from '../lib/logger.js';

export type DatabaseStatus =
  'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'unknown';

const READY_STATES: Record<number, DatabaseStatus> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function databaseStatus(): DatabaseStatus {
  return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
}

export async function connectToDatabase(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info({ database: mongoose.connection.name }, 'Connected to MongoDB');
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}
