import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase, disconnectFromDatabase } from './db/connect.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const app = createApp();

  // The API starts even if MongoDB is unreachable, so that Phase 0 can be run
  // and inspected before a database is provisioned. /api/v1/health reports the
  // real connection state.
  try {
    await connectToDatabase(env.MONGODB_URI);
  } catch (error) {
    logger.warn(
      { err: error },
      'Could not connect to MongoDB — the API is running without a database',
    );
  }

  const server: Server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}/api/v1`);
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void disconnectFromDatabase().finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start the API');
  process.exit(1);
});
