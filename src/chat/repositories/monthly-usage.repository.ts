import type { MonthlyUsage } from '../domain/entities/monthly-usage';

export interface MonthlyUsageRepository {
  find(userId: string, period: string): Promise<MonthlyUsage | null>;
  /** INSERT … ON CONFLICT DO NOTHING, then SELECT … FOR UPDATE. Call inside a transaction. */
  lockOrCreate(userId: string, period: string, freeLimit: number): Promise<MonthlyUsage>;
  save(usage: MonthlyUsage): Promise<void>;
}
export const MONTHLY_USAGE_REPOSITORY = Symbol('MONTHLY_USAGE_REPOSITORY');
