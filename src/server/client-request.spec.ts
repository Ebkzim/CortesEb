import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchWithDeadline } from '../../web/src/lib/request.js';

afterEach(() => vi.unstubAllGlobals());

describe('panel request deadlines', () => {
  it('preserves the request and the server response', async () => {
    const response = new Response('{"ok":true}', { status: 201 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    expect(
      await fetchWithDeadline('/api/session', {
        method: 'POST',
        body: '{"token":"test"}',
        credentials: 'same-origin',
      }),
    ).toBe(response);
    expect(fetch).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({
        method: 'POST',
        body: '{"token":"test"}',
        credentials: 'same-origin',
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it('interrupts a stalled request with a recoverable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new Error('request aborted'));
            });
          }),
      ),
    );
    await expect(fetchWithDeadline('/api/session', {}, 20)).rejects.toMatchObject({
      status: 408,
      message: 'O servidor demorou para responder. Tente novamente.',
    });
  });

  it('keeps caller cancellation distinct from connection failures', async () => {
    const abort = new AbortController();
    const reason = new Error('cancelled by caller');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new Error('request aborted'));
            });
          }),
      ),
    );
    const pending = fetchWithDeadline('/api/warming', { signal: abort.signal });
    abort.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('reports an offline server without leaving an unresolved promise', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchWithDeadline('/api/session')).rejects.toBeInstanceOf(ApiError);
    await expect(fetchWithDeadline('/api/session')).rejects.toMatchObject({ status: 0 });
  });
});
