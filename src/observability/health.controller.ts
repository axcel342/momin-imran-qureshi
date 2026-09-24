import { Controller, Get } from '@nestjs/common';
import { DomainError } from '../shared/domain/errors';
import { HealthProbe, RateLimitGroup } from '../shared/http/decorators';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RedisService } from '../shared/redis/redis.service';

@Controller('health')
@RateLimitGroup('ops')
@HealthProbe()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      this.redis.client.ping().then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);
    const checks = { database, redis };
    if (database === 'down' || redis === 'down') {
      throw new DomainError('SERVICE_UNAVAILABLE', 'Service degraded', { checks });
    }
    return { status: 'ok', checks };
  }
}
