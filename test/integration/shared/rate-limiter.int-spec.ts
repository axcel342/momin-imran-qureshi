import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../src/config/env';
import { DomainError } from '../../../src/shared/domain/errors';
import { RateLimiter } from '../../../src/shared/redis/rate-limiter';
import { RedisService } from '../../../src/shared/redis/redis.service';

describe('RateLimiter', () => {
  const redis = new RedisService(loadConfig(process.env));
  const limiter = new RateLimiter(redis);
  afterAll(() => redis.onModuleDestroy());

  it('allows up to the limit within the window, then blocks with a retry hint', async () => {
    const key = `test:${randomUUID()}`;
    expect((await limiter.hit(key, 2)).allowed).toBe(true);
    expect((await limiter.hit(key, 2)).allowed).toBe(true);
    const third = await limiter.hit(key, 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('keeps separate counters per key', async () => {
    const a = `test:${randomUUID()}`;
    const b = `test:${randomUUID()}`;
    await limiter.hit(a, 1);
    expect((await limiter.hit(a, 1)).allowed).toBe(false);
    expect((await limiter.hit(b, 1)).allowed).toBe(true);
  });

  it('fails closed with SERVICE_UNAVAILABLE when Redis is unreachable', async () => {
    const dead = new RedisService(loadConfig({ ...process.env, REDIS_URL: 'redis://127.0.0.1:1/0' }));
    const deadLimiter = new RateLimiter(dead);
    await expect(deadLimiter.hit('x', 1)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(deadLimiter.hit('x', 1)).rejects.toBeInstanceOf(DomainError);
    dead.client.disconnect();
  });
});
