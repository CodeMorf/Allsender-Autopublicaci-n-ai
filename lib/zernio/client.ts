export const ZERNIO_SUPPORTED_PLATFORMS = [
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'x',
  'tiktok',
  'youtube',
  'threads',
  'reddit',
  'pinterest',
  'bluesky',
  'googlebusiness',
  'telegram',
  'snapchat',
  'discord',
  'slack',
  'whatsapp',
] as const;

export type ZernioPlatform = (typeof ZERNIO_SUPPORTED_PLATFORMS)[number];

export function normalizeZernioBaseUrl(value?: string | null): string {
  const raw = String(value || process.env.ZERNIO_BASE_URL || 'https://zernio.com/api').trim().replace(/\/+$/, '');
  return raw.endsWith('/v1') ? raw.slice(0, -3) : raw;
}

export function zernioApiKey(): string {
  return String(process.env.ZERNIO_API_KEY || '').trim();
}

export function isZernioPlatform(value: string): value is ZernioPlatform {
  return (ZERNIO_SUPPORTED_PLATFORMS as readonly string[]).includes(String(value || '').toLowerCase());
}

export function zernioModuleKey(platform: string): string {
  return `zernio_${String(platform || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function buildUrl(path: string): string {
  const base = normalizeZernioBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export async function callZernio<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = zernioApiKey();
  if (!apiKey) throw new Error('ZERNIO_API_KEY no está configurada en .env');

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${apiKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(buildUrl(path), {
    ...init,
    headers,
    cache: 'no-store' as any,
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || data?.errors?.[0]?.message || text || `Zernio API error ${response.status}`;
    const error: any = new Error(String(message));
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data as T;
}

export function zernioGet<T = any>(path: string): Promise<T> {
  return callZernio<T>(path, { method: 'GET' });
}

export function zernioPost<T = any>(path: string, body?: unknown): Promise<T> {
  return callZernio<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}


export function zernioPut<T = any>(path: string, body?: unknown): Promise<T> {
  return callZernio<T>(path, {
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function zernioPatch<T = any>(path: string, body?: unknown): Promise<T> {
  return callZernio<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function zernioDelete<T = any>(path: string): Promise<T> {
  return callZernio<T>(path, { method: 'DELETE' });
}
