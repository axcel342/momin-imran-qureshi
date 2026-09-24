import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { RunBillingCycleUseCase } from '../application/run-billing-cycle.use-case';

@Injectable()
export class BillingScheduler implements OnModuleInit {
  private readonly logger = new Logger('BillingScheduler');
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: SchedulerRegistry,
    private readonly billing: RunBillingCycleUseCase,
  ) {}

  onModuleInit(): void {
    if (!this.config.BILLING_CRON) return;
    const job = new CronJob(this.config.BILLING_CRON, () => void this.tick());
    this.registry.addCronJob('billing', job);
    job.start();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.billing.execute('scheduler');
      if (summary.processed > 0) this.logger.log({ msg: 'billing cycle complete', ...summary });
    } catch (err) {
      this.logger.error({ msg: 'billing cycle failed', err: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
    }
  }
}
