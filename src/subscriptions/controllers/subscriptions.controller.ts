import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { listQuerySchema, type ListQuery } from '../../shared/http/list-query';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { CancelSubscriptionUseCase } from '../application/cancel-subscription.use-case';
import { CreateSubscriptionUseCase } from '../application/create-subscription.use-case';
import { ListSubscriptionsUseCase } from '../application/list-subscriptions.use-case';
import { SetAutoRenewUseCase } from '../application/set-auto-renew.use-case';
import { BILLING_CYCLES, TIERS } from '../domain/value-objects';

const createSchema = z.strictObject({ tier: z.enum(TIERS), billingCycle: z.enum(BILLING_CYCLES), autoRenew: z.boolean() });
const patchSchema = z.strictObject({ autoRenew: z.boolean() });
const idPipe = new ZodValidationPipe(z.uuid());

@Controller('v1/subscriptions')
@RateLimitGroup('subscriptions')
@Roles('USER', 'ADMIN')
export class SubscriptionsController {
  constructor(
    private readonly createUc: CreateSubscriptionUseCase,
    private readonly listUc: ListSubscriptionsUseCase,
    private readonly autoRenewUc: SetAutoRenewUseCase,
    private readonly cancelUc: CancelSubscriptionUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.createUc.execute(actor, body);
  }

  @Get()
  async list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    return { items: await this.listUc.execute(actor, query) };
  }

  @Patch(':id')
  setAutoRenew(@CurrentActor() actor: Actor, @Param('id', idPipe) id: string, @Body(new ZodValidationPipe(patchSchema)) body: z.infer<typeof patchSchema>) {
    return this.autoRenewUc.execute(actor, id, body.autoRenew);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', idPipe) id: string) {
    return this.cancelUc.execute(actor, id);
  }
}
