export const SIGNATURE_VERSION = 'GGI-SIG-V1';

export interface DevicePublicKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface DeviceKey {
  privateKey: CryptoKey;
  publicJwk: DevicePublicKey;
}

export type SignedHeaders = {
  Authorization: string;
  'X-Signature-Timestamp': string;
  'X-Signature-Nonce': string;
  'X-Signature': string;
};

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function sha256b64url(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export async function generateDeviceKey(): Promise<DeviceKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (!exported.x || !exported.y) throw new Error('Could not export the device public key');
  return {
    privateKey: pair.privateKey,
    publicJwk: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y },
  };
}

export async function signRequest(input: {
  method: string;
  url: string;
  rawBody: string;
  token: string;
  privateKey: CryptoKey;
  timestamp?: number;
  nonce?: string;
}): Promise<SignedHeaders> {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const canonical = [
    SIGNATURE_VERSION,
    input.method.toUpperCase(),
    input.url,
    timestamp,
    nonce,
    await sha256b64url(input.rawBody),
    await sha256b64url(input.token),
  ].join('\n');
  const signature = toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        input.privateKey,
        encoder.encode(canonical),
      ),
    ),
  );
  return {
    Authorization: `Bearer ${input.token}`,
    'X-Signature-Timestamp': timestamp,
    'X-Signature-Nonce': nonce,
    'X-Signature': signature,
  };
}
