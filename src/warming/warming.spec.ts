import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, BrowserContext } from 'playwright-core';
import type { AccountService } from '../accounts/account.service.js';
import { BrowserSessions } from '../browser/browser-sessions.js';
import type { LoginWindows } from '../browser/login-windows.js';
import type { AppPaths } from '../config/app-paths.js';
import type { QueueStore } from '../publish/queue-store.js';
import { contentUrl, type WarmingBrowser } from './warming-browser.js';
import {
  dayKey,
  emptyCounts,
  goalsReached,
  warmingConfigSchema,
  type WarmingSession,
} from './warming-state.js';
import { WarmingStore } from './warming-store.js';
import { WarmingService } from './warming.service.js';
import { VideoUnavailableError } from './video-playback.js';

const config = (): ReturnType<typeof warmingConfigSchema.parse> =>
  warmingConfigSchema.parse({ goals: { views: 1, likes: 0 } });

describe('warming', () => {
  let home: string;
  let store: WarmingStore;
  let service: WarmingService;
  let paths: AppPaths;
  const accounts = { list: vi.fn(() => Promise.resolve([{ id: 'canal' }])) };
  const logins = { list: vi.fn(() => []), open: vi.fn(() => Promise.resolve({ phase: 'open' })) };
  const queue = { list: vi.fn((): Promise<unknown[]> => Promise.resolve([])) };
  const browser = {
    observeVerification: vi.fn(),
    client: vi.fn(() => Promise.resolve({})),
    clear: vi.fn(() => Promise.resolve(undefined)),
    next: vi.fn(() => Promise.resolve('https://www.youtube.com/shorts/abc123')),
    prepare: vi.fn(() => Promise.resolve({ url: 'https://www.youtube.com/shorts/abc123' })),
    watch: vi.fn(() => Promise.resolve(undefined)),
    text: vi.fn(() => Promise.resolve('Comentário de teste.')),
    perform: vi.fn(() => Promise.resolve(undefined)),
  };
  const context = { close: vi.fn(() => Promise.resolve(undefined)) };
  const video = {};
  const page = {
    locator: () => ({ first: () => video }),
    waitForTimeout: vi.fn(() => Promise.resolve(undefined)),
  };
  const sessions = {
    profiles: vi.fn(() =>
      Promise.resolve([{ account: 'canal', platform: 'youtube', connected: true }]),
    ),
    with: vi.fn(
      (
        _platform: string,
        _account: string,
        work: (page: Page, context: BrowserContext) => Promise<unknown>,
      ) => work(page as unknown as Page, context as unknown as BrowserContext),
    ),
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 21, 12));
    vi.clearAllMocks();
    accounts.list.mockResolvedValue([{ id: 'canal' }]);
    sessions.profiles.mockResolvedValue([
      { account: 'canal', platform: 'youtube', connected: true },
    ]);
    queue.list.mockResolvedValue([]);
    browser.perform.mockResolvedValue(undefined);
    browser.watch.mockResolvedValue(undefined);
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-warming-'));
    paths = { home } as AppPaths;
    store = new WarmingStore(paths);
    service = new WarmingService(
      paths,
      accounts as unknown as AccountService,
      sessions as unknown as BrowserSessions,
      logins as unknown as LoginWindows,
      queue as unknown as QueueStore,
      browser as unknown as WarmingBrowser,
      store,
    );
    await service.onModuleInit();
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    vi.useRealTimers();
    await fs.rm(home, { recursive: true, force: true });
  });

  async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await (service as unknown as { task: Promise<void> | null }).task;
  }

  it('restarts verification through the warmup browser instead of opening another Chrome profile', async () => {
    await service.start('canal', 'youtube', config());
    await store.update((sessions) => {
      const s = sessions[0];
      if (s) {
        s.status = 'attention';
        s.message = 'A rede pediu uma verificação';
        if (s.progress) s.progress.videoUrl = 'https://www.youtube.com/shorts/abc123';
      }
    });
    await service.resolve('canal', 'youtube');
    expect(logins.open).not.toHaveBeenCalled();
    expect((await store.list())[0]?.status).toBe('running');
  });

  it('rejects verification while the session is still running', async () => {
    await service.start('canal', 'youtube', config());
    await expect(service.resolve('canal', 'youtube')).rejects.toThrow(/Pare a sessão/);
    expect(logins.open).not.toHaveBeenCalled();
  });

  it('rejects empty goals, excessive amounts and invalid intervals', () => {
    expect(warmingConfigSchema.safeParse({ goals: emptyCounts() }).success).toBe(false);
    expect(warmingConfigSchema.safeParse({ goals: { comments: 1001 } }).success).toBe(false);
    expect(warmingConfigSchema.safeParse({ intervalSeconds: 0 }).success).toBe(false);
  });

  it('defaults older configurations to economic search and accepts the standard profile', () => {
    expect(warmingConfigSchema.parse({}).searchMode).toBe('economy');
    expect(warmingConfigSchema.parse({ searchMode: 'standard' }).searchMode).toBe('standard');
    expect(warmingConfigSchema.safeParse({ searchMode: 'invalid' }).success).toBe(false);
  });

  it('removes TikTok comment-like goals and ignores that goal in legacy sessions', async () => {
    sessions.profiles.mockResolvedValue([
      { account: 'canal', platform: 'tiktok', connected: true },
    ]);
    const saved = await service.start('canal', 'tiktok', {
      ...config(),
      goals: { ...emptyCounts(), views: 1, commentLikes: 5 },
    });
    expect(saved.config.goals.commentLikes).toBe(0);
    await store.update((sessions) => {
      const s = sessions[0];
      if (s) s.config.goals.commentLikes = 5;
    });
    await advance(2000);
    const completed = (await store.list())[0];
    expect(completed?.status).toBe('completed');
    expect(completed?.counts.commentLikes).toBe(0);
    expect(browser.perform).not.toHaveBeenCalled();
    expect(
      goalsReached({
        platform: 'tiktok',
        config: { ...saved.config, goals: { ...emptyCounts(), commentLikes: 5 } },
        counts: emptyCounts(),
      }),
    ).toBe(true);
    expect(
      goalsReached({
        platform: 'instagram',
        config: { ...saved.config, goals: { ...emptyCounts(), commentLikes: 5 } },
        counts: emptyCounts(),
      }),
    ).toBe(false);
  });

  it('rejects a TikTok request whose only goal is liking comments', async () => {
    await expect(
      service.start('canal', 'tiktok', { goals: { ...emptyCounts(), commentLikes: 1 } }),
    ).rejects.toThrow(/meta disponível/);
    expect(await store.list()).toEqual([]);
  });

  it('spaces economic captures but always captures an attention state', async () => {
    const session = await service.start('canal', 'youtube', config());
    const screenshot = vi.fn(() => Promise.resolve(Buffer.from('frame')));
    const capturePage = { screenshot } as unknown as Page;
    const progress = (stage: string): Promise<void> =>
      (
        service as unknown as {
          progress(
            session: WarmingSession,
            stage: string,
            message: string,
            page: Page,
          ): Promise<void>;
        }
      ).progress(session, stage, stage, capturePage);
    await progress('searching');
    await progress('preparing');
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(screenshot).toHaveBeenLastCalledWith({ type: 'jpeg', quality: 40, timeout: 1500 });
    vi.setSystemTime(Date.now() + 20_000);
    await progress('watching');
    expect(screenshot).toHaveBeenCalledTimes(2);
    await progress('attention');
    expect(screenshot).toHaveBeenCalledTimes(3);
  });

  it('keeps captures at every stage for standard search', async () => {
    const session = await service.start('canal', 'youtube', {
      ...config(),
      searchMode: 'standard',
    });
    const screenshot = vi.fn(() => Promise.resolve(Buffer.from('frame')));
    const progress = service as unknown as {
      progress(session: WarmingSession, stage: string, message: string, page: Page): Promise<void>;
    };
    await progress.progress(session, 'searching', 'searching', { screenshot } as unknown as Page);
    await progress.progress(session, 'preparing', 'preparing', { screenshot } as unknown as Page);
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(screenshot).toHaveBeenLastCalledWith({ type: 'jpeg', quality: 65, timeout: 3000 });
  });

  it('accepts only canonical video URLs on the expected platform', () => {
    expect(contentUrl('youtube', '/shorts/abc?feature=share')).toBe(
      'https://www.youtube.com/shorts/abc',
    );
    expect(contentUrl('instagram', '/reel/abc/')).toBe('https://www.instagram.com/reel/abc');
    expect(contentUrl('tiktok', '/@canal/video/123')).toBe(
      'https://www.tiktok.com/@canal/video/123',
    );
    expect(contentUrl('youtube', 'https://evil.test/shorts/abc')).toBeNull();
    expect(contentUrl('instagram', '/accounts/login')).toBeNull();
    expect(contentUrl('tiktok', 'javascript:alert(1)')).toBeNull();
  });

  it('requires a connected browser profile before starting', async () => {
    sessions.profiles.mockResolvedValue([]);
    await expect(service.start('canal', 'youtube', config())).rejects.toThrow(/Conecte/);
    expect(await store.list()).toEqual([]);
  });

  it('persists views and completes a finite session without issuing extra actions', async () => {
    await service.start('canal', 'youtube', config());
    await advance(2000);
    const saved = (await store.list())[0];
    expect(saved?.counts.views).toBe(1);
    expect(sessions.with).toHaveBeenCalledWith(
      'youtube',
      'canal',
      expect.any(Function),
      expect.any(AbortSignal),
      { visible: true },
    );
    expect(saved?.seen).toContain('views:https://www.youtube.com/shorts/abc123');
    expect(browser.perform).not.toHaveBeenCalled();
    await advance(62_000);
    expect((await store.list())[0]?.status).toBe('completed');
    expect((await store.list())[0]?.progress?.stage).toBe('completed');
    expect(sessions.with).toHaveBeenCalledTimes(1);
  });

  it('keeps the panel mode available without requiring a visible Chrome window', async () => {
    await service.start('canal', 'youtube', { ...config(), verificationMode: 'panel' });
    await advance(2000);
    expect(sessions.with).toHaveBeenCalledWith(
      'youtube',
      'canal',
      expect.any(Function),
      expect.any(AbortSignal),
      { visible: false },
    );
  });
  it('skips an unavailable video without counting it or stopping the session', async () => {
    browser.watch.mockRejectedValueOnce(
      new VideoUnavailableError('Vídeo indisponível. Seguindo para o próximo.'),
    );
    await service.start('canal', 'youtube', config());
    await advance(2000);
    const skipped = (await store.list())[0];
    expect(skipped?.status).toBe('running');
    expect(skipped?.counts.views).toBe(0);
    expect(skipped?.seen).toContain('skipped:https://www.youtube.com/shorts/abc123');
    expect(skipped?.history[0]?.message).toMatch(/indisponível/);
    expect(browser.perform).not.toHaveBeenCalled();
    browser.next.mockResolvedValueOnce('https://www.youtube.com/shorts/next');
    await advance(62_000);
    expect((await store.list())[0]?.counts.views).toBe(1);
    expect((await store.list())[0]?.status).toBe('completed');
  });

  it('remembers unavailable videos that disappear before a view is attempted', async () => {
    browser.prepare.mockRejectedValueOnce(new VideoUnavailableError('Vídeo indisponível.'));
    await service.start('canal', 'youtube', config());
    await advance(2000);
    const saved = (await store.list())[0];
    expect(saved?.counts.views).toBe(0);
    expect(saved?.seen).toEqual(['skipped:https://www.youtube.com/shorts/abc123']);
    expect(browser.watch).not.toHaveBeenCalled();
    expect(saved?.status).toBe('running');
  });
  it('defers to a publishing job without opening Chrome', async () => {
    queue.list.mockResolvedValue([{ account: 'canal', platform: 'youtube', status: 'publishing' }]);
    await service.start('canal', 'youtube', config());
    await advance(2000);
    expect(sessions.with).not.toHaveBeenCalled();
    expect((await store.list())[0]?.message).toMatch(/publicação/);
  });

  it('records ambiguous attempts and pauses without retrying the external action', async () => {
    browser.perform.mockRejectedValueOnce(new Error('envio não confirmado'));
    await service.start('canal', 'youtube', {
      ...config(),
      goals: { ...emptyCounts(), views: 1, comments: 1 },
    });
    await advance(2000);
    const saved = (await store.list())[0];
    expect(saved?.status).toBe('attention');
    expect(saved?.counts.comments).toBe(0);
    expect(saved?.seen).toContain('comments:https://www.youtube.com/shorts/abc123');
    await advance(120_000);
    expect(browser.perform).toHaveBeenCalledTimes(1);
  });

  it('stops while waiting for the model without sending a comment', async () => {
    browser.text.mockImplementationOnce(() => new Promise<string>(() => undefined));
    await service.start('canal', 'youtube', {
      ...config(),
      goals: { ...emptyCounts(), views: 1, comments: 1 },
    });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(browser.text).toHaveBeenCalled();
    });
    await service.stop('canal', 'youtube');
    await (service as unknown as { task: Promise<void> | null }).task;
    expect(browser.perform).not.toHaveBeenCalled();
    expect((await store.list())[0]?.status).toBe('stopped');
    expect((await store.list())[0]?.progress?.stage).toBe('stopped');
  });

  it('preserves same-day progress when stopped and restarted', async () => {
    await service.start('canal', 'youtube', config());
    await advance(2000);
    await service.stop('canal', 'youtube');
    const restarted = await service.start('canal', 'youtube', config());
    expect(restarted.counts.views).toBe(1);
    expect(restarted.seen).toHaveLength(1);
    expect(restarted.day).toBe(dayKey());
  });

  it('renews continuous goals the next local day', async () => {
    await service.start('canal', 'youtube', { ...config(), mode: 'continuous' });
    await advance(2000);
    await advance(62_000);
    expect((await store.list())[0]?.message).toMatch(/amanhã/);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 1, 0);
    vi.setSystemTime(tomorrow);
    browser.next.mockResolvedValueOnce('https://www.youtube.com/shorts/next');
    await advance(2000);
    expect((await store.list())[0]?.counts.views).toBe(1);
    expect((await store.list())[0]?.day).toBe(dayKey(tomorrow));
  });

  it('does not automatically resume sessions after the server restarts', async () => {
    await service.start('canal', 'youtube', config());
    // Simulate a crashed process: release only its lease, leaving running state on disk.
    await fs.rm(path.join(home, 'warming.worker'));
    const replacement = new WarmingService(
      paths,
      accounts as unknown as AccountService,
      sessions as unknown as BrowserSessions,
      logins as unknown as LoginWindows,
      queue as unknown as QueueStore,
      browser as unknown as WarmingBrowser,
      store,
    );
    await replacement.onModuleInit();
    expect((await store.list())[0]?.status).toBe('stopped');
    expect((await store.list())[0]?.message).toMatch(/reiniciado/);
    await replacement.onModuleDestroy();
  });

  it('locks a browser profile across instances and releases it for reuse', async () => {
    const first = new BrowserSessions(paths);
    const second = new BrowserSessions(paths);
    const lock = await first.reserve('youtube', 'canal');
    expect(lock).not.toBeNull();
    expect(await second.reserve('youtube', 'canal')).toBeNull();
    await lock?.release();
    const reused = await second.reserve('youtube', 'canal');
    expect(reused).not.toBeNull();
    await reused?.release();
  });
});
