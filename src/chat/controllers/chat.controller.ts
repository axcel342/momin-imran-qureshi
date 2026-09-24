import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Actor } from '../../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { listQuerySchema, type ListQuery } from '../../shared/http/list-query';
import { safeText } from '../../shared/http/sanitize';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AskQuestionUseCase } from '../application/ask-question.use-case';
import { ListChatsUseCase } from '../application/list-chats.use-case';

const askSchema = z.strictObject({ question: safeText(4000) });

@Controller('v1/chat')
@RateLimitGroup('chat')
@Roles('USER', 'ADMIN')
export class ChatController {
  constructor(
    private readonly askUc: AskQuestionUseCase,
    private readonly listUc: ListChatsUseCase,
  ) {}

  @Post('messages')
  @HttpCode(201)
  async ask(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Body(new ZodValidationPipe(askSchema)) body: z.infer<typeof askSchema>,
  ) {
    const { message: m, quota } = await this.askUc.execute({
      actor,
      question: body.question,
      requestId: req.requestId,
      isCancelled: () => req.timedOut === true,
    });
    return {
      id: m.id,
      question: m.question,
      answer: m.answer,
      model: m.model,
      usage: {
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        totalTokens: m.totalTokens,
      },
      quota,
      createdAt: m.createdAt,
    };
  }

  @Get('messages')
  async list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    return { items: await this.listUc.execute(actor, query) };
  }
}
