export class UsagePeriod {
  private constructor(
    readonly value: string,
    private readonly year: number,
    private readonly month: number,
  ) {}

  static fromDate(date: Date): UsagePeriod {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    return new UsagePeriod(`${y}-${String(m + 1).padStart(2, '0')}`, y, m);
  }

  resetsAt(): Date {
    return new Date(Date.UTC(this.year, this.month + 1, 1));
  }
}
