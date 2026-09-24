import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import { KeyBindingPolicy } from '../domain/policies/key-binding.policy';
import { KEY_CRYPTO, type KeyCrypto, type PublicJwk, type VerifiedToken } from '../domain/ports';
import { DEVICE_BINDING_REPOSITORY, type DeviceBindingRepository } from '../repositories/device-binding.repository';
import { USER_REPOSITORY, type UserRepository } from '../repositories/user.repository';

@Injectable()
export class RegisterDeviceKeyUseCase {
  private readonly policy = new KeyBindingPolicy(300);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(DEVICE_BINDING_REPOSITORY) private readonly bindings: DeviceBindingRepository,
    @Inject(KEY_CRYPTO) private readonly crypto: KeyCrypto,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(token: VerifiedToken, publicKey: PublicJwk): Promise<{ bindingId: string }> {
    if (!this.crypto.isValidPublicKey(publicKey)) {
      throw new DomainError('VALIDATION_FAILED', 'publicKey is not a valid P-256 public key');
    }
    const now = this.clock.now();
    const alreadyBound = await this.bindings.existsForSession(token.sessionId);
    this.policy.assertCanBind({ authenticatedAt: token.authenticatedAt, alreadyBound }, now);
    const bindingId = randomUUID();
    await this.tx.run(async () => {
      await this.users.upsert({ id: token.userId, email: token.email });
      await this.bindings.create({ id: bindingId, userId: token.userId, sessionId: token.sessionId, publicKeyJwk: publicKey, createdAt: now });
    });
    return { bindingId };
  }
}
