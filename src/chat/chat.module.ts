import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions';
import { AskQuestionUseCase } from './application/ask-question.use-case';
import { ListChatsUseCase } from './application/list-chats.use-case';
import { ChatController } from './controllers/chat.controller';
import { AI_COMPLETION } from './domain/ports';
import { MockOpenAiAdapter } from './infrastructure/mock-openai.adapter';
import { CHAT_MESSAGE_REPOSITORY } from './repositories/chat-message.repository';
import { MONTHLY_USAGE_REPOSITORY } from './repositories/monthly-usage.repository';
import { PrismaChatMessageRepository } from './repositories/prisma-chat-message.repository';
import { PrismaMonthlyUsageRepository } from './repositories/prisma-monthly-usage.repository';

@Module({
  imports: [SubscriptionsModule],
  controllers: [ChatController],
  providers: [
    AskQuestionUseCase,
    ListChatsUseCase,
    { provide: AI_COMPLETION, useClass: MockOpenAiAdapter },
    { provide: MONTHLY_USAGE_REPOSITORY, useClass: PrismaMonthlyUsageRepository },
    { provide: CHAT_MESSAGE_REPOSITORY, useClass: PrismaChatMessageRepository },
  ],
})
export class ChatModule {}
