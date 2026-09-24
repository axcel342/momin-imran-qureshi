import { Injectable } from '@nestjs/common';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import { MonthlyUsage } from '../domain/entities/monthly-usage';
import type { MonthlyUsageRepository } from './monthly-usage.repository';

interface Row {
  user_id: string;
  period: string;
  free_used: number;
  free_limit: number;
  total_messages: number;
}

@Injectable()
export class PrismaMonthlyUsageRepository implements MonthlyUsageRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async find(userId: string, period: string): Promise<MonthlyUsage | null> {
    const r = await this.tx.db().monthlyUsage.findUnique({ where: { userId_period: { userId, period } } });
    return r ? new MonthlyUsage(r.userId, r.period, r.freeUsed, r.freeLimit, r.totalMessages) : null;
  }

  async lockOrCreate(userId: string, period: string, freeLimit: number): Promise<MonthlyUsage> {
    const db = this.tx.db();
    await db.$executeRaw`
      INSERT INTO monthly_usage (user_id, period, free_used, free_limit, total_messages)
      VALUES (${userId}::uuid, ${period}, 0, ${freeLimit}, 0)
      ON CONFLICT (user_id, period) DO NOTHING`;
    const rows = await db.$queryRaw<Row[]>`
      SELECT user_id, period, free_used, free_limit, total_messages
      FROM monthly_usage WHERE user_id = ${userId}::uuid AND period = ${period} FOR UPDATE`;
    const r = rows[0];
    if (!r) throw new Error('monthly_usage row missing after upsert');
    return new MonthlyUsage(r.user_id, r.period, r.free_used, r.free_limit, r.total_messages);
  }

  async save(usage: MonthlyUsage): Promise<void> {
    await this.tx.db().monthlyUsage.update({
      where: { userId_period: { userId: usage.userId, period: usage.period } },
      data: { freeUsed: usage.freeUsed, totalMessages: usage.totalMessages },
    });
  }
}
