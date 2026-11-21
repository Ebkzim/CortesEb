'use client';

import { ApiError, fetchWithDeadline } from './request';
export { ApiError } from './request';
export const SESSION_EXPIRED_EVENT = 'cortes:session-expired';

let session: Promise<void> | null = null;

export function ensureSession(): Promise<void> {
  session ??= openSession().catch((error: unknown) => {
    session = null;
    throw error;
  });
  return session;
}

async function openSession(): Promise<void> {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const match = /acesso=([A-Za-z0-9_-]+)/.exec(hash);
  if (match?.[1] !== undefined) {
    const response = await fetchWithDeadline(
      '/api/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: match[1] }),
        credentials: 'same-origin',
      },
      8000,
    );
    if (!response.ok) throw new ApiError(await messageOf(response), response.status);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  const response = await fetchWithDeadline('/api/session', { credentials: 'same-origin' }, 8000);
  if (!response.ok) throw new ApiError(await messageOf(response), response.status);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  await ensureSession();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetchWithDeadline(
    `/api${path}`,
    { ...init, headers, credentials: 'same-origin' },
    ['GET', 'HEAD'].includes(init.method ?? 'GET') ? 15_000 : 120_000,
  );
  if (response.status === 401) {
    session = null;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(
      'A sessão expirou após reiniciar o servidor. Abra o painel pelo link de acesso da execução atual no terminal.',
      401,
    );
  }
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
