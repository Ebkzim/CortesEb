import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../config/app-paths.js';
import { BrowserSessions } from './browser-sessions.js';
import { identityFromUrl } from './identity.js';
import { chromeCandidates, loginArgs } from './login-windows.js';
import { DESK_HEADER, DeskServer, deskFile } from './desk-server.js';
import { notifyCommand } from './remote-desk.js';
import { RemoteDesk, deskInputSchema } from './remote-desk.js';

function fakePage(): { page: Page; calls: string[] } {
  const calls: string[] = [];
  const page = {
    viewportSize: () => ({ width: 1000, height: 500 }),
    screenshot: () => Promise.resolve(Buffer.from('jpeg')),
    mouse: {
      move: (x: number, y: number) => {
        calls.push(`move ${String(x)} ${String(y)}`);
        return Promise.resolve();
      },
      down: () => {
        calls.push('down');
        return Promise.resolve();
      },
      up: () => {
        calls.push('up');
        return Promise.resolve();
      },
      click: (x: number, y: number) => {
        calls.push(`click ${String(x)} ${String(y)}`);
        return Promise.resolve();
      },
      wheel: () => Promise.resolve(),
    },
    keyboard: {
      press: (key: string) => {
        calls.push(`press ${key}`);
        return Promise.resolve();
      },
      type: (text: string) => {
        calls.push(`type ${text}`);
        return Promise.resolve();
      },
    },
  } as unknown as Page;
  return { page, calls };
}

