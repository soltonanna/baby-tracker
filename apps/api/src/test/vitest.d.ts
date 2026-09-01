import 'vitest';

/**
 * Values `globalSetup` hands to the test workers via `project.provide`,
 * readable in setup files and tests with `inject`.
 */
declare module 'vitest' {
  interface ProvidedContext {
    /** The MongoDB the integration suite connects to, chosen once per run. */
    mongoUri: string;
    /** Where that server came from, for diagnostics. */
    mongoSource: 'external' | 'in-memory';
  }
}
