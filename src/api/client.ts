import type {DeviceIdentity} from './types';

/** Jellyfin expresses all durations and positions in 100-nanosecond ticks. */
export const TICKS_PER_SECOND = 10_000_000;
export const TICKS_PER_MS = 10_000;

export class JellyfinError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'JellyfinError';
  }
}

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

/**
 * Normalises a user-typed server address into a base URL.
 *
 * Accepts `host`, `host:port`, and full URLs, defaulting to `http` because the
 * common case on a LAN is a server without a certificate.
 */
export function normalizeServerUrl(input: string): string {
  let value = input.trim().replace(/\/+$/, '');
  if (!value) {
    throw new JellyfinError('Enter a server address.');
  }

  const hadScheme = /^https?:\/\//i.test(value);
  if (!hadScheme) {
    value = `http://${value}`;
  }

  // Default to Jellyfin's HTTP port only for a bare host. Once the user has
  // typed a scheme they get that scheme's default port, so `https://host`
  // reaches 443 rather than being redirected to 8096.
  if (!hadScheme) {
    const withoutScheme = value.replace(/^https?:\/\//i, '');
    if (!withoutScheme.includes(':') && !withoutScheme.includes('/')) {
      value = `${value}:8096`;
    }
  }
  return value;
}

export function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const encoded = Array.isArray(value) ? value.join(',') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(encoded)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Builds the `Authorization` header Jellyfin expects.
 *
 * The token is only included once authenticated; the same header shape is used
 * for the unauthenticated login call, which is how the server learns the
 * device identity that later shows up under Dashboard > Devices.
 */
export function authorizationHeader(identity: DeviceIdentity, token?: string): string {
  const fields: Array<[string, string]> = [
    ['Client', identity.client],
    ['Device', identity.device],
    ['DeviceId', identity.deviceId],
    ['Version', identity.version],
  ];
  if (token) {
    fields.push(['Token', token]);
  }
  // Quotes are required, and values must not contain them.
  return `MediaBrowser ${fields
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`)
    .join(', ')}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Performs a single Jellyfin HTTP call.
 *
 * Requests are given a timeout because an unreachable server on a LAN
 * otherwise leaves the TV UI spinning indefinitely with no way back.
 */
export async function request<T>(
  serverUrl: string,
  path: string,
  identity: DeviceIdentity,
  options: RequestOptions = {},
): Promise<T> {
  const {method = 'GET', query, body, token, timeoutMs = 20000, signal} = options;
  const url = `${serverUrl}${path}${buildQuery(query ?? {})}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort());
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorizationHeader(identity, token),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    throw new JellyfinError(
      aborted
        ? `The server at ${serverUrl} did not respond in time.`
        : `Could not reach ${serverUrl}.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new JellyfinError(describeStatus(response.status), response.status);
  }

  // Several Jellyfin endpoints (playback reporting in particular) answer 204.
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new JellyfinError('The server returned a response this client could not read.');
  }
}

function describeStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Sign-in was rejected. Check the user name and password.';
    case 403:
      return 'This user is not allowed to access that content.';
    case 404:
      return 'The server does not have that item.';
    default:
      return `The server returned an error (HTTP ${status}).`;
  }
}
