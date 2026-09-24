import { Injectable } from '@nestjs/common';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import type { ChatMessageRecord } from '../domain/entities/chat-message';
import type { ChatMessageRepository } from './chat-message.repository';

@Injectable()
export class PrismaChatMessageRepository implements ChatMessageRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async create(record: ChatMessageRecord): Promise<void> {
    await this.tx.db().chatMessage.create({ data: { ...record } });
  }

  listByUser(userId: string, limit: number): Promise<ChatMessageRecord[]> {
    return this.tx.db().chatMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
  }
}
