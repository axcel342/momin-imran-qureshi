import { addCycle, addMonthsUtc } from '../../../src/subscriptions/domain/services/period-calculator';

describe('period calculator (UTC, end-of-month clamping)', () => {
  it('adds a month keeping the time of day', () => {
    expect(addMonthsUtc(new Date('2026-09-24T10:30:00Z'), 1).toISOString()).toBe('2026-10-24T10:30:00.000Z');
  });
  it('clamps Jan 31 to the last day of February', () => {
    expect(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsUtc(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
  it('rolls over the year for December and for yearly cycles', () => {
    expect(addCycle(new Date('2026-12-15T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
    expect(addCycle(new Date('2028-02-29T00:00:00Z'), 'YEARLY').toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });
});
