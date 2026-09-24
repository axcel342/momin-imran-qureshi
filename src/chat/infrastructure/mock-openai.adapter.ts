import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { stripHtml } from '../../shared/http/sanitize';
import type { AiCompletion, AiCompletionPort } from '../domain/ports';
import { estimateTokens } from '../domain/services/token-estimator';

const CANNED = [
  'Here is a concise answer based on general knowledge.',
  'Great question. In short: it depends on context, but the common approach is outlined below.',
  'The key idea is to break the problem into smaller, testable parts.',
  'Short answer: yes, with a few caveats worth checking.',
  'Most practitioners would start with the simplest option and iterate.',
];

/** Mirrors the OpenAI Chat Completions response shape, with simulated latency. */
interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: { index: number; message: { role: 'assistant'; content: string }; finish_reason: 'stop' }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

@Injectable()
export class MockOpenAiAdapter implements AiCompletionPort {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async complete(question: string): Promise<AiCompletion> {
    const started = Date.now();
    const { AI_MOCK_MIN_LATENCY_MS: min, AI_MOCK_MAX_LATENCY_MS: max } = this.config;
    await new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (max - min + 1))));
    const raw = this.fakeOpenAi(question);
    const content = stripHtml(raw.choices[0]?.message.content ?? '');
    return {
      id: raw.id,
      model: raw.model,
      content,
      usage: { promptTokens: raw.usage.prompt_tokens, completionTokens: raw.usage.completion_tokens, totalTokens: raw.usage.total_tokens },
      latencyMs: Date.now() - started,
    };
  }

  private fakeOpenAi(question: string): OpenAiChatCompletion {
    const idx = (createHash('sha256').update(question).digest()[0] ?? 0) % CANNED.length;
    const content = `${CANNED[idx] ?? ''} (mock response to: "${question.slice(0, 80)}")`;
    const prompt = estimateTokens(question);
    const completion = estimateTokens(content);
    return {
      id: `chatcmpl-mock-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    };
  }
}
