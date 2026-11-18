import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { readCookie, routePath } from './bootstrap.js';
import { parseRange, SessionGate } from './session.js';

describe('SessionGate', () => {
  const gate = new SessionGate(4317);

  it('accepts only its own token', () => {
    expect(gate.matches(gate.token)).toBe(true);
    expect(gate.matches(`${gate.token}x`)).toBe(false);
    expect(gate.matches('')).toBe(false);
    expect(gate.matches(undefined)).toBe(false);
    expect(new SessionGate(4317).token).not.toBe(gate.token);
  });

  it('allows only the local host on its port', () => {
    expect(gate.allowedHost('127.0.0.1:4317')).toBe(true);
    expect(gate.allowedHost('localhost:4317')).toBe(true);
    expect(gate.allowedHost('evil.com')).toBe(false);
    expect(gate.allowedHost('127.0.0.1:9999')).toBe(false);
    expect(gate.allowedHost(undefined)).toBe(false);
  });

  it('rejects requests from other origins', () => {
    expect(gate.allowedOrigin(undefined)).toBe(true);
    expect(gate.allowedOrigin('http://127.0.0.1:4317')).toBe(true);
    expect(gate.allowedOrigin('https://evil.com')).toBe(false);
    expect(gate.allowedOrigin('http://127.0.0.1:4318')).toBe(false);
  });
});

describe('parseRange', () => {
  it('reads the byte ranges a video player asks for', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('ignores invalid or unsatisfiable ranges', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('bytes=50-10', 1000)).toBeNull();
    expect(parseRange('bytes=2000-', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; ceb_session=abc=; b=2', 'ceb_session')).toBe('abc=');
    expect(readCookie('a=1', 'ceb_session')).toBeUndefined();
    expect(readCookie(undefined, 'ceb_session')).toBeUndefined();
  });
});

describe('routePath', () => {
  const request = (url: string, route?: string): FastifyRequest =>
    ({ url, routeOptions: { url: route } }) as unknown as FastifyRequest;

  it('treats encoded, doubled or uppercase api paths as api', () => {
    expect(routePath(request('/%61pi/accounts', '/api/accounts'))).toBe('/api/accounts');
    expect(routePath(request('/%61pi/nada'))).toBe('/api/');
    expect(routePath(request('//api/accounts'))).toBe('/api/');
    expect(routePath(request('/API/accounts'))).toBe('/api/');
    expect(routePath(request('/%E0%A4%A'))).toBe('/api/');
  });

  it('leaves the panel pages alone', () => {
    expect(routePath(request('/novo/', '/*'))).toBe('/novo/');
    expect(routePath(request('/_next/static/a.js?v=1', '/*'))).toBe('/_next/static/a.js');
  });
});
