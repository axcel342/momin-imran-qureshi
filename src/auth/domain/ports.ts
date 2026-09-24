export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface VerifiedToken {
  userId: string;
  email: string;
  sessionId: string;
  /** Latest `amr[].timestamp`: when the user actually authenticated. */
  authenticatedAt: Date | null;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface KeyCrypto {
  verify(key: PublicJwk, data: string, signatureB64Url: string): boolean;
  isValidPublicKey(key: PublicJwk): boolean;
}
export const KEY_CRYPTO = Symbol('KEY_CRYPTO');

export interface NonceStore {
  /** Returns true if the nonce was unused (and is now consumed). */
  claim(sessionId: string, nonce: string): Promise<boolean>;
}
export const NONCE_STORE = Symbol('NONCE_STORE');
