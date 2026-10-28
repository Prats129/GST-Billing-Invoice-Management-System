export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
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
    const result = await response.json();
    if (!response.ok)
      throw new ApiError(
        response.status,
        result.error?.code ?? 'REQUEST_FAILED',
        result.error?.message ?? 'Request failed',
      );
    return result as T;
  } finally {
    clearTimeout(timeout);
  }
}
