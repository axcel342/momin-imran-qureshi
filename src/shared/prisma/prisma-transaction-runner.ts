import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TransactionRunner } from '../application/transaction-runner';
import { PrismaService } from './prisma.service';

export type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PrismaTransactionRunner implements TransactionRunner {
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(private readonly prisma: PrismaService) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn();
    return this.prisma.$transaction((tx) => this.als.run(tx, fn), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000,
      timeout: 5000,
    });
  }

  /** The ambient transaction client if inside run(), otherwise the root client. */
  db(): Db {
    return this.als.getStore() ?? this.prisma;
  }
}
