import { Global, Module } from '@nestjs/common';
import { TRANSACTION_RUNNER } from '../application/transaction-runner';
import { PrismaService } from './prisma.service';
import { PrismaTransactionRunner } from './prisma-transaction-runner';

@Global()
@Module({
  providers: [PrismaService, PrismaTransactionRunner, { provide: TRANSACTION_RUNNER, useExisting: PrismaTransactionRunner }],
  exports: [PrismaService, PrismaTransactionRunner, TRANSACTION_RUNNER],
})
export class PrismaModule {}
