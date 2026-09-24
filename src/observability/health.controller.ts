import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  async check(@Res({ passthrough: true }) res: Response) {
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
    const healthy = database === 'up' && redis === 'up';
    res.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'degraded', checks: { database, redis } };
  }
}
