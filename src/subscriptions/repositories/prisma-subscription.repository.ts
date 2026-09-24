import { Injectable } from '@nestjs/common';
import type { Subscription as Row } from '@prisma/client';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import { Subscription } from '../domain/entities/subscription';
import type { SubscriptionRepository } from './subscription.repository';

const toDomain = (r: Row): Subscription =>
  Subscription.restore({
    id: r.id,
    userId: r.userId,
    tier: r.tier,
    billingCycle: r.billingCycle,
    maxMessages: r.maxMessages,
    usedMessages: r.usedMessages,
    priceCents: r.priceCents,
    autoRenew: r.autoRenew,
    status: r.status,
    inactiveReason: r.inactiveReason,
    startDate: r.startDate,
    endDate: r.endDate,
    renewalDate: r.renewalDate,
    cancelledAt: r.cancelledAt,
    createdAt: r.createdAt,
  });

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async findById(id: string): Promise<Subscription | null> {
    const row = await this.tx.db().subscription.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async lockById(id: string): Promise<Subscription | null> {
    await this.tx.db().$queryRaw`SELECT id FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
    return this.findById(id);
  }

  async listByUser(userId: string, limit: number): Promise<Subscription[]> {
    const rows = await this.tx.db().subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toDomain);
  }

  async listActiveForUser(userId: string): Promise<Subscription[]> {
    const rows = await this.tx.db().subscription.findMany({ where: { userId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }

  async lockActiveForUser(userId: string): Promise<Subscription[]> {
    const locked = await this.tx.db().$queryRaw<{ id: string }[]>`
      SELECT id FROM subscriptions WHERE user_id = ${userId}::uuid AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
    return this.byIds(locked.map((r) => r.id));
  }

  async lockDueForRenewal(now: Date, limit: number): Promise<Subscription[]> {
    const locked = await this.tx.db().$queryRaw<{ id: string }[]>`
      SELECT id FROM subscriptions
      WHERE status = 'ACTIVE' AND renewal_date <= ${now}
      ORDER BY renewal_date LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    return this.byIds(locked.map((r) => r.id));
  }

  async save(sub: Subscription): Promise<void> {
    const s = sub.toSnapshot();
    const { id, userId, createdAt, ...mutable } = s;
    await this.tx.db().subscription.upsert({ where: { id }, create: { id, userId, createdAt, ...mutable }, update: mutable });
  }

  private async byIds(ids: string[]): Promise<Subscription[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.db().subscription.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }
}
