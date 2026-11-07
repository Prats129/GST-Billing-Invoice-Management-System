export type PlatformRecovery =
  'reload' | 'operations' | 'payments' | 'licenses' | 'organizations';
const messages: Record<string, string> = {
  REAUTH_REQUIRED:
    'Confirm your identity to continue. Your form stays open while you verify.',
  INVALID_CREDENTIALS:
    'The password was not accepted. Check your platform account password and try again.',
  INVALID_MFA:
    'The verification code was not accepted. Use a new code from your authenticator, or an unused recovery code. If you just used a code, wait for the next one.',
  UNAUTHENTICATED: 'Your admin session has expired. Sign in again to continue.',
  CSRF_INVALID:
    'This page could not verify the request. Reload the page to get a fresh session token; copy any unsaved details first.',
  FORBIDDEN:
    'This request came from an address the admin server does not allow. Open the exact PLATFORM_ORIGIN address configured in .env.admin; localhost and 127.0.0.1 are different addresses.',
  VERSION_CONFLICT:
    'Someone changed this record since you opened it. Copy your unsaved details, then reload the latest record before editing again.',
  CONFLICT:
    'This action does not match the current record, or a record with these details already exists. Check the latest organization details and Operations before submitting again.',
  INVALID_INPUT:
    'Some details are missing or invalid. Check the fields in this form, including dates, amounts and required selections. Your entries have been kept.',
  OVERPAYMENT:
    'This payment is greater than the agreement’s remaining balance. Open Payments, check existing receipts, then enter the remaining amount or less.',
  EXCESS_ADJUSTMENT:
    'This adjustment exceeds the receipt’s remaining amount. Check earlier adjustments in Payments and reduce the amount.',
  AGREEMENT_UNAVAILABLE:
    'This agreement is unavailable or has been voided. Choose an active agreement in Subscription before recording a payment.',
  REVERSE_RECEIPTS_FIRST:
    'This agreement has recorded payments. Record the appropriate linked reversal in Payments before voiding the agreement. History will be retained.',
  IDEMPOTENCY_CONFLICT:
    'This submission identifier was already used for different details. Check Operations or existing payment records before making a new submission.',
  SETUP_LINK_REISSUE_REQUIRED:
    'The earlier setup link cannot be recovered. Check Operations, then generate a new link. A new link invalidates the previous one.',
  HISTORY_REQUIRED:
    'Verified license history is missing. Open Licenses and reconcile the publisher’s signed history before preparing a renewal.',
  GRANT_CONFLICT:
    'This grant conflicts with the recorded license history. Open Licenses and reconcile the authoritative publisher history; do not reset sequence numbers.',
  REQUEST_MISMATCH:
    'The signed grant does not match this frozen request. In Licenses, import the grant signed for this exact organization, request and validity period.',
  WRONG_BINDING:
    'This grant belongs to a different organization, edition or offline installation. Check the organization identifiers and import the matching grant in Licenses.',
  INVALID_GRANT:
    'The grant’s signature or claims could not be verified. Check the trusted publisher key and import the original signed envelope in Licenses.',
  LATEST_GRANT_REQUIRED:
    'Only the latest verified grant can be applied. Open Licenses and select the latest recorded sequence.',
  ONLINE_ONLY:
    'This action is available only for online organizations. Offline accounts and grants must be managed using their local host tools.',
  OFFLINE_ONLY:
    'This action is available only for offline organizations. Use hosted operations for an online organization.',
  NOT_FOUND:
    'This record is no longer available. Return to Organizations and open its current record.',
  RATE_LIMITED:
    'Too many attempts were made. Wait a few minutes before trying again. Repeated clicks will not speed this up.',
  NETWORK_UNAVAILABLE:
    'The admin server could not be reached. Check that the server is running and your network connection works. A submitted change may still have completed; check Operations or payment history before retrying.',
  REQUEST_FAILED:
    'The server could not complete this request. Check Operations or the existing record before retrying a change; contact the host operator if the problem continues.',
  CANCELLED:
    'Identity confirmation was cancelled. The blocked request was not retried, and your form is still here.',
  OPERATOR_UNAVAILABLE:
    'The admin worker could not reach the billing database, or its connection is not ready. Ask the host operator to check the SaaS operator connection and database permissions, then retry this operation. Do not create the organization again.',
  STATE_CONFLICT:
    'The billing database rejected this operation because its current identity or license state differs. Verify hosted status on the organization and reconcile its mapping or signed history before retrying; do not reset history.',
};
export function platformProblem(code: string, fallback: string) {
  if (code === 'INVALID_INPUT' && fallback.startsWith('Check these fields:'))
    return fallback + ' Your entries have been kept.';
  return messages[code] ?? fallback;
}
export function platformRecovery(
  code: string,
): { label: string; target: PlatformRecovery } | undefined {
  if (['VERSION_CONFLICT', 'CSRF_INVALID'].includes(code))
    return { label: 'Reload latest page', target: 'reload' };
  if (
    ['OVERPAYMENT', 'EXCESS_ADJUSTMENT', 'REVERSE_RECEIPTS_FIRST'].includes(
      code,
    )
  )
    return { label: 'Open payments', target: 'payments' };
  if (
    [
      'HISTORY_REQUIRED',
      'GRANT_CONFLICT',
      'REQUEST_MISMATCH',
      'WRONG_BINDING',
      'INVALID_GRANT',
      'LATEST_GRANT_REQUIRED',
    ].includes(code)
  )
    return { label: 'Open licenses', target: 'licenses' };
  if (
    [
      'NETWORK_UNAVAILABLE',
      'CONFLICT',
      'IDEMPOTENCY_CONFLICT',
      'SETUP_LINK_REISSUE_REQUIRED',
    ].includes(code)
  )
    return { label: 'Check operations', target: 'operations' };
  if (code === 'NOT_FOUND')
    return { label: 'All organizations', target: 'organizations' };
}
