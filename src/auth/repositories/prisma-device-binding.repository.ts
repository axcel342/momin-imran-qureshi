import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../shared/domain/errors';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import type { BoundSession, DeviceBinding } from '../domain/entities/device-binding';
import type { PublicJwk } from '../domain/ports';
import type { DeviceBindingRepository } from './device-binding.repository';

@Injectable()
export class PrismaDeviceBindingRepository implements DeviceBindingRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async findBoundSession(sessionId: string): Promise<BoundSession | null> {
    const row = await this.tx.db().deviceBinding.findUnique({
      where: { sessionId },
      select: { userId: true, publicKeyJwk: true, user: { select: { role: true } } },
    });
    return row
      ? { userId: row.userId, role: row.user.role, publicKeyJwk: row.publicKeyJwk as unknown as PublicJwk }
      : null;
  }

  async existsForSession(sessionId: string): Promise<boolean> {
    return (await this.tx.db().deviceBinding.count({ where: { sessionId } })) > 0;
  }

  async create(b: DeviceBinding): Promise<void> {
    try {
      await this.tx.db().deviceBinding.create({
        data: {
          id: b.id,
          userId: b.userId,
          sessionId: b.sessionId,
          publicKeyJwk: { ...b.publicKeyJwk },
          createdAt: b.createdAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DomainError('KEY_ALREADY_BOUND', 'A key is already bound to this session');
      }
      throw err;
    }
  }
}
