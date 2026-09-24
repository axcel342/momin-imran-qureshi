export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'SIGNATURE_REQUIRED'
  | 'INVALID_SIGNATURE'
  | 'KEY_NOT_BOUND'
  | 'REQUEST_EXPIRED'
  | 'REPLAY_DETECTED'
  | 'QUOTA_EXHAUSTED'
  | 'PAYMENT_FAILED'
  | 'FORBIDDEN'
  | 'KEY_BINDING_WINDOW_CLOSED'
  | 'NOT_FOUND'
  | 'KEY_ALREADY_BOUND'
  | 'SUBSCRIPTION_NOT_ACTIVE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
