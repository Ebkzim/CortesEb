import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { AccountService } from '../accounts/account.service.js';
import type { BrowserSessions } from '../browser/browser-sessions.js';
import type { LoginWindows } from '../browser/login-windows.js';
import type { AppPaths } from '../config/app-paths.js';
import type { QueueStore } from '../publish/queue-store.js';
import type { WarmingBrowser } from '../warming/warming-browser.js';
import type { WarmingDesk } from '../warming/warming-desk.js';
import { FollowingController, followingView } from './following.controller.js';
import { FollowingStore } from './following-store.js';
import { FollowingService } from './following.service.js';
import type { FollowingSession } from './following-state.js';
import type { InstagramFollowingBrowser, Membership, Relation } from './instagram-following.js';

describe('Instagram relationship sessions', () => {
  let home: string;
  let store: FollowingStore;
  let service: FollowingService;
  const accounts = { list: vi.fn(() => Promise.resolve([{ id: 'canal' }])) };
  const sessions = {
    profiles: vi.fn(() =>
      Promise.resolve([
        { account: 'canal', platform: 'instagram', connected: true, handle: 'owner' },
      ]),
    ),
    with: vi.fn(
      (
        _platform: string,
        _account: string,
        work: (page: unknown, context: unknown) => Promise<void>,
      ) => work({}, {}),
    ),
  };
  const logins = { list: vi.fn((): { account: string; platform: string; phase: string }[] => []) };
  const queue = {
    list: vi.fn(
      (): Promise<{ account: string; platform: string; status: string; createdAt: string }[]> =>
        Promise.resolve([]),
    ),
  };
  const warming = { clear: vi.fn(() => Promise.resolve(undefined)), observeVerification: vi.fn() };
  const browser = {
    self: vi.fn(() => Promise.resolve('owner')),
    discover: vi.fn(() => Promise.resolve({ usernames: ['someone'], reel: null })),
    membership: vi.fn((): Promise<Membership> => Promise.resolve('no')),
    profile: vi.fn((): Promise<{ header: unknown; relation: Relation }> =>
      Promise.resolve({ header: {}, relation: 'follow' }),
    ),
    perform: vi.fn((): Promise<'following' | 'requested' | 'unfollowed'> =>
      Promise.resolve('following'),
    ),
  };
  const desk = { cancel: vi.fn() };
  beforeEach(async () => {
    vi.resetAllMocks();
    accounts.list.mockResolvedValue([{ id: 'canal' }]);
    sessions.profiles.mockResolvedValue([
      { account: 'canal', platform: 'instagram', connected: true, handle: 'owner' },
    ]);
    sessions.with.mockImplementation((_p, _a, work) => work({}, {}));
    logins.list.mockReturnValue([]);
    queue.list.mockResolvedValue([]);
    browser.self.mockResolvedValue('owner');
    browser.discover.mockResolvedValue({ usernames: ['someone'], reel: null });
    browser.membership.mockResolvedValue('no');
    browser.profile.mockResolvedValue({ header: {}, relation: 'follow' });
    browser.perform.mockResolvedValue('following');
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-following-'));
    store = new FollowingStore({ home } as AppPaths);
    service = new FollowingService(
      accounts as unknown as AccountService,
      sessions as unknown as BrowserSessions,
      logins as unknown as LoginWindows,
      queue as unknown as QueueStore,
      warming as unknown as WarmingBrowser,
      browser as unknown as InstagramFollowingBrowser,
      store,
      desk as unknown as WarmingDesk,
    );
    await service.initialize();
  });
  afterEach(async () => {
    await service.shutdown();
    await fs.rm(home, { recursive: true, force: true });
  });
  async function latest(): Promise<FollowingSession> {
    const session = (await service.list())[0];
    if (!session) throw new Error('missing test session');
    return session;
  }
  it('records intent before clicking and completes the exact quantity', async () => {
    browser.perform.mockImplementation(async () => {
      expect((await latest()).ledger[0]?.state).toBe('pending');
      expect((await latest()).counts.follow).toBe(0);
      return 'following';
    });
    await service.run(await service.start('canal', { goal: 1 }));
    expect((await latest()).status).toBe('completed');
    expect((await latest()).counts.follow).toBe(1);
    expect((await latest()).ledger[0]?.state).toBe('following');
    await service.run(await latest());
    expect(browser.perform).toHaveBeenCalledTimes(1);
  });
  it('separates private requests from confirmed follows while counting the selected actions', async () => {
    browser.perform.mockResolvedValue('requested');
    await service.run(await service.start('canal', { goal: 1 }));
    expect((await latest()).counts).toEqual({ follow: 0, requested: 1, unfollow: 0 });
    expect((await latest()).status).toBe('completed');
  });
  it('has an independent freshly drawn interval after each confirmed action', async () => {
    await service.run(
      await service.start('canal', { goal: 3, interval: { minSeconds: 10, maxSeconds: 11 } }),
    );
    const first = await latest();
    expect(first.progress.stage).toBe('waiting');
    expect(Date.parse(first.nextAt) - Date.now()).toBeGreaterThan(9000);
    browser.discover.mockResolvedValue({ usernames: ['another'], reel: null });
    await service.run(first);
    expect((await latest()).lastIntervalSeconds).not.toBe(first.lastIntervalSeconds);
    expect((await latest()).counts.follow).toBe(2);
  });
  it('checks all currently followed candidates, including people absent from the app ledger', async () => {
    browser.profile.mockResolvedValue({ header: {}, relation: 'following' });
    browser.perform.mockResolvedValue('unfollowed');
    const started = await service.start('canal', { mode: 'unfollow', goal: 1 });
    expect(started.ledger).toEqual([]);
    await service.run(started);
    expect(browser.membership).toHaveBeenCalledWith(
      {},
      {},
      'owner',
      'someone',
      expect.any(AbortSignal),
    );
    expect((await latest()).counts.unfollow).toBe(1);
    expect((await latest()).ledger[0]?.checkedAt).not.toBeNull();
  });
  it.each(['yes', 'unknown'] as const)(
    'keeps the profile when membership is %s',
    async (membership) => {
      browser.membership.mockResolvedValue(membership);
      await service.run(await service.start('canal', { mode: 'unfollow' }));
      expect(browser.perform).not.toHaveBeenCalled();
      expect((await latest()).counts.unfollow).toBe(0);
      expect((await latest()).history.some((e) => e.message.includes('mantido'))).toBe(true);
    },
  );
  it('can remove an existing relationship re-established after an earlier confirmed removal', async () => {
    browser.profile.mockResolvedValue({ header: {}, relation: 'following' });
    browser.perform.mockResolvedValue('unfollowed');
    await service.run(await service.start('canal', { mode: 'unfollow', goal: 1 }));
    await service.run(await service.start('canal', { mode: 'unfollow', goal: 1 }));
    expect(browser.perform).toHaveBeenCalledTimes(2);
    expect((await latest()).counts.unfollow).toBe(1);
    expect((await latest()).ledger).toHaveLength(2);
  });
  it('keeps polling responses compact and rejects invalid account paths', async () => {
    const session = await service.start('canal', {});
    const view = followingView(session);
    expect(view.pendingCount).toBe(0);
    expect(view).not.toHaveProperty('ledger');
    expect(view).not.toHaveProperty('candidates');
    await expect(new FollowingController(service).start('../canal', {})).rejects.toThrow(
      /inválida/,
    );
  });

  it('never retries an ambiguous action even after stop/start', async () => {
    browser.perform.mockRejectedValue(new Error('Não foi confirmada.'));
    await service.run(await service.start('canal', { goal: 1 }));
    expect((await latest()).status).toBe('attention');
    expect((await latest()).ledger[0]?.state).toBe('pending');
    await service.run(await service.start('canal', { goal: 1 }));
    expect(browser.perform).toHaveBeenCalledTimes(1);
    expect((await latest()).counts.follow).toBe(0);
  });
  it('rejects simultaneous follow/unfollow and allows switching after stop', async () => {
    await service.start('canal', { mode: 'follow' });
    await expect(service.start('canal', { mode: 'unfollow' })).rejects.toThrow(/Pare a sessão/);
    await service.stop('canal');
    expect((await service.start('canal', { mode: 'unfollow' })).config.mode).toBe('unfollow');
  });
  it('does not open a browser for a stale stopped work item', async () => {
    const stale = await service.start('canal', {});
    await service.stop('canal');
    await service.run(stale);
    expect(sessions.with).not.toHaveBeenCalled();
  });
  it('queues behind publishing without performing or counting an action', async () => {
    queue.list.mockResolvedValue([
      {
        account: 'canal',
        platform: 'instagram',
        status: 'publishing',
        createdAt: new Date().toISOString(),
      },
    ]);
    await service.run(await service.start('canal', {}));
    expect(sessions.with).not.toHaveBeenCalled();
    expect((await latest()).progress.stage).toBe('queued');
    expect((await latest()).counts.follow).toBe(0);
  });
  it('preserves confirmed work if stop arrives while confirmation is returning', async () => {
    browser.perform.mockImplementation(async () => {
      await service.stop('canal');
      return 'following';
    });
    await service.run(await service.start('canal', { goal: 2 }));
    expect((await latest()).status).toBe('stopped');
    expect((await latest()).counts.follow).toBe(1);
    expect((await latest()).ledger[0]?.state).toBe('following');
  });
  it('stops after restart without losing the ledger and rejects work without the worker lease', async () => {
    await service.run(await service.start('canal', { goal: 2 }));
    await service.shutdown();
    await expect(service.start('canal', {})).rejects.toThrow(/Outra instância/);
    await service.initialize();
    expect((await latest()).status).toBe('stopped');
    expect((await latest()).ledger[0]?.state).toBe('following');
  });
});
