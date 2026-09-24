import { DomainError } from '../../../shared/domain/errors';
import type { KeyCrypto, PublicJwk } from '../ports';

export const SIGNATURE_VERSION = 'GGI-SIG-V1';

export interface SignedRequestParts {
  method: string;
  url: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
  tokenSha256: string;
}

export function canonicalString(p: SignedRequestParts): string {
  return [SIGNATURE_VERSION, p.method.toUpperCase(), p.url, p.timestamp, p.nonce, p.bodySha256, p.tokenSha256].join('\n');
}

export class SignatureVerifier {
  constructor(
    private readonly crypto: KeyCrypto,
    private readonly maxSkewSeconds = 60,
  ) {}

  assertFresh(timestamp: string, now: Date): void {
    const ts = Number(timestamp);
    if (!Number.isSafeInteger(ts)) throw new DomainError('SIGNATURE_REQUIRED', 'Signature timestamp is malformed');
    if (Math.abs(now.getTime() / 1000 - ts) > this.maxSkewSeconds) {
      throw new DomainError('REQUEST_EXPIRED', 'Request timestamp is outside the allowed window');
    }
  }

  assertValid(parts: SignedRequestParts, signature: string, key: PublicJwk): void {
    if (!this.crypto.verify(key, canonicalString(parts), signature)) {
      throw new DomainError('INVALID_SIGNATURE', 'Request signature is invalid');
    }
  }
}
