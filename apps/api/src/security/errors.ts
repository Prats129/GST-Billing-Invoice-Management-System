import { HttpException } from '@nestjs/common';

const errors = {
  UNAUTHENTICATED: [401, 'Please sign in'],
  INVALID_CREDENTIALS: [401, 'Invalid credentials'],
  FORBIDDEN: [403, 'Access denied'],
  CSRF_INVALID: [403, 'Request verification failed'],
  MFA_REQUIRED: [403, 'Complete two-step verification'],
  PASSWORD_CHANGE_REQUIRED: [403, 'Change your temporary password'],
  INVALID_INPUT: [400, 'Invalid input'],
  CONFLICT: [409, 'Operation conflicts with the current state'],
  RATE_LIMITED: [429, 'Too many attempts; try again later'],
  SECURITY_UNAVAILABLE: [503, 'Security configuration unavailable'],
} as const;
export class SecurityError extends HttpException {
  constructor(public readonly code: keyof typeof errors) {
    super(errors[code][1], errors[code][0]);
  }
}
export function deny(code: keyof typeof errors): never {
  throw new SecurityError(code);
}
