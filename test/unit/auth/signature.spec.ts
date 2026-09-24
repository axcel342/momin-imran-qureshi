import {
  canonicalString,
  SignatureVerifier,
  type SignedRequestParts,
} from '../../../src/auth/domain/services/signature';
import type { KeyCrypto, PublicJwk } from '../../../src/auth/domain/ports';

const key: PublicJwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };
const parts: SignedRequestParts = {
  method: 'post',
  url: '/v1/chat/messages?x=1',
  timestamp: '1790000000',
  nonce: 'nonce-abcdefghijklmnopqrstu',
  bodySha256: 'bodyhash',
  tokenSha256: 'tokenhash',
};
// Fake crypto: a "signature" is valid iff it equals the canonical string reversed.
const fakeCrypto: KeyCrypto = {
  verify: (_k, data, sig) => sig === Array.from(data).reverse().join(''),
  isValidPublicKey: () => true,
};
const now = new Date(1790000000 * 1000);

describe('canonicalString', () => {
  it('joins the version, upper-cased method and all parts with newlines', () => {
    expect(canonicalString(parts)).toBe(
      'GGI-SIG-V1\nPOST\n/v1/chat/messages?x=1\n1790000000\nnonce-abcdefghijklmnopqrstu\nbodyhash\ntokenhash',
    );
  });
});

describe('SignatureVerifier', () => {
  const verifier = new SignatureVerifier(fakeCrypto, 60);

  it('accepts timestamps within ±60s', () => {
    expect(() => {
      verifier.assertFresh('1790000060', now);
    }).not.toThrow();
    expect(() => {
      verifier.assertFresh('1789999940', now);
    }).not.toThrow();
  });

  it('rejects stale timestamps', () => {
    expect(() => {
      verifier.assertFresh('1789999939', now);
    }).toThrow(expect.objectContaining({ code: 'REQUEST_EXPIRED' }));
  });

  it('rejects timestamps from a client clock running ahead (Review Focus #2)', () => {
    expect(() => {
      verifier.assertFresh('1790000120', now);
    }).toThrow(expect.objectContaining({ code: 'REQUEST_EXPIRED' }));
  });

  it('rejects non-integer timestamps as a missing signature', () => {
    expect(() => {
      verifier.assertFresh('17900.5', now);
    }).toThrow(expect.objectContaining({ code: 'SIGNATURE_REQUIRED' }));
  });

  it('accepts a valid signature and rejects any tampered part', () => {
    const good = Array.from(canonicalString(parts)).reverse().join('');
    expect(() => {
      verifier.assertValid(parts, good, key);
    }).not.toThrow();
    for (const field of Object.keys(parts) as (keyof SignedRequestParts)[]) {
      const tampered = { ...parts, [field]: `${parts[field]}!` };
      expect(() => {
        verifier.assertValid(tampered, good, key);
      }).toThrow(expect.objectContaining({ code: 'INVALID_SIGNATURE' }));
    }
  });
});
