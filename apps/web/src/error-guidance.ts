export type BillingRecovery = 'setup' | 'system' | 'reload';
const messages: Record<string, string> = {
  INVALID_CREDENTIALS:
    'The password or verification code was not accepted. Check your password, or use a fresh authenticator code or unused recovery code, then try again.',
  UNAUTHENTICATED: 'Your session has expired. Sign in again to continue.',
  FORBIDDEN:
    'Your account does not have permission for this action. Ask an organization owner to review your role in Business settings → Members or Roles & permissions.',
  CSRF_INVALID:
    'This page could not verify the request. Copy any unsaved details, then reload the page and try again.',
  MFA_REQUIRED:
    'Complete two-step verification to continue. You can find your code in the authenticator app used when you set up this account.',
  PASSWORD_CHANGE_REQUIRED:
    'Choose your own password before continuing. Complete the password-change form shown after sign-in.',
  BILLING_SETUP_REQUIRED:
    'Your business details or GST registration are incomplete. Complete and confirm the registration in Business setup, then return and calculate the invoice again.',
  EINVOICE_BLOCKED:
    'Review e-invoice applicability in Business setup. Select only the status that actually applies to this business. If e-invoicing is required, finalization must wait for IRP integration; changing the setting is not a workaround.',
  TAX_NOT_REVIEWED:
    'An item’s tax classification has not been reviewed. Open Catalog, select the affected item and have an authorized tax reviewer confirm the applicable HSN/SAC and GST rate. Return here and calculate again.',
  MISSING_TAX_CLASSIFICATION:
    'An item has no applicable tax classification for this supply date. Add the correct effective-dated classification in Catalog, then return and calculate again.',
  INVALID_TAX_HISTORY:
    'The item’s tax history is inconsistent. Ask an authorized tax reviewer to correct its classification history in Catalog before calculating again.',
  INVALID_CLASSIFICATION:
    'An item’s tax classification is invalid. Review its HSN/SAC, GST rate and effective dates in Catalog, then calculate again.',
  CUSTOMER_REGISTRATION_MISMATCH:
    'The customer GSTIN and saved billing-address state do not match. Correct that customer in Customers, then choose the customer again in this invoice. Changing the delivery address will not fix the mismatch.',
  ARCHIVED_BILLING_RECORD:
    'The customer or an item is archived. Restore the affected record in Customers or Catalog, or choose an active replacement. Your draft remains open.',
  BILLING_REVIEW_REQUIRED:
    'Invoice details changed after the last preview. Click Calculate & preview, review the new totals, then retry finalization.',
  VERSION_CONFLICT:
    'This record changed after you opened it. Keep a copy of your unsaved details, then reload the latest record before saving again.',
  CONFLICT:
    'This action conflicts with the current record or duplicates an existing entry. Check the saved record and its status before submitting again.',
  ISSUANCE_BLOCKED:
    'This document or action is outside the currently approved issuance scope. You can keep the draft and use its marked preview. Contact your provider about release availability.',
  ORGANIZATION_WRITE_PAUSED:
    'Your provider has paused business changes for this organization. Contact your provider to review the pause. Authorized existing records and printing remain available; changing your role will not remove the pause.',
  RATE_LIMITED:
    'Too many attempts were made. Wait a few minutes before trying again. If you just used an authenticator code, use the next code rather than reusing it.',
  NETWORK_UNAVAILABLE:
    'The billing server could not be reached. Open System status to check the connection. A submitted change may still have completed, so check the saved record before retrying.',
  REQUEST_FAILED:
    'The server could not complete this request. Check System status and the saved record before retrying; contact your host operator if the problem continues.',
  SECURITY_UNAVAILABLE:
    'Account security is not configured correctly on the server. Contact your host operator to check the authentication configuration; repeated sign-in attempts will not fix it.',
};
export function billingProblem(code: string, fallback: string) {
  if (
    code === 'CUSTOMER_REGISTRATION_MISMATCH' &&
    fallback.startsWith('Check this customer')
  )
    return fallback;
  if (code === 'ENTITLEMENT_READ_ONLY')
    return `${fallback} Contact your provider to check the signed license and validity dates. Recording a payment alone does not activate access.`;
  return messages[code] ?? fallback;
}
export function billingRecovery(code: string) {
  if (['BILLING_SETUP_REQUIRED', 'EINVOICE_BLOCKED'].includes(code))
    return { label: 'Open business setup', action: 'setup' as const };
  if (['NETWORK_UNAVAILABLE', 'REQUEST_FAILED'].includes(code))
    return { label: 'Check system status', action: 'system' as const };
  if (['VERSION_CONFLICT', 'CSRF_INVALID'].includes(code))
    return { label: 'Reload latest page', action: 'reload' as const };
}
export function billingLinks(code: string): { label: string; href: string }[] {
  if (
    [
      'TAX_NOT_REVIEWED',
      'MISSING_TAX_CLASSIFICATION',
      'INVALID_TAX_HISTORY',
      'INVALID_CLASSIFICATION',
    ].includes(code)
  )
    return [{ label: 'Open catalog in a new tab', href: '#/catalog' }];
  if (code === 'CUSTOMER_REGISTRATION_MISMATCH')
    return [{ label: 'Open customers in a new tab', href: '#/customers' }];
  if (code === 'ARCHIVED_BILLING_RECORD')
    return [
      { label: 'Open customers in a new tab', href: '#/customers' },
      { label: 'Open catalog in a new tab', href: '#/catalog' },
    ];
  return [];
}
