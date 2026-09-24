import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../shared/http/decorators';
import { GetMetricsUseCase } from './get-metrics.use-case';

@Controller('v1/admin/metrics')
@RateLimitGroup('admin')
@Roles('ADMIN')
export class MetricsController {
  constructor(private readonly metrics: GetMetricsUseCase) {}

  @Get()
  get(@CurrentActor() actor: Actor) {
    return this.metrics.execute(actor);
  }
}
