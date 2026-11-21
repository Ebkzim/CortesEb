import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

class Port {
  onmessage: ((message: { data: string }) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly start = vi.fn();
  readonly close = vi.fn();

  command(data: string): void {
    this.onmessage?.({ data });
  }
}

function fixture(): { ports: Port[]; streams: Stream[]; join(): Port } {
  const streams: Stream[] = [];
  class Source extends Stream {
    constructor(url: string, options: { withCredentials: boolean }) {
      super();
      expect(url).toBe('/api/events');
      expect(options.withCredentials).toBe(true);
      streams.push(this);
    }
  }
  const scope: { onconnect: (event: { ports: Port[] }) => void } = {
    onconnect: () => undefined,
  };
  const code = fs.readFileSync(
    new URL('../../web/public/job-events-worker.js', import.meta.url),
    'utf8',
  );
  vm.runInNewContext(code, { self: scope, EventSource: Source });
  const ports: Port[] = [];
  return {
    ports,
    streams,
    join: () => {
      const port = new Port();
      scope.onconnect({ ports: [port] });
      port.command('connect');
      ports.push(port);
      return port;
    },
  };
}

class Stream {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readonly close = vi.fn();
}

describe('panel shared event connection', () => {
  it('uses one server connection for seven tabs and distributes updates to all of them', () => {
    const test = fixture();
    for (let i = 0; i < 7; i++) test.join();
    expect(test.streams).toHaveLength(1);
    const stream = test.streams[0];
    stream?.onopen?.();
    const update = '{"type":"removed","jobId":"example"}';
    stream?.onmessage?.({ data: update });
    for (const port of test.ports) {
      expect(port.start).toHaveBeenCalledOnce();
      expect(port.postMessage).toHaveBeenNthCalledWith(1, { type: 'open' });
      expect(port.postMessage).toHaveBeenNthCalledWith(2, { type: 'event', data: update });
    }
  });

  it('releases the connection after the last tab disconnects and can start again', () => {
    const test = fixture();
    const first = test.join();
    const second = test.join();
    const stream = test.streams[0];
    first.command('disconnect');
    expect(stream?.close).not.toHaveBeenCalled();
    stream?.onmessage?.({ data: 'update' });
    expect(first.postMessage).not.toHaveBeenCalled();
    expect(second.postMessage).toHaveBeenCalledOnce();
    second.command('disconnect');
    expect(stream?.close).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    test.join();
    expect(test.streams).toHaveLength(2);
  });

  it('marks a new tab as connected when joining an already open stream', () => {
    const test = fixture();
    test.join();
    const stream = test.streams[0];
    if (stream !== undefined) stream.readyState = Stream.OPEN;
    const late = test.join();
    expect(test.streams).toHaveLength(1);
    expect(late.postMessage).toHaveBeenCalledWith({ type: 'open' });
  });
});
