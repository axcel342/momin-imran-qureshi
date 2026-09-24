import type { Role } from '../../shared/domain/actor';

export interface UserRecord {
  id: string;
  email: string;
  role: Role;
}

export interface UserRepository {
  upsert(user: { id: string; email: string }): Promise<void>;
  findById(id: string): Promise<UserRecord | null>;
}
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
