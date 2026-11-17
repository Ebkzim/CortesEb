'use client';

import { useEffect, useRef } from 'react';
import { ensureSession } from './api';
import type { JobEvent } from './types';

type Listener = (event: JobEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (source !== null || typeof window === 'undefined') return;
  void ensureSession().then(() => {
    if (source !== null) return;
    source = new EventSource('/api/events', { withCredentials: true });
    source.onmessage = (message) => {
      let event: JobEvent;
      try {
        event = JSON.parse(String(message.data)) as JobEvent;
      } catch {
        return;
      }
      for (const listener of listeners) listener(event);
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (retry === null && listeners.size > 0) {
        retry = setTimeout(() => {
          retry = null;
          connect();
        }, 2000);
      }
    };
  });
}

export function useJobEvents(listener: Listener): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const wrapped: Listener = (event) => {
      latest.current(event);
    };
    listeners.add(wrapped);
    connect();
    return () => {
      listeners.delete(wrapped);
    };
  }, []);
}
