export type RateGroup = 'auth' | 'chat' | 'subscriptions' | 'admin' | 'ops';

export const WINDOW_SECONDS = 60;

export const RATE_LIMITS: Readonly<Record<RateGroup, { perIp: number; perUser: number }>> = {
  auth: { perIp: 20, perUser: 10 },
  chat: { perIp: 60, perUser: 20 },
  subscriptions: { perIp: 60, perUser: 30 },
  admin: { perIp: 60, perUser: 60 },
  ops: { perIp: 30, perUser: 30 },
};
