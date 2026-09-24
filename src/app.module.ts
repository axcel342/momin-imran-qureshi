import { Module } from '@nestjs/common';
import { CoreModule } from './shared/core.module';
import { HttpPlatformModule } from './shared/http/http-platform.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';

@Module({
  imports: [CoreModule, PrismaModule, RedisModule, HttpPlatformModule],
})
export class AppModule {}
