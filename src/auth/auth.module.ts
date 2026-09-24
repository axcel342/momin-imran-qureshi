import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IpRateLimitGuard, UserRateLimitGuard } from '../shared/http/rate-limit.guards';
import { RolesGuard } from '../shared/http/roles.guard';
import { GetMeUseCase } from './application/get-me.use-case';
import { RegisterDeviceKeyUseCase } from './application/register-device-key.use-case';
import { AuthController } from './controllers/auth.controller';
import { KEY_CRYPTO, NONCE_STORE, TOKEN_VERIFIER } from './domain/ports';
import { AuthGuard } from './guards/auth.guard';
import { EcdsaKeyCrypto } from './infrastructure/ecdsa-key-crypto';
import { RedisNonceStore } from './infrastructure/redis-nonce-store';
import { SupabaseTokenVerifier } from './infrastructure/supabase-token-verifier';
import { DEVICE_BINDING_REPOSITORY } from './repositories/device-binding.repository';
import { PrismaDeviceBindingRepository } from './repositories/prisma-device-binding.repository';
import { PrismaUserRepository } from './repositories/prisma-user.repository';
import { USER_REPOSITORY } from './repositories/user.repository';

@Module({
  controllers: [AuthController],
  providers: [
    RegisterDeviceKeyUseCase,
    GetMeUseCase,
    { provide: TOKEN_VERIFIER, useClass: SupabaseTokenVerifier },
    { provide: KEY_CRYPTO, useClass: EcdsaKeyCrypto },
    { provide: NONCE_STORE, useClass: RedisNonceStore },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: DEVICE_BINDING_REPOSITORY, useClass: PrismaDeviceBindingRepository },
    // Order matters: global guards run in registration order.
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserRateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
