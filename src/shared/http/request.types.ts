import type { Actor } from '../domain/actor';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      rawBody?: Buffer;
      actor?: Actor;
      verifiedToken?: unknown;
      timedOut?: boolean;
    }
  }
}

export {};
