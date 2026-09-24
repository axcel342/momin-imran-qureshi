export type QuotaSource = 'FREE' | 'BUNDLE';

export interface ChatMessageRecord {
  id: string;
  userId: string;
  question: string;
  answer: string;
  quotaSource: QuotaSource;
  subscriptionId: string | null;
  period: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  requestId: string;
  createdAt: Date;
}
