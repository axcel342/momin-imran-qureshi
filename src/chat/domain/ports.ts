export interface BundleSnapshot {
  id: string;
  remaining: number | null; // null = unlimited
  createdAt: Date;
  startDate: Date;
  endDate: Date;
}

export interface BundleQuotaPort {
  /** Non-locking read of the user's usable bundles (pre-check). */
  peekUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]>;
  /** Locks the user's active bundles (FOR UPDATE, id order) and returns the usable ones. */
  lockUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]>;
  consume(subscriptionId: string, now: Date): Promise<void>;
}
export const BUNDLE_QUOTA = Symbol('BUNDLE_QUOTA');

export interface AiCompletion {
  id: string;
  model: string;
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}

export interface AiCompletionPort {
  complete(question: string): Promise<AiCompletion>;
}
export const AI_COMPLETION = Symbol('AI_COMPLETION');
