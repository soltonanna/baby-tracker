#!/usr/bin/env node
/**
 * First-run setup: create `apps/api/.env` from `.env.example`, with a freshly
 * generated JWT_SECRET.
 *
 * No secret is ever committed or hard-coded — the value is generated on this
 * machine, written to a gitignored file, and never leaves it. An existing .env
 * is left completely untouched, so running this twice is safe.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(repositoryRoot, 'apps', 'api', '.env.example');
const envPath = join(repositoryRoot, 'apps', 'api', '.env');
const shown = (path) => relative(repositoryRoot, path);

if (!existsSync(examplePath)) {
  console.error(`Cannot find ${shown(examplePath)}. Is this the repository root?`);
  process.exit(1);
}

if (existsSync(envPath)) {
  console.log(`${shown(envPath)} already exists — leaving it untouched.`);
  process.exit(0);
}

// 48 bytes is comfortably above the 32-character minimum env.ts enforces.
const secret = randomBytes(48).toString('base64url');
const contents = readFileSync(examplePath, 'utf8').replace(
  /^JWT_SECRET=.*$/m,
  `JWT_SECRET=${secret}`,
);

if (!contents.includes(`JWT_SECRET=${secret}`)) {
  console.error(`No JWT_SECRET line found in ${shown(examplePath)}; not writing a partial .env.`);
  process.exit(1);
}

writeFileSync(envPath, contents, { mode: 0o600 });
console.log(`Created ${shown(envPath)} with a freshly generated JWT_SECRET.`);
