import { platformReadResponse } from '@gst/contracts/platform';
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
    const data = await response.json();
    if (response.ok && typeof data.csrfToken === 'string')
      csrf = data.csrfToken;
    if (response.status === 401 && !path.startsWith('auth/login'))
      window.dispatchEvent(new Event('platform-session-expired'));
    if (!response.ok)
      throw new Error(data.error?.message ?? 'Request failed. Try again.');
    return (body === undefined ? platformReadResponse(path, data) : data) as T;
  } finally {
    clearTimeout(timeout);
  }
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
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
