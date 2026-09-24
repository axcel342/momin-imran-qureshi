import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import { USER_REPOSITORY, type UserRecord, type UserRepository } from '../repositories/user.repository';

@Injectable()
export class GetMeUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(actor: Actor): Promise<UserRecord> {
    const user = await this.users.findById(actor.userId);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found');
    return user;
  }
}
