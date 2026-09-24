import { Injectable } from '@nestjs/common';
import { RedisService } from '../../shared/redis/redis.service';
import type { NonceStore } from '../domain/ports';

export const NONCE_TTL_SECONDS = 120;

@Injectable()
export class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: RedisService) {}

  async claim(sessionId: string, nonce: string): Promise<boolean> {
    const result = await this.redis.run((c) => c.set(`nonce:${sessionId}:${nonce}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX'));
    return result === 'OK';
  }
}
