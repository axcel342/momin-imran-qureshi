import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { KeyCrypto, PublicJwk } from '../domain/ports';

function isP256PublicJwk(key: unknown): key is JsonWebKey {
  if (typeof key !== 'object' || key === null) return false;
  const candidate = key as Record<string, unknown>;
  return (
    candidate.kty === 'EC' &&
    candidate.crv === 'P-256' &&
    typeof candidate.x === 'string' &&
    typeof candidate.y === 'string' &&
    !('d' in candidate)
  );
}

@Injectable()
export class EcdsaKeyCrypto implements KeyCrypto {
  verify(key: PublicJwk, data: string, signatureB64Url: string): boolean {
    if (!isP256PublicJwk(key)) return false;
    try {
      const publicKey = createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      return verify(
        'sha256',
        Buffer.from(data),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signatureB64Url, 'base64url'),
      );
    } catch {
      return false;
    }
  }

  isValidPublicKey(key: PublicJwk): boolean {
    if (!isP256PublicJwk(key)) return false;
    try {
      createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      return true;
    } catch {
      return false;
    }
  }
}
