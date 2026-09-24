import { Module } from '@nestjs/common';
import { CancelSubscriptionUseCase } from './application/cancel-subscription.use-case';
import { CreateSubscriptionUseCase } from './application/create-subscription.use-case';
import { ListSubscriptionsUseCase } from './application/list-subscriptions.use-case';
import { SetAutoRenewUseCase } from './application/set-auto-renew.use-case';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { PAYMENT_GATEWAY } from './domain/ports';
import { SimulatedPaymentGateway } from './infrastructure/simulated-payment-gateway';
import { PrismaSubscriptionRepository } from './repositories/prisma-subscription.repository';
import { SUBSCRIPTION_REPOSITORY } from './repositories/subscription.repository';

@Module({
  controllers: [SubscriptionsController],
  providers: [
    CreateSubscriptionUseCase,
    ListSubscriptionsUseCase,
    SetAutoRenewUseCase,
    CancelSubscriptionUseCase,
    { provide: SUBSCRIPTION_REPOSITORY, useClass: PrismaSubscriptionRepository },
    { provide: PAYMENT_GATEWAY, useClass: SimulatedPaymentGateway },
  ],
  exports: [SUBSCRIPTION_REPOSITORY, PAYMENT_GATEWAY],
})
export class SubscriptionsModule {}
