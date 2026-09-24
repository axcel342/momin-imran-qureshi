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

  it('rejects JWKs carrying private key material, even with a matching signature (Review Focus #5)', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = privateKey.export({ format: 'jwk' });
    const withD = { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y!, d: jwk.d! } as PublicJwk;
    const sig = sign('sha256', Buffer.from('hello'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(crypto.isValidPublicKey(withD)).toBe(false);
    expect(crypto.verify(withD, 'hello', sig)).toBe(false);
  });

  it('rejects non-EC and non-P-256 keys in both isValidPublicKey and verify (Review Focus #5)', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaJwk = rsa.publicKey.export({ format: 'jwk' }) as unknown as PublicJwk;
    const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' });
    const p384Jwk = p384.publicKey.export({ format: 'jwk' }) as unknown as PublicJwk;

    expect(crypto.isValidPublicKey(rsaJwk)).toBe(false);
    expect(crypto.isValidPublicKey(p384Jwk)).toBe(false);

    const rsaSig = sign('sha256', Buffer.from('hello'), rsa.privateKey).toString('base64url');
    const p384Sig = sign('sha256', Buffer.from('hello'), { key: p384.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(crypto.verify(rsaJwk, 'hello', rsaSig)).toBe(false);
    expect(crypto.verify(p384Jwk, 'hello', p384Sig)).toBe(false);
  });
});
