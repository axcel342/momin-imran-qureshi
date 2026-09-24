import type { PaymentGateway } from '../../src/subscriptions/domain/ports';

export class FakePaymentGateway implements PaymentGateway {
  private queue: boolean[] = [];
  calls = 0;

  failNext(times = 1): void {
    for (let i = 0; i < times; i++) this.queue.push(false);
  }

  reset(): void {
    this.queue = [];
    this.calls = 0;
  }

  charge(): Promise<{ ok: boolean }> {
    this.calls++;
    return Promise.resolve({ ok: this.queue.shift() ?? true });
  }
}
