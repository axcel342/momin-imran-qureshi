import { Module } from '@nestjs/common';
import { CoreModule } from './shared/core.module';
import { HttpPlatformModule } from './shared/http/http-platform.module';
import { PrismaModule } from './shared/prisma/prisma.module';

@Module({
  imports: [CoreModule, PrismaModule, HttpPlatformModule],
})
export class AppModule {}
