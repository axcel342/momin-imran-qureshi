import { SetMetadata } from '@nestjs/common';
import type { RateGroup } from '../redis/rate-limit.config';

export const RATE_LIMIT_GROUP_KEY = 'rateLimitGroup';
export const RateLimitGroup = (group: RateGroup) => SetMetadata(RATE_LIMIT_GROUP_KEY, group);
