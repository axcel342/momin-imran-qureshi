import { ChatAccessPolicy } from '../../../src/chat/domain/policies/chat-access.policy';

describe('ChatAccessPolicy', () => {
  it('lets users list only their own chats and admins list anyone', () => {
    expect(ChatAccessPolicy.canListFor({ userId: 'u1', role: 'USER', sessionId: 's' }, 'u1')).toBe(true);
    expect(ChatAccessPolicy.canListFor({ userId: 'u1', role: 'USER', sessionId: 's' }, 'u2')).toBe(false);
    expect(ChatAccessPolicy.canListFor({ userId: 'a', role: 'ADMIN', sessionId: 's' }, 'u2')).toBe(true);
  });
});
