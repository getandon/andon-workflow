const BASE_URL = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch {}
    const message =
      (typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : text) || `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return res.json();
}

export function getApiKey(): string | null {
  try {
    const cookies = document.cookie.split('; ');
    const apiCookie = cookies.find((c) => c.startsWith('api_key='));
    return apiCookie ? decodeURIComponent(apiCookie.split('=')[1]) : null;
  } catch {
    return null;
  }
}

export function setApiKeyCookie(key: string) {
  document.cookie = `api_key=${encodeURIComponent(key)}; path=/; max-age=86400*7; SameSite=Lax`;
}

export function clearApiKeyCookie() {
  document.cookie = 'api_key=; path=/; max-age=0';
}
