import { UsagePeriod } from '../../../src/chat/domain/services/usage-period';

describe('UsagePeriod (UTC calendar month)', () => {
  it('formats YYYY-MM and resets on the 1st of the next month', () => {
    const p = UsagePeriod.fromDate(new Date('2026-09-30T23:59:59.999Z'));
    expect(p.value).toBe('2026-09');
    expect(p.resetsAt().toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('switches period exactly at midnight UTC on the 1st', () => {
    expect(UsagePeriod.fromDate(new Date('2026-10-01T00:00:00.000Z')).value).toBe('2026-10');
  });
  it('rolls over the year in December', () => {
    const p = UsagePeriod.fromDate(new Date('2026-12-15T00:00:00Z'));
    expect(p.value).toBe('2026-12');
    expect(p.resetsAt().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
