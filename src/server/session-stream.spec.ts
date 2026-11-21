import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobEvents } from '../jobs/job-events.js';
import { SessionController } from './session.controller.js';
import { SessionGate } from './session.js';

afterEach(() => vi.useRealTimers());

describe('panel event stream', () => {
  it('releases subscriptions and the heartbeat when the response closes', () => {
    vi.useFakeTimers();
    const raw = Object.assign(new EventEmitter(), { writeHead: vi.fn(), write: vi.fn() });
    const hijack = vi.fn();
    const reply = { hijack, raw } as unknown as FastifyReply;
    const events = new JobEvents();
    const controller = new SessionController(new SessionGate(4317), events);
    controller.stream(reply);
    expect(hijack).toHaveBeenCalledOnce();
    events.publish({ type: 'removed', jobId: 'before-close' });
    expect(raw.write).toHaveBeenLastCalledWith(
      'data: {"type":"removed","jobId":"before-close"}\n\n',
    );
    vi.advanceTimersByTime(15_000);
    expect(raw.write).toHaveBeenLastCalledWith(': ping\n\n');
    raw.emit('close');
    raw.write.mockClear();
    events.publish({ type: 'removed', jobId: 'after-close' });
    vi.advanceTimersByTime(30_000);
    expect(raw.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
