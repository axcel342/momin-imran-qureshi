import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './exception.filter';
import { TimeoutInterceptor } from './timeout.interceptor';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
  ],
})
export class HttpPlatformModule {}
