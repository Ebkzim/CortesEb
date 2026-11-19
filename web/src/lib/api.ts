'use client';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let session: Promise<void> | null = null;

export function ensureSession(): Promise<void> {
  session ??= openSession();
  return session;
}

async function openSession(): Promise<void> {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const match = /acesso=([A-Za-z0-9_-]+)/.exec(hash);
  if (match?.[1] !== undefined) {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: match[1] }),
      credentials: 'same-origin',
    });
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!response.ok) throw new ApiError(await messageOf(response), response.status);
    return;
  }
  const response = await fetch('/api/session', { credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(await messageOf(response), response.status);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  await ensureSession();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(await messageOf(response), response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function remove<T>(path: string): Promise<T> {
  return api<T>(path, { method: 'DELETE' });
}

export function upload<T>(
  path: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<T> {
  return ensureSession().then(
    () =>
      new Promise<T>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', `/api${path}`);
        request.withCredentials = true;
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
        request.onload = () => {
          const body = safeJson(request.responseText) as { error?: string } | null;
          if (request.status >= 200 && request.status < 300) resolve(body as T);
          else reject(new ApiError(body?.error ?? 'falha no envio', request.status));
        };
        request.onerror = () => {
          reject(new ApiError('a conexão caiu durante o envio', 0));
        };
        const form = new FormData();
        form.append('file', file);
        request.send(form);
      }),
  );
}

async function messageOf(response: Response): Promise<string> {
  const body = safeJson(await response.text()) as { error?: string } | null;
  return body?.error ?? `erro ${String(response.status)}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
