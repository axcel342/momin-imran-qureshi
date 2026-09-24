import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DomainError } from '../../shared/domain/errors';
import type { TokenVerifier, VerifiedToken } from '../domain/ports';

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  email: z.string().optional(),
  is_anonymous: z.boolean().optional(),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })).optional(),
});

@Injectable()
export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.issuer = `${config.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
    const jwksUrl = config.SUPABASE_JWKS_URL ?? `${this.issuer}/.well-known/jwks.json`;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, timeoutDuration: 3_000 });
  }

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.config.SUPABASE_JWT_AUDIENCE,
        algorithms: ['ES256', 'RS256'],
        clockTolerance: 5,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (err) {
      if (err instanceof errors.JWTExpired) throw new DomainError('TOKEN_EXPIRED', 'Access token has expired');
      if (err instanceof errors.JWKSTimeout) throw new DomainError('SERVICE_UNAVAILABLE', 'Identity provider unavailable');
      if (err instanceof errors.JOSEError) throw new DomainError('INVALID_TOKEN', 'Access token is invalid');
      throw new DomainError('SERVICE_UNAVAILABLE', 'Identity provider unavailable');
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success || claims.data.is_anonymous === true) throw new DomainError('INVALID_TOKEN', 'Access token is invalid');
    const times = (claims.data.amr ?? []).map((a) => a.timestamp);
    return {
      userId: claims.data.sub,
      email: claims.data.email ?? '',
      sessionId: claims.data.session_id,
      authenticatedAt: times.length > 0 ? new Date(Math.max(...times) * 1000) : null,
    };
  }
}
