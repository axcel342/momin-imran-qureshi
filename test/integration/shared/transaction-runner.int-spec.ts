import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../src/config/env';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { PrismaTransactionRunner } from '../../../src/shared/prisma/prisma-transaction-runner';

describe('PrismaTransactionRunner', () => {
  const prisma = new PrismaService(loadConfig(process.env));
  const runner = new PrismaTransactionRunner(prisma);

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('exposes the ambient transaction client inside run() and the root client outside', async () => {
    expect(runner.db()).toBe(prisma);
    await runner.run(() => {
      expect(runner.db()).not.toBe(prisma);
      return Promise.resolve();
    });
  });

  it('rolls back every write when the callback throws', async () => {
    const id = randomUUID();
    await expect(
      runner.run(async () => {
        await runner.db().user.create({ data: { id, email: 'rollback@example.com' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });

  it('joins an outer transaction instead of nesting', async () => {
    const id = randomUUID();
    await expect(
      runner.run(async () => {
        await runner.run(async () => {
          await runner.db().user.create({ data: { id, email: 'nested@example.com' } });
        });
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });
});
