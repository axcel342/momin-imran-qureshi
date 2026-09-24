import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import type { PaymentGateway } from '../domain/ports';

@Injectable()
export class SimulatedPaymentGateway implements PaymentGateway {
  private readonly logger = new Logger('SimulatedPaymentGateway');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async charge(input: { subscriptionId: string; userId: string; amountCents: number }): Promise<{ ok: boolean }> {
    await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 80)));
    const ok = Math.random() >= this.config.PAYMENT_FAILURE_RATE;
    this.logger.log({ msg: 'payment simulated', subscriptionId: input.subscriptionId, amountCents: input.amountCents, ok });
    return { ok };
  }
}
