import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './shared/core.module';
import { HttpPlatformModule } from './shared/http/http-platform.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [ScheduleModule.forRoot(), CoreModule, PrismaModule, RedisModule, HttpPlatformModule, AuthModule, SubscriptionsModule],
})
export class AppModule {}
