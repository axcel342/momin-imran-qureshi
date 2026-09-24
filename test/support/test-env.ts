export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://ggi:ggi@127.0.0.1:5432/ggi_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
  SUPABASE_URL: 'https://mock-project.supabase.co',
  CORS_ORIGINS: 'https://app.example.com',
  HEALTH_CHECK_TOKEN: 'test-health-token-0123456789',
  REQUEST_TIMEOUT_MS: '5000',
  AI_MOCK_MIN_LATENCY_MS: '0',
  AI_MOCK_MAX_LATENCY_MS: '0',
  PAYMENT_FAILURE_RATE: '0',
  BILLING_CRON: '',
  LOG_LEVEL: 'silent',
} as const;

Object.assign(process.env, TEST_ENV);
