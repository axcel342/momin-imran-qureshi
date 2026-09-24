import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import type { Actor } from '../../shared/domain/actor';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import type { ChatMessageRecord, QuotaSource } from '../domain/entities/chat-message';
import { MonthlyUsage } from '../domain/entities/monthly-usage';
import { AI_COMPLETION, BUNDLE_QUOTA, type AiCompletionPort, type BundleQuotaPort } from '../domain/ports';
import { QuotaAllocator } from '../domain/services/quota-allocator';
import { UsagePeriod } from '../domain/services/usage-period';
import { CHAT_MESSAGE_REPOSITORY, type ChatMessageRepository } from '../repositories/chat-message.repository';
import { MONTHLY_USAGE_REPOSITORY, type MonthlyUsageRepository } from '../repositories/monthly-usage.repository';

export interface AskResult {
  message: ChatMessageRecord;
  quota: { source: QuotaSource; subscriptionId: string | null; freeRemaining: number; freeResetsAt: Date };
}

@Injectable()
export class AskQuestionUseCase {
  private readonly allocator = new QuotaAllocator();

  constructor(
    @Inject(MONTHLY_USAGE_REPOSITORY) private readonly usage: MonthlyUsageRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY) private readonly messages: ChatMessageRepository,
    @Inject(BUNDLE_QUOTA) private readonly bundles: BundleQuotaPort,
    @Inject(AI_COMPLETION) private readonly ai: AiCompletionPort,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(input: { actor: Actor; question: string; requestId: string; isCancelled: () => boolean }): Promise<AskResult> {
    const userId = input.actor.userId;
    const freeLimit = this.config.FREE_MESSAGES_PER_MONTH;

    // 1. Cheap, non-locking pre-check: don't spend an AI call on a user with no quota.
    const checkNow = this.clock.now();
    const period = UsagePeriod.fromDate(checkNow).value;
    const snapshot = (await this.usage.find(userId, period)) ?? MonthlyUsage.empty(userId, period, freeLimit);
    if (!snapshot.hasFreeRemaining()) {
      this.allocator.allocate({ usage: snapshot, bundles: await this.bundles.peekUsableBundles(userId, checkNow), now: checkNow });
    }

    // 2. Mock AI call: outside any transaction, no locks held.
    const completion = await this.ai.complete(input.question);
    if (input.isCancelled()) throw new DomainError('REQUEST_TIMEOUT', 'Request timed out');

    // 3. Authoritative, atomic deduction. Lock order: monthly_usage, then subscriptions by id.
    return this.tx.run(async () => {
      const now = this.clock.now();
      const p = UsagePeriod.fromDate(now);
      const usage = await this.usage.lockOrCreate(userId, p.value, freeLimit);
      const bundles = usage.hasFreeRemaining() ? [] : await this.bundles.lockUsableBundles(userId, now);
      const allocation = this.allocator.allocate({ usage, bundles, now });
      if (allocation.source === 'FREE') {
        usage.consumeFree();
      } else {
        await this.bundles.consume(allocation.subscriptionId, now);
        usage.recordBundleUse();
      }
      await this.usage.save(usage);
      const message: ChatMessageRecord = {
        id: randomUUID(),
        userId,
        question: input.question,
        answer: completion.content,
        quotaSource: allocation.source,
        subscriptionId: allocation.source === 'BUNDLE' ? allocation.subscriptionId : null,
        period: p.value,
        model: completion.model,
        promptTokens: completion.usage.promptTokens,
        completionTokens: completion.usage.completionTokens,
        totalTokens: completion.usage.totalTokens,
        latencyMs: completion.latencyMs,
        requestId: input.requestId,
        createdAt: now,
      };
      await this.messages.create(message);
      return {
        message,
        quota: { source: allocation.source, subscriptionId: message.subscriptionId, freeRemaining: usage.freeRemaining, freeResetsAt: p.resetsAt() },
      };
    });
  }
}
