import { DomainError } from '../../../shared/domain/errors';

export class KeyBindingPolicy {
  constructor(private readonly windowSeconds = 300) {}

  assertCanBind(input: { authenticatedAt: Date | null; alreadyBound: boolean }, now: Date): void {
    if (input.alreadyBound)
      throw new DomainError('KEY_ALREADY_BOUND', 'A key is already bound to this session');
    const auth = input.authenticatedAt;
    if (!auth || now.getTime() - auth.getTime() > this.windowSeconds * 1000) {
      throw new DomainError('KEY_BINDING_WINDOW_CLOSED', 'Key binding window has closed; sign in again');
    }
  }
}
