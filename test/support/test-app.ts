import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pino from 'pino';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../src/config/env';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { PAYMENT_GATEWAY } from '../../src/subscriptions/domain/ports';
import { FakePaymentGateway } from './fake-payment-gateway';
import { MockIdp } from './mock-idp';

export interface TestContext {
  app: NestExpressApplication;
  http: Server;
  prisma: PrismaService;
  redis: RedisService;
  idp: MockIdp;
  config: AppConfig;
  payments: FakePaymentGateway;
}

export async function createTestApp(opts: { env?: Record<string, string>; logStream?: pino.DestinationStream } = {}): Promise<TestContext> {
  const idp = await MockIdp.start();
  const config = loadConfig({ ...process.env, SUPABASE_JWKS_URL: idp.jwksUrl, ...opts.env });
  const payments = new FakePaymentGateway();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(payments)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, config, opts.logStream ? { logStream: opts.logStream } : {});
  await app.init();
  return { app, http: app.getHttpServer(), prisma: app.get(PrismaService), redis: app.get(RedisService), idp, config, payments };
}

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRaw`TRUNCATE chat_messages, monthly_usage, subscriptions, device_bindings, users CASCADE`;
  await ctx.redis.client.flushdb();
  ctx.payments.reset();
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.idp.stop();
}
