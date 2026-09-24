import { DomainError } from '../../../shared/domain/errors';

export class MonthlyUsage {
  constructor(
    readonly userId: string,
    readonly period: string,
    private _freeUsed: number,
    readonly freeLimit: number,
    private _totalMessages: number,
  ) {}

  static empty(userId: string, period: string, freeLimit: number): MonthlyUsage {
    return new MonthlyUsage(userId, period, 0, freeLimit, 0);
  }

  get freeUsed(): number {
    return this._freeUsed;
  }
  get totalMessages(): number {
    return this._totalMessages;
  }
  get freeRemaining(): number {
    return Math.max(0, this.freeLimit - this._freeUsed);
  }

  hasFreeRemaining(): boolean {
    return this._freeUsed < this.freeLimit;
  }

  consumeFree(): void {
    if (!this.hasFreeRemaining()) throw new DomainError('QUOTA_EXHAUSTED', 'Free monthly quota is exhausted');
    this._freeUsed += 1;
    this._totalMessages += 1;
  }

  recordBundleUse(): void {
    this._totalMessages += 1;
  }
}
