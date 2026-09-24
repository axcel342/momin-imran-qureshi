import { signRequest, type DeviceKey, type DevicePublicKey } from './signer';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export type Tier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'YEARLY';

export interface Quota {
  source: 'FREE' | 'BUNDLE';
  subscriptionId: string | null;
  freeRemaining: number;
  freeResetsAt: string;
}

export interface AskResponse {
  id: string;
  question: string;
  answer: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  quota: Quota;
  createdAt: string;
}

export interface Subscription {
  id: string;
  tier: Tier;
  billingCycle: BillingCycle;
  maxMessages: number | null;
  usedMessages: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ApiClient {
  accessToken: string;
  key: DeviceKey;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (!res.ok) {
    const failure = (body as ErrorBody | undefined)?.error;
    throw new ApiError(
      res.status,
      failure?.code ?? 'INTERNAL_ERROR',
      failure?.message ?? `Request failed (${res.status})`,
      failure?.details,
    );
  }
  return body as T;
}

async function request<T>(client: ApiClient, method: string, path: string, body?: unknown): Promise<T> {
  const rawBody = body === undefined ? '' : JSON.stringify(body);
  const headers = await signRequest({
    method,
    url: path,
    rawBody,
    token: client.accessToken,
    privateKey: client.key.privateKey,
  });
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: rawBody }),
  });
  return parse<T>(res);
}

export async function registerDeviceKey(
  accessToken: string,
  publicKey: DevicePublicKey,
): Promise<{ bindingId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/auth/device-keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey }),
  });
  return parse<{ bindingId: string }>(res);
}

export const askQuestion = (client: ApiClient, question: string) =>
  request<AskResponse>(client, 'POST', '/v1/chat/messages', { question });

export const listSubscriptions = (client: ApiClient) =>
  request<{ items: Subscription[] }>(client, 'GET', '/v1/subscriptions');

export const createSubscription = (client: ApiClient, tier: Tier, billingCycle: BillingCycle) =>
  request<Subscription>(client, 'POST', '/v1/subscriptions', { tier, billingCycle, autoRenew: true });
