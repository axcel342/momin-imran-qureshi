import { Injectable } from '@nestjs/common';
import { WINDOW_SECONDS } from './rate-limit.config';
import { RedisService } from './redis.service';

const FIXED_WINDOW_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const [count, ttl] = (await this.redis.run((c) => c.eval(FIXED_WINDOW_LUA, 1, key, WINDOW_SECONDS))) as [number, number];
    return { allowed: count <= limit, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
  }
}
