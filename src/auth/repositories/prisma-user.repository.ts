import { Injectable } from '@nestjs/common';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import type { UserRecord, UserRepository } from './user.repository';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async upsert(user: { id: string; email: string }): Promise<void> {
    await this.tx.db().user.upsert({ where: { id: user.id }, create: user, update: { email: user.email } });
  }

  findById(id: string): Promise<UserRecord | null> {
    return this.tx.db().user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  }
}
