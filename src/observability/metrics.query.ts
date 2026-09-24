import { Injectable } from '@nestjs/common';
import { UsagePeriod } from '../chat';
import { PrismaService } from '../shared/prisma/prisma.service';

export interface Metrics {
  users: number;
  chat: { period: string; messagesThisMonth: number; free: number; bundle: number; tokensThisMonth: number };
  subscriptions: {
    activeByTier: { BASIC: number; PRO: number; ENTERPRISE: number };
    inactiveByReason: { CANCELLED: number; PAYMENT_FAILED: number; EXPIRED: number };
  };
}

@Injectable()
export class MetricsQuery {
  constructor(private readonly prisma: PrismaService) {}

  async collect(now: Date): Promise<Metrics> {
    const period = UsagePeriod.fromDate(now).value;
    const [users, chat, active, inactive] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.chatMessage.groupBy({ by: ['quotaSource'], where: { period }, _count: { _all: true }, _sum: { totalTokens: true } }),
      this.prisma.subscription.groupBy({ by: ['tier'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.subscription.groupBy({ by: ['inactiveReason'], where: { status: 'INACTIVE' }, _count: { _all: true } }),
    ]);
    const bySource = (s: 'FREE' | 'BUNDLE') => chat.find((c) => c.quotaSource === s);
    const activeByTier = { BASIC: 0, PRO: 0, ENTERPRISE: 0 };
    for (const a of active) activeByTier[a.tier] = a._count._all;
    const inactiveByReason = { CANCELLED: 0, PAYMENT_FAILED: 0, EXPIRED: 0 };
    for (const i of inactive) if (i.inactiveReason) inactiveByReason[i.inactiveReason] = i._count._all;
    const free = bySource('FREE')?._count._all ?? 0;
    const bundle = bySource('BUNDLE')?._count._all ?? 0;
    return {
      users,
      chat: {
        period,
        messagesThisMonth: free + bundle,
        free,
        bundle,
        tokensThisMonth: chat.reduce((n, c) => n + (c._sum.totalTokens ?? 0), 0),
      },
      subscriptions: { activeByTier, inactiveByReason },
    };
  }
}
