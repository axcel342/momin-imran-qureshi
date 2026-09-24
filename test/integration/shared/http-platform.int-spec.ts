import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { z } from 'zod';
import { configureApp } from '../../../src/bootstrap';
import { APP_CONFIG, loadConfig } from '../../../src/config/env';
import { CoreModule } from '../../../src/shared/core.module';
import { HttpPlatformModule } from '../../../src/shared/http/http-platform.module';
import { safeText } from '../../../src/shared/http/sanitize';
import { ZodValidationPipe } from '../../../src/shared/http/zod-validation.pipe';

const echoSchema = z.strictObject({ name: safeText(50) });

@Controller('test')
class ProbeController {
  @Post('echo')
  echo(@Body(new ZodValidationPipe(echoSchema)) body: z.infer<typeof echoSchema>) {
    return body;
  }
  @Get('slow')
  async slow() {
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true };
  }
  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}

@Module({ imports: [CoreModule, HttpPlatformModule], controllers: [ProbeController] })
class PlatformTestModule {}

describe('HTTP platform', () => {
  let app: NestExpressApplication;
  let http: import('node:http').Server;

  beforeAll(async () => {
    const config = loadConfig({ ...process.env, REQUEST_TIMEOUT_MS: '200' });
    const moduleRef = await Test.createTestingModule({ imports: [PlatformTestModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApp(app, config);
    await app.init();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('sets secure headers and hides the framework', async () => {
    const res = await request(http).post('/test/echo').send({ name: 'Bob' });
    expect(res.status).toBe(201);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('generates, echoes or replaces X-Request-Id', async () => {
    const generated = await request(http).get('/test/boom');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const id = '11111111-2222-4333-8444-555555555555';
    const echoed = await request(http).get('/test/boom').set('X-Request-Id', id);
    expect(echoed.headers['x-request-id']).toBe(id);
    expect(echoed.body.error.requestId).toBe(id);
    const replaced = await request(http).get('/test/boom').set('X-Request-Id', '<script>');
    expect(replaced.headers['x-request-id']).not.toBe('<script>');
  });

  it('allows only allow-listed CORS origins', async () => {
    const ok = await request(http)
      .options('/test/echo')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
    const bad = await request(http)
      .options('/test/echo')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects bodies over 16kb with 413', async () => {
    const res = await request(http)
      .post('/test/echo')
      .send({ name: 'x'.repeat(17 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects non-JSON content types with 415', async () => {
    const res = await request(http).post('/test/echo').set('Content-Type', 'text/plain').send('name=Bob');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a body on GET and malformed JSON with 400', async () => {
    const withBody = await request(http).get('/test/boom').set('Content-Type', 'application/json').send('{}');
    expect(withBody.status).toBe(400);
    const malformed = await request(http)
      .post('/test/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects unknown fields without echoing submitted values', async () => {
    const res = await request(http).post('/test/echo').send({ name: 'Bob', role: 'ADMIN-SECRET-VALUE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('ADMIN-SECRET-VALUE');
  });

  it('strips markup and rejects control characters', async () => {
    const stripped = await request(http)
      .post('/test/echo')
      .send({ name: '<b>Bob</b><script>alert(1)</script>' });
    expect(stripped.body).toEqual({ name: 'Bob' });
    const control = await request(http).post('/test/echo').send({ name: 'Bo\u0007b' });
    expect(control.status).toBe(400);
  });

  it('times out slow handlers with 504', async () => {
    const res = await request(http).get('/test/slow');
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
  });

  it('hides internal error details and maps unknown routes to NOT_FOUND', async () => {
    const boom = await request(http).get('/test/boom');
    expect(boom.status).toBe(500);
    expect(boom.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: expect.any(String) },
    });
    const missing = await request(http).get('/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
