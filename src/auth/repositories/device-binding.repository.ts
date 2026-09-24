import type { BoundSession, DeviceBinding } from '../domain/entities/device-binding';

export interface DeviceBindingRepository {
  findBoundSession(sessionId: string): Promise<BoundSession | null>;
  existsForSession(sessionId: string): Promise<boolean>;
  /** Throws DomainError KEY_ALREADY_BOUND if the session already has a binding. */
  create(binding: DeviceBinding): Promise<void>;
}
export const DEVICE_BINDING_REPOSITORY = Symbol('DEVICE_BINDING_REPOSITORY');
