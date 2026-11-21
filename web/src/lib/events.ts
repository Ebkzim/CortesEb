'use client';

import { useEffect, useRef } from 'react';
import { ensureSession } from './api';
import type { JobEvent } from './types';

type Listener = (event: JobEvent) => void;

const listeners = new Set<Listener>();
const RECONNECTED = 'cortes:events-reconnected';
let source: EventSource | null = null;
let worker: SharedWorker | null = null;
let sharedWorkerFailed = false;
let retry: ReturnType<typeof setTimeout> | null = null;
let opened = false;

function canConnect(): boolean {
  return listeners.size > 0 && document.visibilityState === 'visible';
}

function disconnect(): void {
  if (worker !== null) {
    worker.port.postMessage('disconnect');
    worker.port.close();
    worker = null;
  }
  source?.close();
  source = null;
  if (retry !== null) {
    clearTimeout(retry);
    retry = null;
  }
}

function scheduleRetry(): void {
  if (retry !== null || !canConnect()) return;
  retry = setTimeout(() => {
    retry = null;
    connect();
  }, 2000);
}

function connect(): void {
  if (source !== null || worker !== null || typeof window === 'undefined' || !canConnect()) return;
  void ensureSession()
    .then(() => {
      if (source !== null || worker !== null || !canConnect()) return;
      if (!sharedWorkerFailed && 'SharedWorker' in window) {
        try {
          worker = new SharedWorker('/job-events-worker.js', { name: 'cortes:events' });
          worker.port.onmessage = ({ data }: MessageEvent<{ type: string; data?: string }>) => {
            if (data.type === 'open') connected();
            if (data.type === 'event' && typeof data.data === 'string') deliver(data.data);
          };
          worker.onerror = (error) => {
            error.preventDefault();
            sharedWorkerFailed = true;
            disconnect();
            scheduleRetry();
          };
          worker.port.start();
          worker.port.postMessage('connect');
          return;
        } catch {
          sharedWorkerFailed = true;
          disconnect();
        }
      }
      source = new EventSource('/api/events', { withCredentials: true });
      source.onopen = connected;
      source.onmessage = (message) => deliver(String(message.data));
      source.onerror = () => {
        disconnect();
        scheduleRetry();
      };
    })
    .catch(scheduleRetry);
}

function connected(): void {
  if (opened) window.dispatchEvent(new Event(RECONNECTED));
  opened = true;
}

function deliver(data: string): void {
  let event: JobEvent;
  try {
    event = JSON.parse(data) as JobEvent;
  } catch {
    return;
  }
  for (const listener of listeners) listener(event);
}

function visibilityChanged(): void {
  if (canConnect()) connect();
  else disconnect();
}

export function useJobEvents(listener: Listener, onReconnect?: () => void): void {
  const latest = useRef(listener);
  latest.current = listener;
  const reconnect = useRef(onReconnect);
  reconnect.current = onReconnect;
  useEffect(() => {
    const wrapped: Listener = (event) => {
      latest.current(event);
    };
    const resync = (): void => reconnect.current?.();
    listeners.add(wrapped);
    window.addEventListener(RECONNECTED, resync);
    if (listeners.size === 1) {
      document.addEventListener('visibilitychange', visibilityChanged);
      window.addEventListener('pagehide', disconnect);
      window.addEventListener('pageshow', visibilityChanged);
    }
    connect();
    return () => {
      listeners.delete(wrapped);
      window.removeEventListener(RECONNECTED, resync);
      if (listeners.size === 0) {
        disconnect();
        opened = false;
        document.removeEventListener('visibilitychange', visibilityChanged);
        window.removeEventListener('pagehide', disconnect);
        window.removeEventListener('pageshow', visibilityChanged);
      }
    };
  }, []);
}
