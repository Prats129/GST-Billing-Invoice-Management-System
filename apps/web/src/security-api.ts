import { billingProblem } from './error-guidance.js';
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(billingProblem(code, message));
  }
}
export async function securityRequest<T>(
  path: string,
  csrf: string | undefined,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET'
          ? {
              'Content-Type': 'application/json',
              ...(csrf ? { 'x-csrf-token': csrf } : {}),
            }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new ApiError(
        response.status,
        'REQUEST_FAILED',
        'The server returned an unreadable response.',
      );
    });
    if (!result || typeof result !== 'object')
      throw new ApiError(
        response.status,
        'REQUEST_FAILED',
        'The server returned an invalid response.',
      );
    if (!response.ok)
      throw new ApiError(
        response.status,
        result.error?.code ?? 'REQUEST_FAILED',
        result.error?.message ?? 'Request failed',
      );
    return result as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw new ApiError(0, 'NETWORK_UNAVAILABLE', 'Connection unavailable.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
