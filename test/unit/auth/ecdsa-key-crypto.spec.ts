import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { EcdsaKeyCrypto } from '../../../src/auth/infrastructure/ecdsa-key-crypto';
import type { PublicJwk } from '../../../src/auth/domain/ports';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } as PublicJwk };
}

describe('EcdsaKeyCrypto', () => {
  const crypto = new EcdsaKeyCrypto();

  it('verifies an IEEE-P1363 P-256 signature and rejects a different key or data', () => {
    const a = keyPair();
    const b = keyPair();
    const sig = sign('sha256', Buffer.from('hello'), { key: a.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(crypto.verify(a.jwk, 'hello', sig)).toBe(true);
    expect(crypto.verify(a.jwk, 'hellO', sig)).toBe(false);
    expect(crypto.verify(b.jwk, 'hello', sig)).toBe(false);
    expect(crypto.verify(a.jwk, 'hello', 'not-a-signature')).toBe(false);
  });

  it('accepts real P-256 public keys and rejects off-curve points (Review Focus #5)', () => {
    expect(crypto.isValidPublicKey(keyPair().jwk)).toBe(true);
    const offCurve: PublicJwk = { kty: 'EC', crv: 'P-256', x: randomBytes(32).toString('base64url'), y: randomBytes(32).toString('base64url') };
    expect(crypto.isValidPublicKey(offCurve)).toBe(false);
  });
});
