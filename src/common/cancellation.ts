import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<AbortSignal>();

export function withCancellation<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return storage.run(signal, work);
}

export function currentSignal(): AbortSignal | undefined {
  return storage.getStore();
}
