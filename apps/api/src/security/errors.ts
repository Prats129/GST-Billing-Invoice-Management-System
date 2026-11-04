import { HttpException } from '@nestjs/common';

const errors = {
  UNAUTHENTICATED: [401, 'Please sign in'],
  INVALID_CREDENTIALS: [401, 'Invalid credentials'],
  FORBIDDEN: [403, 'Access denied'],
  CSRF_INVALID: [403, 'Request verification failed'],
  MFA_REQUIRED: [403, 'Complete two-step verification'],
  PASSWORD_CHANGE_REQUIRED: [403, 'Change your temporary password'],
  INVALID_INPUT: [400, 'Invalid input'],
  ENTITLEMENT_READ_ONLY: [
    403,
    'This organization is read-only because its license or subscription is missing, expired or cannot be verified. Existing authorized records and printing remain available. Contact the host/platform operator.',
  ],
  CUSTOMER_REGISTRATION_MISMATCH: [
    400,
    'The customer GSTIN state does not match their saved billing-address state. Correct the customer GSTIN or billing address in Customers, then try again. The invoice delivery address may be different.',
  ],
  CONFLICT: [409, 'Operation conflicts with the current state'],
  VERSION_CONFLICT: [
    409,
    'This record changed. Close the form and reload before saving.',
  ],
  NOT_FOUND: [404, 'Record not found'],
  BILLING_SETUP_REQUIRED: [
    409,
    'Complete business setup and confirm the regular GST registration before billing.',
  ],
  BILLING_REVIEW_REQUIRED: [
    409,
    'Billing details changed. Calculate and review the preview again.',
  ],
  ISSUANCE_BLOCKED: [
    409,
    'Issuance is blocked for this document or action because it is outside the current release scope. Draft previews remain available.',
  ],
  EINVOICE_BLOCKED: [
    409,
    'Confirm e-invoice applicability. Required IRP integration is not available.',
  ],
  ARCHIVED_BILLING_RECORD: [
    409,
    'This customer or catalog item is archived. Restore it or choose an active record.',
  ],
  CORRECTION_UNSUPPORTED: [
    409,
    'This correction or cancellation is not supported for the current document state.',
  ],
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
