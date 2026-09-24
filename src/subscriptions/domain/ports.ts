export interface PaymentGateway {
  charge(input: { subscriptionId: string; userId: string; amountCents: number }): Promise<{ ok: boolean }>;
}
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
