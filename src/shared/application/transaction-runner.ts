export interface TransactionRunner {
  run<T>(fn: () => Promise<T>): Promise<T>;
}
export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');
