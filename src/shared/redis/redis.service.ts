import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DomainError } from '../domain/errors';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 1000,
      disconnectTimeout: 0,
    });
    this.client.on('error', () => undefined); // errors surface per command via run()
  }

  async run<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch {
      throw new DomainError('SERVICE_UNAVAILABLE', 'A required dependency is unavailable');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => {
      this.client.disconnect();
    });
  }
}
