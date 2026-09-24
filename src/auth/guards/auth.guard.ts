import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import { AUTH_MODE_KEY, type AuthMode } from '../../shared/http/decorators';
import { SignatureVerifier } from '../domain/services/signature';
import {
  KEY_CRYPTO,
  NONCE_STORE,
  TOKEN_VERIFIER,
  type KeyCrypto,
  type NonceStore,
  type TokenVerifier,
} from '../domain/ports';
import {
  DEVICE_BINDING_REPOSITORY,
  type DeviceBindingRepository,
} from '../repositories/device-binding.repository';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest();
const b64url = (data: string | Buffer) => sha256(data).toString('base64url');
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const TS_RE = /^\d{1,12}$/;
const SIG_RE = /^[A-Za-z0-9_-]{16,256}$/;

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly verifier: SignatureVerifier;

  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokens: TokenVerifier,
    @Inject(DEVICE_BINDING_REPOSITORY) private readonly bindings: DeviceBindingRepository,
    @Inject(NONCE_STORE) private readonly nonces: NonceStore,
    @Inject(KEY_CRYPTO) crypto: KeyCrypto,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.verifier = new SignatureVerifier(crypto, 60);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const mode =
      this.reflector.getAllAndOverride<AuthMode | undefined>(AUTH_MODE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? 'signed';
    const req = ctx.switchToHttp().getRequest<Request>();

    if (mode === 'health-probe') {
      const given = req.header('x-health-token') ?? '';
      if (!timingSafeEqual(sha256(given), sha256(this.config.HEALTH_CHECK_TOKEN))) {
        throw new DomainError('UNAUTHENTICATED', 'Health token required');
      }
      return true;
    }

    const auth = req.header('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(auth);
    if (!match?.[1]) throw new DomainError('UNAUTHENTICATED', 'Bearer token required');
    const token = match[1];
    const verified = await this.tokens.verify(token);
    req.verifiedToken = verified;
    if (mode === 'bearer-only') return true;

    const timestamp = req.header('x-signature-timestamp');
    const nonce = req.header('x-signature-nonce');
    const signature = req.header('x-signature');
    if (
      !timestamp ||
      !nonce ||
      !signature ||
      !TS_RE.test(timestamp) ||
      !NONCE_RE.test(nonce) ||
      !SIG_RE.test(signature)
    ) {
      throw new DomainError('SIGNATURE_REQUIRED', 'Request signature headers are missing or malformed');
    }
    this.verifier.assertFresh(timestamp, this.clock.now());

    const bound = await this.bindings.findBoundSession(verified.sessionId);
    if (!bound || bound.userId !== verified.userId)
      throw new DomainError('KEY_NOT_BOUND', 'No key is bound to this session');

    this.verifier.assertValid(
      {
        method: req.method,
        url: req.originalUrl,
        timestamp,
        nonce,
        bodySha256: b64url(req.rawBody ?? Buffer.alloc(0)),
        tokenSha256: b64url(token),
      },
      signature,
      bound.publicKeyJwk,
    );

    if (!(await this.nonces.claim(verified.sessionId, nonce))) {
      throw new DomainError('REPLAY_DETECTED', 'Nonce has already been used');
    }
    req.actor = { userId: bound.userId, role: bound.role, sessionId: verified.sessionId };
    return true;
  }
}
