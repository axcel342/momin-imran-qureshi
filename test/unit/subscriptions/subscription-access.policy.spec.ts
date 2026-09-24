import type { Actor } from '../../../src/shared/domain/actor';
import { Subscription } from '../../../src/subscriptions/domain/entities/subscription';
import {
  accessDenied,
  SubscriptionAccessPolicy as P,
} from '../../../src/subscriptions/domain/policies/subscription-access.policy';

const owner: Actor = { userId: 'u1', role: 'USER', sessionId: 's' };
const other: Actor = { userId: 'u2', role: 'USER', sessionId: 's' };
const admin: Actor = { userId: 'a1', role: 'ADMIN', sessionId: 's' };
const sub = Subscription.create({
  id: 'x',
  userId: 'u1',
  tier: 'BASIC',
  billingCycle: 'MONTHLY',
  autoRenew: true,
  paymentSucceeded: true,
  now: new Date(),
});

describe('SubscriptionAccessPolicy', () => {
  it.each([
    ['canView', owner, true],
    ['canView', other, false],
    ['canView', admin, true],
    ['canCancel', owner, true],
    ['canCancel', other, false],
    ['canCancel', admin, true],
    ['canSetAutoRenew', owner, true],
    ['canSetAutoRenew', other, false],
    ['canSetAutoRenew', admin, false],
  ] as const)('%s for %o is %s', (rule, actor, expected) => {
    expect(P[rule](actor, sub)).toBe(expected);
  });

  it('lets only admins list other users', () => {
    expect(P.canListFor(owner, 'u1')).toBe(true);
    expect(P.canListFor(owner, 'u2')).toBe(false);
    expect(P.canListFor(admin, 'u2')).toBe(true);
  });

  it('hides existence from non-admins (404) but tells admins 403', () => {
    expect(accessDenied(other).code).toBe('NOT_FOUND');
    expect(accessDenied(admin).code).toBe('FORBIDDEN');
  });
});