describe('RemoteDesk', () => {
  it('shows the request while waiting and clears it once solved', async () => {
    const desk = new RemoteDesk();
    const notes: string[] = [];
    desk.useNotifier((_title, body) => notes.push(body));
    const { page, calls } = fakePage();
    let solved = false;
    const waiting = desk.request(page, {
      reason: 'captcha',
      platform: 'tiktok',
      account: 'main',
      message: 'resolva',
      solved: () => Promise.resolve(solved),
      timeoutMs: 5000,
      pollMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(desk.state()?.reason).toBe('captcha');
    expect(notes).toEqual(['resolva']);
    await desk.input({ type: 'click', x: 0.5, y: 0.5 });
    await desk.input({ type: 'text', text: 'abc' });
    await desk.input({ type: 'key', key: 'Enter' });
    expect(calls).toEqual(['click 500 250', 'type abc', 'press Enter']);
    expect((await desk.frame()).toString()).toBe('jpeg');
    solved = true;
    expect(await waiting).toBe(true);
    expect(desk.state()).toBeNull();
    await expect(desk.frame()).rejects.toThrow(/nenhuma verificação/);
  });

  it('gives up on cancel or timeout', async () => {
    const desk = new RemoteDesk();
    desk.useNotifier(() => undefined);
    const { page } = fakePage();
    const base = {
      reason: 'login' as const,
      platform: 'tiktok' as const,
      account: 'main',
      message: 'entre',
      solved: () => Promise.resolve(false),
      pollMs: 5,
    };
    const waiting = desk.request(page, { ...base, timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(desk.cancel()).toBe(true);
    expect(await waiting).toBe(false);
    expect(await desk.request(page, { ...base, timeoutMs: 20 })).toBe(false);
  });

  it('accepts only known input shapes', () => {
    expect(deskInputSchema.safeParse({ type: 'click', x: 2, y: 0 }).success).toBe(false);
    expect(deskInputSchema.safeParse({ type: 'key', key: 'F12' }).success).toBe(false);
    expect(deskInputSchema.safeParse({ type: 'text', text: '' }).success).toBe(false);
    expect(deskInputSchema.safeParse({ type: 'eval', code: 'x' }).success).toBe(false);
    expect(deskInputSchema.safeParse({ type: 'down', x: 0.1, y: 0.2 }).success).toBe(true);
  });
});

describe('DeskServer', () => {
  let dir = '';
  let server: DeskServer;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-desk-'));
    server = new DeskServer({ home: dir } as AppPaths, new RemoteDesk());
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('listens on loopback, writes a private endpoint file and checks the token', async () => {
    await server.start();
    const file = deskFile({ home: dir } as AppPaths);
    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
    const endpoint = JSON.parse(await fs.readFile(file, 'utf8')) as { port: number; token: string };
    const url = `http://127.0.0.1:${String(endpoint.port)}`;
    expect((await fetch(`${url}/state`)).status).toBe(401);
    expect((await fetch(`${url}/state`, { headers: { [DESK_HEADER]: 'errado' } })).status).toBe(
      401,
    );
    const ok = await fetch(`${url}/state`, { headers: { [DESK_HEADER]: endpoint.token } });
    expect(await ok.json()).toEqual({ state: null });
    const bad = await fetch(`${url}/input`, {
      method: 'POST',
      headers: { [DESK_HEADER]: endpoint.token },
      body: JSON.stringify({ type: 'eval', code: 'x' }),
    });
    expect(bad.status).toBe(400);
    await server.stop();
    await expect(fs.access(file)).rejects.toThrow();
  });
});

describe('BrowserSessions', () => {
  it('keeps one profile folder per platform and account and lists connections', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-profiles-'));
    const sessions = new BrowserSessions({ home: dir } as AppPaths);
    expect(sessions.profileDir('tiktok', 'main')).toBe(path.join(dir, 'browser', 'tiktok-main'));
    expect(() => sessions.profileDir('tiktok', '../fora')).toThrow();
    await fs.mkdir(sessions.profileDir('tiktok', 'main'), { recursive: true });
    await fs.mkdir(sessions.profileDir('tiktok', 'outra'), { recursive: true });
    await sessions.markConnected('tiktok', 'main', true);
    expect(await sessions.profiles()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'tiktok', account: 'main', connected: true }),
        expect.objectContaining({ platform: 'tiktok', account: 'outra', connected: false }),
      ]),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('login window', () => {
  it('opens a plain chrome window on the profile folder at the login page', () => {
    expect(loginArgs('/p/tiktok-main', 'https://www.tiktok.com/login', 'linux')).toEqual([
      '--user-data-dir=/p/tiktok-main',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      'https://www.tiktok.com/login',
    ]);
    expect(loginArgs('/p', 'u', 'darwin')).toContain('--use-mock-keychain');
    expect(loginArgs('/p', 'u', 'win32')).not.toContain('--password-store=basic');
    expect(chromeCandidates('linux')).toContain('/usr/bin/google-chrome');
    expect(chromeCandidates('darwin')[0]).toMatch(/Google Chrome$/);
  });
});

describe('network identity', () => {
  it('reads the handle from each profile address', () => {
    expect(identityFromUrl('tiktok', 'https://www.tiktok.com/@cortes_eb7?lang=pt-BR')).toEqual({
      handle: 'cortes_eb7',
      url: 'https://www.tiktok.com/@cortes_eb7',
    });
    expect(identityFromUrl('instagram', '/ebs2developer/')).toEqual({
      handle: 'ebs2developer',
      url: 'https://www.instagram.com/ebs2developer/',
    });
    expect(
      identityFromUrl('youtube', 'https://studio.youtube.com/channel/UClagX49Ga7_RF6vygUJkt2A'),
    ).toEqual({
      handle: 'UClagX49Ga7_RF6vygUJkt2A',
      url: 'https://www.youtube.com/channel/UClagX49Ga7_RF6vygUJkt2A',
    });
    expect(identityFromUrl('tiktok', 'https://www.tiktok.com/login')).toBeNull();
    expect(identityFromUrl('instagram', '/explore/tags/x/')).toBeNull();
  });

  it('keeps the handle with the connection and forgets the whole profile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-identity-'));
    const sessions = new BrowserSessions({ home: dir } as AppPaths);
    await fs.mkdir(sessions.profileDir('instagram', 'main'), { recursive: true });
    await sessions.markConnected('instagram', 'main', true, {
      handle: 'perfil',
      url: 'https://www.instagram.com/perfil/',
    });
    await sessions.markConnected('instagram', 'main', true);
    expect(await sessions.profiles()).toEqual([
      expect.objectContaining({ platform: 'instagram', connected: true, handle: 'perfil' }),
    ]);
    await fs.mkdir(sessions.profileDir('tiktok', 'main'), { recursive: true });
    await fs.writeFile(
      path.join(sessions.profileDir('tiktok', 'main'), '.cortes-eb-connected'),
      '2026-11-21T10:00:00.000Z',
    );
    expect(await sessions.profiles()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'tiktok', connected: true, handle: null }),
      ]),
    );
    await sessions.forget('instagram', 'main');
    await expect(fs.access(sessions.profileDir('instagram', 'main'))).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('notifyCommand', () => {
  it('passes the text as arguments instead of script source on Mac', () => {
    const [command, args] = notifyCommand('Título "x"', 'end run', 'darwin') ?? ['', []];
    expect(command).toBe('osascript');
    expect(args.slice(-2)).toEqual(['Título "x"', 'end run']);
    expect(args.filter((arg) => arg.includes('Título'))).toHaveLength(1);
  });

  it('uses notify-send on Linux and nothing on Windows', () => {
    expect(notifyCommand('a', 'b', 'linux')?.[0]).toBe('notify-send');
    expect(notifyCommand('a', 'b', 'win32')).toBeNull();
  });
});
