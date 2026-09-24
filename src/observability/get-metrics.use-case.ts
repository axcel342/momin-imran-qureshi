import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../shared/domain/actor';
import { assertAdmin } from '../shared/domain/admin-policy';
import { CLOCK, type Clock } from '../shared/domain/clock';
import { MetricsQuery, type Metrics } from './metrics.query';

@Injectable()
export class GetMetricsUseCase {
  constructor(
    private readonly query: MetricsQuery,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(actor: Actor): Promise<Metrics> {
    assertAdmin(actor); // domain-level check in addition to @Roles('ADMIN')
    return this.query.collect(this.clock.now());
  }
}
