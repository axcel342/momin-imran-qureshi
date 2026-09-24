import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());
const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(3000, 1, 65535),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SUPABASE_URL: z.url(),
    SUPABASE_JWKS_URL: optionalUrl,
    SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: bool,
    REQUEST_TIMEOUT_MS: int(10000, 100, 60000),
    FREE_MESSAGES_PER_MONTH: int(3),
    AI_MOCK_MIN_LATENCY_MS: int(300),
    AI_MOCK_MAX_LATENCY_MS: int(1500),
    PAYMENT_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.2),
    BILLING_CRON: z.string().default('0 * * * * *'),
    HEALTH_CHECK_TOKEN: z.string().min(16),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .refine((c) => c.AI_MOCK_MAX_LATENCY_MS >= c.AI_MOCK_MIN_LATENCY_MS, {
    message: 'must be >= AI_MOCK_MIN_LATENCY_MS',
    path: ['AI_MOCK_MAX_LATENCY_MS'],
  });

export type AppConfig = z.infer<typeof envSchema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
