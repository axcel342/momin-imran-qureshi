import type { Role } from '../../../shared/domain/actor';
import type { PublicJwk } from '../ports';

export interface DeviceBinding {
  id: string;
  userId: string;
  sessionId: string;
  publicKeyJwk: PublicJwk;
  createdAt: Date;
}

export interface BoundSession {
  userId: string;
  role: Role;
  publicKeyJwk: PublicJwk;
}
