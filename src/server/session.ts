import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'ceb_session';

export class SessionGate {
  readonly token = randomBytes(32).toString('base64url');

  constructor(private readonly port: number) {}

  matches(candidate: string | undefined): boolean {
    if (candidate === undefined) return false;
    const expected = Buffer.from(this.token);
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  allowedHost(host: string | undefined): boolean {
    if (host === undefined) return false;
    return host === `127.0.0.1:${String(this.port)}` || host === `localhost:${String(this.port)}`;
  }

  allowedOrigin(origin: string | undefined): boolean {
    if (origin === undefined) return true;
    return (
      origin === `http://127.0.0.1:${String(this.port)}` ||
      origin === `http://localhost:${String(this.port)}`
    );
  }
}

export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return null;
  let start: number;
  let end: number;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}
