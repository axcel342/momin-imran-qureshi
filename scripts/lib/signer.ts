import { createHash, randomBytes, sign, type KeyObject } from 'node:crypto';
import { canonicalString } from '../../src/auth/domain/services/signature';

export const sha256b64url = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('base64url');

export function signRequest(input: {
  method: string;
  url: string;
  rawBody: string;
  token: string;
  privateKey: KeyObject;
  timestamp?: number;
  nonce?: string;
}): Record<string, string> {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString('base64url');
  const data = canonicalString({
    method: input.method,
    url: input.url,
    timestamp,
    nonce,
    bodySha256: sha256b64url(input.rawBody),
    tokenSha256: sha256b64url(input.token),
  });
  const signature = sign('sha256', Buffer.from(data), {
    key: input.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    Authorization: `Bearer ${input.token}`,
    'X-Signature-Timestamp': timestamp,
    'X-Signature-Nonce': nonce,
    'X-Signature': signature,
  };
}
