import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestContext } from '../../support/test-app';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

describe('Default deny: no open or bypassable endpoints', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  function routes(): { method: string; path: string }[] {
    const instance = ctx.app.getHttpAdapter().getInstance() as { router: { stack: Layer[] } };
    return instance.router.stack
      .filter((l): l is Required<Layer> => l.route !== undefined)
      .flatMap((l) =>
        Object.keys(l.route.methods).map((m) => ({
          method: m,
          path: l.route.path.replace(':id', randomUUID()),
        })),
      );
  }

  it('discovers all application routes', () => {
    expect(routes().length).toBeGreaterThanOrEqual(11);
  });

  it('rejects every route without credentials with 401', async () => {
    for (const { method, path } of routes()) {
      const res = await (request(ctx.http) as unknown as Record<string, (p: string) => request.Test>)[
        method
      ]!(path);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
    }
  });

  it('rejects every signed route when only a bearer token is presented', async () => {
    const token = await ctx.idp.token();
    for (const { method, path } of routes().filter(
      (r) => r.path !== '/v1/auth/device-keys' && r.path !== '/health',
    )) {
      const res = await (request(ctx.http) as unknown as Record<string, (p: string) => request.Test>)[
        method
      ]!(path).set('Authorization', `Bearer ${token}`);
      expect({ method, path, code: res.body?.error?.code }).toEqual({
        method,
        path,
        code: 'SIGNATURE_REQUIRED',
      });
    }
  });
});
