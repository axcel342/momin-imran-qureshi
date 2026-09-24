import { Controller, HttpCode, Post } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { RunBillingCycleUseCase } from '../application/run-billing-cycle.use-case';

@Controller('v1/admin/billing')
@RateLimitGroup('admin')
@Roles('ADMIN')
export class AdminBillingController {
  constructor(private readonly billing: RunBillingCycleUseCase) {}

  @Post('run')
  @HttpCode(200)
  run(@CurrentActor() actor: Actor) {
    return this.billing.execute(actor);
  }
}
