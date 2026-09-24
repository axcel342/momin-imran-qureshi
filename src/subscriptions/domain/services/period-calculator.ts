import type { BillingCycle } from '../value-objects';

/** Adds calendar months in UTC, clamping to the last day of the target month. */
export function addMonthsUtc(date: Date, months: number): Date {
  const target = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

export const addCycle = (date: Date, cycle: BillingCycle): Date =>
  addMonthsUtc(date, cycle === 'MONTHLY' ? 1 : 12);
