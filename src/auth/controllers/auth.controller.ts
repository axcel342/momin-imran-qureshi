import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../shared/domain/actor';
import { BearerOnly, CurrentActor, CurrentToken, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { GetMeUseCase } from '../application/get-me.use-case';
import { RegisterDeviceKeyUseCase } from '../application/register-device-key.use-case';
import type { VerifiedToken } from '../domain/ports';

const coordinate = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'must be a base64url P-256 coordinate');
const registerSchema = z.strictObject({
  publicKey: z.strictObject({ kty: z.literal('EC'), crv: z.literal('P-256'), x: coordinate, y: coordinate }),
});

@Controller('v1/auth')
@RateLimitGroup('auth')
export class AuthController {
  constructor(
    private readonly registerKey: RegisterDeviceKeyUseCase,
    private readonly getMe: GetMeUseCase,
  ) {}

  @Post('device-keys')
  @HttpCode(201)
  @BearerOnly()
  register(@CurrentToken() token: VerifiedToken, @Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.registerKey.execute(token, body.publicKey);
  }

  @Get('me')
  @Roles('USER', 'ADMIN')
  me(@CurrentActor() actor: Actor) {
    return this.getMe.execute(actor);
  }
}
