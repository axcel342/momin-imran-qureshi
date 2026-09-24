import type { VerifiedToken } from '../../auth/domain/ports';
import type { Actor } from '../domain/actor';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      rawBody?: Buffer;
      actor?: Actor;
      verifiedToken?: VerifiedToken;
      timedOut?: boolean;
    }
  }
}

export {};
