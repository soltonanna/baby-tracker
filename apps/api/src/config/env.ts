import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is parsed once, at startup, and fails loudly. Nothing else in the
 * application reads `process.env`.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/baby_tracker'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Signs access tokens (decision D6). Required in every environment. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * Refresh-cookie attributes. `z.stringbool` rather than `z.coerce.boolean`,
   * because `Boolean('false')` is `true` — a genuinely dangerous default here.
   * Left undefined, COOKIE_SECURE follows NODE_ENV (see `cookieSecure` below).
   */
  COOKIE_SECURE: z.stringbool().optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  /**
   * Number of reverse proxies in front of the API (Express `trust proxy`).
   * 0 locally. Behind a hosting proxy such as Render it must be set, or every
   * request appears to come from the proxy and the auth rate limits (D20) are
   * shared by all users.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'If this is a fresh clone, run `npm run setup` from the repository root: it\n' +
        'creates apps/api/.env from .env.example with a freshly generated JWT_SECRET.',
    );
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Secure cookies are mandatory in production, and the default outside it is off. */
export const cookieSecure: boolean = env.COOKIE_SECURE ?? isProduction;

if (isProduction && !cookieSecure) {
  throw new Error('COOKIE_SECURE must not be disabled in production');
}
if (env.COOKIE_SAMESITE === 'none' && !cookieSecure) {
  throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
}
