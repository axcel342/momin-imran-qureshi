import type { ChatMessageRecord } from '../domain/entities/chat-message';

export interface ChatMessageRepository {
  create(record: ChatMessageRecord): Promise<void>;
  listByUser(userId: string, limit: number): Promise<ChatMessageRecord[]>;
}
export const CHAT_MESSAGE_REPOSITORY = Symbol('CHAT_MESSAGE_REPOSITORY');
