import { platformReadResponse } from '@gst/contracts/platform';
import { platformProblem } from './problems.js';
export class PlatformApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(platformProblem(code, message));
  }
}
let confirmIdentity: (() => Promise<void>) | undefined;
export function onIdentityRequired(handler: () => Promise<void>) {
  confirmIdentity = handler;
  return () => {
    if (confirmIdentity === handler) confirmIdentity = undefined;
  };
}
let csrf = '';
let submissionKey: string | undefined;
export const submission = (key?: string) => {
  submissionKey = key;
};
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = 'POST',
  confirmed = false,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/platform/v1/' + path, {
      signal: controller.signal,
      method: body === undefined ? 'GET' : method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined
          ? {}
          : { 'content-type': 'application/json', 'x-csrf-token': csrf }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new PlatformApiError(
        response.status,
        'REQUEST_FAILED',
        'The server returned an unreadable response.',
      );
    });
    if (!data || typeof data !== 'object')
      throw new PlatformApiError(
        response.status,
        'REQUEST_FAILED',
        'The server returned an invalid response.',
      );
    if (response.ok && typeof data.csrfToken === 'string')
      csrf = data.csrfToken;
    if (response.status === 401 && data.error?.code === 'UNAUTHENTICATED')
      window.dispatchEvent(new Event('platform-session-expired'));
    if (
      !response.ok &&
      data.error?.code === 'REAUTH_REQUIRED' &&
      !confirmed &&
      confirmIdentity &&
      path !== 'auth/confirm'
    ) {
      clearTimeout(timeout);
      await confirmIdentity();
      // Only this explicitly rejected request is retried, with its original
      // payload and idempotency key. Transport/commit failures are never replayed.
      return api<T>(path, body, method, true);
    }
    if (!response.ok)
      throw new PlatformApiError(
        response.status,
        data.error?.code ??
          (response.status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED'),
        data.error?.message ?? 'Request failed.',
      );
    return (body === undefined ? platformReadResponse(path, data) : data) as T;
  } catch (error) {
    if (error instanceof PlatformApiError) throw error;
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw new PlatformApiError(
        0,
        'NETWORK_UNAVAILABLE',
        'Connection unavailable.',
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export { downloadJson as download } from '@gst/ui/json-files';
export const requestKey = () => submissionKey ?? crypto.randomUUID();
export function paise(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('Enter an INR amount with at most two decimal places.');
  const [whole = '0', fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
export function money(value: string) {
  const n = BigInt(value);
  return (
    '₹' +
    (n / 100n).toLocaleString('en-IN') +
    '.' +
    (n % 100n).toString().padStart(2, '0')
  );
}
