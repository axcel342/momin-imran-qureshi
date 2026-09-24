import { KeyBindingPolicy } from '../../../src/auth/domain/policies/key-binding.policy';

describe('KeyBindingPolicy', () => {
  const policy = new KeyBindingPolicy(300);
  const now = new Date('2026-09-24T12:00:00Z');

  it('allows binding within 300s of authentication', () => {
    expect(() => {
      policy.assertCanBind({ authenticatedAt: new Date('2026-09-24T11:55:01Z'), alreadyBound: false }, now);
    }).not.toThrow();
  });

  it('rejects a second binding for the same session', () => {
    expect(() => {
      policy.assertCanBind({ authenticatedAt: now, alreadyBound: true }, now);
    }).toThrow(expect.objectContaining({ code: 'KEY_ALREADY_BOUND' }));
  });

  it('rejects binding after the window or without an authentication time', () => {
    expect(() => {
      policy.assertCanBind({ authenticatedAt: new Date('2026-09-24T11:54:59Z'), alreadyBound: false }, now);
    }).toThrow(expect.objectContaining({ code: 'KEY_BINDING_WINDOW_CLOSED' }));
    expect(() => {
      policy.assertCanBind({ authenticatedAt: null, alreadyBound: false }, now);
    }).toThrow(expect.objectContaining({ code: 'KEY_BINDING_WINDOW_CLOSED' }));
  });
});
