import { loadConfig } from '../../../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  SUPABASE_URL: 'https://abc.supabase.co',
  HEALTH_CHECK_TOKEN: 'a-very-long-health-token',
};

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.FREE_MESSAGES_PER_MONTH).toBe(3);
    expect(c.REQUEST_TIMEOUT_MS).toBe(10000);
    expect(c.CORS_ORIGINS).toEqual([]);
    expect(c.TRUST_PROXY).toBe(false);
    expect(c.SUPABASE_JWT_AUDIENCE).toBe('authenticated');
    expect(c.SUPABASE_JWKS_URL).toBeUndefined();
  });

  it('parses CSV origins, booleans and numbers', () => {
    const c = loadConfig({
      ...base,
      CORS_ORIGINS: 'https://a.com, https://b.com',
      TRUST_PROXY: 'true',
      PORT: '8080',
    });
    expect(c.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    expect(c.TRUST_PROXY).toBe(true);
    expect(c.PORT).toBe(8080);
  });

  it('treats an empty SUPABASE_JWKS_URL as unset and an empty BILLING_CRON as disabled', () => {
    const c = loadConfig({ ...base, SUPABASE_JWKS_URL: '', BILLING_CRON: '' });
    expect(c.SUPABASE_JWKS_URL).toBeUndefined();
    expect(c.BILLING_CRON).toBe('');
  });

  it('fails fast listing missing keys without echoing secret values', () => {
    const run = () => loadConfig({ ...base, DATABASE_URL: undefined, HEALTH_CHECK_TOKEN: 'short-secret' });
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).toThrow(/HEALTH_CHECK_TOKEN/);
    expect(run).not.toThrow(/short-secret/);
  });

  it('rejects max latency below min latency', () => {
    expect(() =>
      loadConfig({ ...base, AI_MOCK_MIN_LATENCY_MS: '500', AI_MOCK_MAX_LATENCY_MS: '100' }),
    ).toThrow(/AI_MOCK_MAX_LATENCY_MS/);
  });
});
