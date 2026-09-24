import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { KeyCrypto, PublicJwk } from '../domain/ports';

@Injectable()
export class EcdsaKeyCrypto implements KeyCrypto {
  verify(key: PublicJwk, data: string, signatureB64Url: string): boolean {
    try {
      const publicKey = createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      return verify('sha256', Buffer.from(data), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatureB64Url, 'base64url'));
    } catch {
      return false;
    }
  }

  isValidPublicKey(key: PublicJwk): boolean {
    try {
      createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      return true;
    } catch {
      return false;
    }
  }
}
