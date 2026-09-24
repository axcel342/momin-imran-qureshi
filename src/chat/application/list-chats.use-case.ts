import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import type { ChatMessageRecord } from '../domain/entities/chat-message';
import { ChatAccessPolicy } from '../domain/policies/chat-access.policy';
import { CHAT_MESSAGE_REPOSITORY, type ChatMessageRepository } from '../repositories/chat-message.repository';

@Injectable()
export class ListChatsUseCase {
  constructor(@Inject(CHAT_MESSAGE_REPOSITORY) private readonly messages: ChatMessageRepository) {}

  execute(actor: Actor, query: { userId?: string | undefined; limit: number }): Promise<ChatMessageRecord[]> {
    const target = query.userId ?? actor.userId;
    if (!ChatAccessPolicy.canListFor(actor, target)) throw new DomainError('FORBIDDEN', 'Cannot list another user’s chats');
    return this.messages.listByUser(target, query.limit);
  }
}
