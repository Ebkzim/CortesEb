import path from 'node:path';
import fs from 'node:fs/promises';
import type { Page } from 'playwright-core';
import { Injectable, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { AccountService } from '../accounts/account.service.js';
import { BrowserSessions, type BrowserPlatform } from '../browser/browser-sessions.js';
import { LoginWindows } from '../browser/login-windows.js';
import { AppError } from '../common/app-error.js';
import { acquireProcessLock, type ProcessLock } from '../common/file-lock.js';
import { AppPaths } from '../config/app-paths.js';
import { QueueStore } from '../publish/queue-store.js';
import { WarmingDesk } from './warming-desk.js';
import { WarmingBrowser } from './warming-browser.js';
import {
  ACTIONS,
  dayKey,
  emptyCounts,
  goalsReached,
  warmingConfigSchema,
  type Action,
  type WarmingSession,
} from './warming-state.js';
import { WarmingStore } from './warming-store.js';
import { FollowingService } from '../following/following.service.js';
import { warmingFailure } from './warming-errors.js';
import { sampleSeconds } from './timing.js';
import { VideoUnavailableError } from './video-playback.js';

@Injectable()
export class WarmingService implements OnModuleInit, OnModuleDestroy {
  private lease: ProcessLock | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private task: Promise<void> | null = null;
  private active: { key: string; controller: AbortController } | null = null;
  private closing = false;
  private readonly capturedAt = new Map<string, number>();

  constructor(
    private readonly paths: AppPaths,
    private readonly accounts: AccountService,
    private readonly sessions: BrowserSessions,
    private readonly logins: LoginWindows,
    private readonly queue: QueueStore,
    private readonly browser: WarmingBrowser,
    private readonly store: WarmingStore,
    @Optional() private readonly desk?: WarmingDesk,
    @Optional() private readonly following?: FollowingService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.lease = await acquireProcessLock(path.join(this.paths.home, 'warming.worker'));
    if (this.lease === null) return;
    await this.store.update((sessions) => {
      for (const session of sessions) {
        if (session.status === 'running') {
          session.status = 'stopped';
          if (session.progress) {
            session.progress.stage = 'stopped';
            session.progress.until = null;
          }
          session.message =
            'O serviço foi reiniciado. Confira o histórico e inicie para continuar.';
        }
      }
    });
    await this.following?.initialize();
    this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    clearTimeout(this.timer);
    this.desk?.cancel();
    this.active?.controller.abort();
    this.following?.cancel();
    await this.task?.catch(() => undefined);
    if (this.lease !== null) {
      await this.store.update((sessions) => {
        for (const session of sessions)
          if (session.status === 'running') {
            session.status = 'stopped';
            if (session.progress) {
              session.progress.stage = 'stopped';
              session.progress.until = null;
            }
            session.message = 'Serviço encerrado. Inicie para continuar.';
          }
      });
      await this.following?.shutdown();
      await this.lease.release();
    }
  }

  list(): Promise<WarmingSession[]> {
    return this.store.list();
  }

  async start(account: string, platform: BrowserPlatform, input: unknown): Promise<WarmingSession> {
    if (this.lease === null)
      throw new AppError(
        'PROCESS_FAILED',
        'O aquecimento está sendo gerenciado por outra instância do painel.',
      );
    const parsed = warmingConfigSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        'INVALID_INPUT',
        parsed.error.issues[0]?.message ?? 'configuração inválida',
      );
    if (platform === 'tiktok') parsed.data.goals.commentLikes = 0;
    if (!ACTIONS.some((action) => parsed.data.goals[action] > 0))
      throw new AppError('INVALID_INPUT', 'Defina pelo menos uma meta disponível nesta rede.');
    if (!(await this.accounts.list()).some((item) => item.id === account))
      throw new AppError('INVALID_INPUT', 'conta não cadastrada');
    const profile = (await this.sessions.profiles()).find(
      (item) => item.account === account && item.platform === platform,
    );
    if (profile?.connected !== true)
      throw new AppError(
        'NOT_CONFIGURED',
        'Conecte esta rede pelo navegador antes de iniciar o aquecimento.',
      );
    if (
      this.logins
        .list()
        .some(
          (item) =>
            item.account === account &&
            item.platform === platform &&
            ['open', 'checking'].includes(item.phase),
        )
    )
      throw new AppError(
        'INVALID_INPUT',
        'Conclua o login e feche a janela do Chrome antes de iniciar.',
      );
    if (parsed.data.goals.comments > 0 || parsed.data.goals.replies > 0)
      await this.browser.client(parsed.data);
    const now = new Date();
    return this.store.update((sessions) => {
      const previous = sessions.find(
        (item) => item.account === account && item.platform === platform,
      );
      if (previous?.status === 'running')
        throw new AppError(
          'INVALID_INPUT',
          'O aquecimento já está em execução. Pare antes de alterar as metas.',
        );
      if (previous !== undefined && this.active?.key === `${platform}:${account}`)
        throw new AppError(
          'INVALID_INPUT',
          'A sessão anterior ainda está parando. Aguarde alguns segundos.',
        );
      const session: WarmingSession = {
        account,
        platform,
        config: parsed.data,
        status: 'running',
        counts: previous?.day === dayKey(now) ? previous.counts : emptyCounts(),
        day: dayKey(now),
        startedAt: now.toISOString(),
        nextAt: now.toISOString(),
        message: 'Na fila de execução.',
        progress: {
          stage: 'queued',
          updatedAt: now.toISOString(),
          videoUrl: null,
          until: null,
          frameAt: previous?.progress?.frameAt ?? null,
        },
        timing: previous?.timing ?? { watchSeconds: null, intervalSeconds: null },
        seen: previous?.seen ?? [],
        history: previous?.history ?? [],
      };
      if (session.seen.filter((item) => item.startsWith('views:')).length >= 5000)
        throw new AppError(
          'INVALID_INPUT',
          'O histórico atingiu 5.000 vídeos. Revise a conta antes de iniciar uma nova sessão.',
        );
      if (previous === undefined) sessions.push(session);
      else sessions[sessions.indexOf(previous)] = session;
      return session;
    });
  }

  async resolve(account: string, platform: BrowserPlatform): Promise<WarmingSession> {
    const session = (await this.store.list()).find(
      (item) => item.account === account && item.platform === platform,
    );
    if (session?.status !== 'attention')
      throw new AppError('INVALID_INPUT', 'Pare a sessão antes de abrir a verificação.');
    return this.start(account, platform, session.config);
  }

  async stop(account: string, platform: BrowserPlatform): Promise<WarmingSession> {
    if (this.active?.key === `${platform}:${account}`) {
      this.desk?.cancel();
      this.active.controller.abort();
    }
    return this.store.update((sessions) => {
      const session = sessions.find(
        (item) => item.account === account && item.platform === platform,
      );
      if (session === undefined)
        throw new AppError('INVALID_INPUT', 'Nenhuma sessão para esta rede.');
      session.status = 'stopped';
      if (session.progress) {
        session.progress.stage = 'stopped';
        session.progress.until = null;
      }
      session.message =
        'Parado. Uma ação já enviada à rede pode levar alguns segundos para aparecer.';
      return session;
    });
  }

  private schedule(): void {
    if (this.closing) return;
    this.timer = setTimeout(() => {
      this.task = this.tick()
        .catch(() => undefined)
        .finally(() => {
          this.task = null;
          this.schedule();
        });
    }, 2000);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const session = (await this.store.list())
      .filter((item) => item.status === 'running' && Date.parse(item.nextAt) <= Date.now())
      .sort((a, b) => a.nextAt.localeCompare(b.nextAt))[0];
    const following = await this.following?.due();
    if (following && (!session || following.nextAt.localeCompare(session.nextAt) < 0)) {
      await this.following?.run(following);
      return;
    }
    if (session === undefined) return;
    if (session.day !== dayKey() && session.config.mode === 'continuous') {
      await this.change(session, (current) => {
        current.day = dayKey();
        current.counts = emptyCounts();
      });
      session.counts = emptyCounts();
      session.day = dayKey();
    }
    if (goalsReached(session)) {
      await this.change(session, (current) => {
        if (current.config.mode === 'goals') {
          current.status = 'completed';
          current.message = 'Metas concluídas.';
          if (current.progress) {
            current.progress.stage = 'completed';
            current.progress.until = null;
          }
        } else {
          const tomorrow = new Date();
          tomorrow.setHours(24, 0, 0, 0);
          current.nextAt = tomorrow.toISOString();
          current.message =
            'Metas do dia concluídas. Retoma amanhã, no horário local do computador.';
        }
      });
      return;
    }
    const known = (await this.accounts.list()).some((item) => item.id === session.account);
    const profile = (await this.sessions.profiles()).find(
      (item) => item.account === session.account && item.platform === session.platform,
    );
    if (!known || profile?.connected !== true) {
      await this.attention(
        session,
        'Conta removida ou rede desconectada. Reconecte antes de continuar.',
      );
      return;
    }
    const busy = (await this.queue.list()).some(
      (job) =>
        job.account === session.account &&
        job.platform === session.platform &&
        (job.status === 'publishing' ||
          (job.status === 'approved' &&
            Date.parse(job.scheduledAt ?? job.createdAt) <= Date.now())),
    );
    const login = this.logins
      .list()
      .some(
        (item) =>
          item.account === session.account &&
          item.platform === session.platform &&
          ['open', 'checking'].includes(item.phase),
      );
    if (busy || login) {
      await this.change(session, (current) => {
        current.nextAt = new Date(Date.now() + 30_000).toISOString();
        if (current.progress) {
          current.progress.stage = 'queued';
          current.progress.until = current.nextAt;
        }
        current.message = busy
          ? 'Aguardando a publicação desta conta.'
          : 'Aguardando o login terminar.';
      });
      return;
    }
    await this.progress(session, 'opening', 'Abrindo a sessão do Chrome.');
    const controller = new AbortController();
    this.active = { key: `${session.platform}:${session.account}`, controller };
    try {
      await this.cycle(session, controller.signal);
      await this.change(session, (current) => {
        if (current.status === 'running') {
          const interval = sampleSeconds(
            current.config.intervalSeconds,
            current.config.intervalRange,
            current.timing?.intervalSeconds,
          );
          current.timing = {
            watchSeconds: current.timing?.watchSeconds ?? null,
            intervalSeconds: interval,
          };
          current.nextAt = new Date(Date.now() + interval * 1000).toISOString();
          current.message = 'Aguardando o próximo vídeo.';
          if (current.progress) {
            current.progress.stage = 'waiting';
            current.progress.until = current.nextAt;
            current.progress.updatedAt = new Date().toISOString();
          }
          if (goalsReached(current)) {
            if (current.config.mode === 'goals') {
              current.status = 'completed';
              current.message = 'Metas concluídas.';
              if (current.progress) {
                current.progress.stage = 'completed';
                current.progress.until = null;
              }
            } else {
              const tomorrow = new Date();
              tomorrow.setHours(24, 0, 0, 0);
              current.nextAt = tomorrow.toISOString();
              if (current.progress) current.progress.until = current.nextAt;
              current.message =
                'Metas do dia concluídas. Retoma amanhã, no horário local do computador.';
            }
          }
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = warmingFailure(error, session.platform, 'abrir a sessão do navegador');
        await this.attention(session, message.slice(0, 500));
      }
    } finally {
      this.active = null;
    }
  }

  private async cycle(session: WarmingSession, signal: AbortSignal): Promise<void> {
    await this.sessions.with(
      session.platform,
      session.account,
      async (page, context) => {
        this.browser.observeVerification(
          page,
          session.account,
          async (waiting) => {
            await this.progress(
              session,
              waiting ? 'verification' : 'preparing',
              waiting
                ? session.config.verificationMode === 'browser'
                  ? 'Resolva a verificação na janela original do Chrome. Os vídeos estão pausados durante a espera.'
                  : 'Resolva a verificação na tela interativa do painel. Os vídeos estão pausados durante a espera.'
                : 'Verificação resolvida. Continuando na mesma página.',
              session.config.verificationMode === 'browser' ? undefined : page,
            );
          },
          signal,
          session.config.verificationMode,
        );
        let selectedUrl: string | null = null;
        let step = 'verificar a sessão';
        try {
          await this.browser.clear(session.platform, page, context);
          await this.progress(
            session,
            'searching',
            'Carregando o feed e procurando um novo vídeo.',
            page,
          );
          step = 'buscar um novo vídeo';
          const url = await this.browser.next(page, session, (message) =>
            this.progress(session, 'searching', message, page),
          );
          selectedUrl = url;
          await this.progress(session, 'preparing', 'Abrindo o vídeo selecionado.', page, url);
          await this.browser.clear(session.platform, page, context);
          const action = ACTIONS.find(
            (item) =>
              item !== 'views' &&
              !(session.platform === 'tiktok' && item === 'commentLikes') &&
              session.counts[item] < session.config.goals[item],
          );
          step = 'abrir o vídeo selecionado';
          const target = await this.browser.prepare(
            page,
            session.platform,
            url,
            'views',
            session.config.searchMode,
          );
          if (target === null) return;
          await this.browser.clear(session.platform, page, context);
          await this.intent(session, 'views', url, signal);
          const watchSeconds = sampleSeconds(
            session.config.watchSeconds,
            session.config.watchRange,
            session.timing?.watchSeconds,
          );
          await this.change(session, (current) => {
            current.timing = {
              watchSeconds,
              intervalSeconds: current.timing?.intervalSeconds ?? null,
            };
          });
          const video = target.video ?? page.locator('video').first();
          await this.progress(
            session,
            'watching',
            `Assistindo ao vídeo por ${watchSeconds} segundos.`,
            page,
            url,
            new Date(Date.now() + watchSeconds * 1000).toISOString(),
          );
          step = 'assistir ao vídeo';
          await this.browser.watch(page, video, session.platform, watchSeconds, signal);
          await this.record(session, 'views', url, `Vídeo assistido por ${watchSeconds} segundos.`);
          if (action === undefined) return;
          signal.throwIfAborted();
          await this.progress(
            session,
            'preparing',
            action === 'comments' || action === 'replies' || action === 'commentLikes'
              ? 'Abrindo os comentários e localizando o campo da interação.'
              : 'Localizando o botão de curtir o vídeo.',
            page,
            url,
          );
          step = {
            views: 'abrir o vídeo selecionado',
            likes: 'localizar o botão de curtir o vídeo',
            comments: 'abrir o campo de comentário',
            commentLikes: 'abrir os comentários para curtir',
            replies: 'abrir o campo de resposta',
          }[action];
          const prepared = await this.browser.prepare(
            page,
            session.platform,
            url,
            action,
            session.config.searchMode,
          );
          await this.browser.clear(session.platform, page, context);
          if (prepared === null) {
            const message =
              action === 'likes'
                ? 'Vídeo já curtido; seguindo para o próximo.'
                : 'Este vídeo não disponibilizou uma interação elegível nos comentários; seguindo para o próximo.';
            await this.change(session, (current) => {
              current.history.unshift({ at: new Date().toISOString(), action: null, url, message });
              current.history = current.history.slice(0, 100);
            });
            await this.progress(session, 'skipped', message, page, url);
            return;
          }
          if (action === 'comments' || action === 'replies')
            await this.progress(
              session,
              'generating',
              'A IA está preparando o texto da interação.',
              page,
              url,
            );
          if (action === 'comments' || action === 'replies') step = 'gerar o texto da interação';
          const text =
            action === 'comments' || action === 'replies'
              ? await abortable(this.browser.text(prepared, session, action), signal)
              : null;
          await this.browser.clear(session.platform, page, context);
          await this.intent(session, action, url, signal, text);
          signal.throwIfAborted();
          await this.progress(
            session,
            'acting',
            `Executando e confirmando: ${action === 'likes' ? 'curtida no vídeo' : action === 'comments' ? 'comentário' : action === 'replies' ? 'resposta' : 'curtida no comentário'}.`,
            page,
            url,
          );
          signal.throwIfAborted();
          step = 'enviar e confirmar a interação';
          await this.browser.perform(page, prepared, action, text);
          await this.record(
            session,
            action,
            url,
            text ?? (action === 'likes' ? 'Vídeo curtido.' : 'Comentário curtido.'),
          );
          await this.progress(session, 'confirmed', 'Interação confirmada pela página.', page, url);
        } catch (error) {
          if (error instanceof VideoUnavailableError && selectedUrl !== null && !signal.aborted) {
            const url = selectedUrl;
            await this.change(session, (current) => {
              const key = `skipped:${url}`;
              if (!current.seen.includes(key)) current.seen.push(key);
              current.history.unshift({
                at: new Date().toISOString(),
                action: null,
                url,
                message: error.message,
              });
              current.history = current.history.slice(0, 100);
            });
            await this.progress(session, 'skipped', error.message, page, url);
            return;
          }
          const message = warmingFailure(error, session.platform, step);
          if (!signal.aborted) await this.progress(session, 'attention', message, page);
          if (error instanceof Error && message !== error.message.split('\n')[0])
            throw new Error(message, { cause: error });
          throw error;
        }
      },
      signal,
      { visible: session.config.verificationMode === 'browser' },
    );
  }

  async frame(account: string, platform: BrowserPlatform): Promise<Buffer> {
    const file = path.join(this.paths.home, 'warming-frames', `${platform}-${account}.jpg`);
    const frame = await fs.readFile(file).catch(() => null);
    if (frame === null) throw new AppError('MISSING_FILE', 'Ainda não há captura desta sessão.');
    return frame;
  }

  private async progress(
    session: WarmingSession,
    stage: string,
    message: string,
    page?: Page,
    videoUrl?: string,
    until: string | null = null,
  ): Promise<void> {
    const remainingMs = until ? Math.max(0, Date.parse(until) - Date.now()) : null;
    let frameAt: string | null = null;
    const economy = session.config.searchMode === 'economy';
    const key = `${session.platform}:${session.account}`;
    const capture =
      !economy ||
      ['attention', 'verification'].includes(stage) ||
      Date.now() - (this.capturedAt.get(key) ?? 0) >= 20_000;
    if (page && capture) {
      try {
        const image = await page.screenshot({
          type: 'jpeg',
          quality: economy ? 40 : 65,
          timeout: economy ? 1500 : 3000,
        });
        const dir = path.join(this.paths.home, 'warming-frames');
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, `${session.platform}-${session.account}.jpg`);
        await fs.writeFile(`${file}.tmp`, image, { mode: 0o600 });
        await fs.rename(`${file}.tmp`, file);
        frameAt = new Date().toISOString();
        this.capturedAt.set(key, Date.now());
      } catch {
        frameAt = null;
      }
    }
    await this.change(session, (current) => {
      if (current.status !== 'running') return;
      current.message = message;
      current.progress = {
        stage,
        updatedAt: new Date().toISOString(),
        videoUrl: videoUrl ?? current.progress?.videoUrl ?? null,
        until: remainingMs === null ? null : new Date(Date.now() + remainingMs).toISOString(),
        frameAt: frameAt ?? current.progress?.frameAt ?? null,
      };
    });
  }

  private async intent(
    session: WarmingSession,
    action: Action,
    url: string,
    signal: AbortSignal,
    text: string | null = null,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.change(session, (current) => {
      signal.throwIfAborted();
      if (current.status !== 'running') throw new Error('Sessão interrompida.');
      const key = `${action}:${url}`;
      if (current.seen.includes(key))
        throw new Error('Esta ação já foi tentada neste vídeo. Confira o histórico.');
      if (current.seen.filter((item) => item.startsWith('views:')).length >= 5000)
        throw new Error('Histórico de 5.000 vídeos atingido.');
      current.seen.push(key);
      current.history.unshift({
        at: new Date().toISOString(),
        action: null,
        ...(text === null ? {} : { text }),
        url,
        message: `Iniciando ${{ views: 'reprodução do vídeo', likes: 'curtida no vídeo', comments: 'comentário', commentLikes: 'curtida no comentário', replies: 'resposta' }[action]}. Se houver interrupção, confira a rede; esta tentativa não será repetida.`,
      });
      current.history = current.history.slice(0, 100);
    });
  }

  private async record(
    session: WarmingSession,
    action: Action,
    url: string,
    message: string,
  ): Promise<void> {
    await this.change(session, (current) => {
      current.counts[action] += 1;
      current.history.unshift({ at: new Date().toISOString(), action, url, message });
      current.history = current.history.slice(0, 100);
    });
  }

  private async attention(session: WarmingSession, message: string): Promise<void> {
    await this.change(session, (current) => {
      if (current.status !== 'running') return;
      current.status = 'attention';
      if (current.progress) {
        current.progress.stage = 'attention';
        current.progress.until = null;
      }
      current.message = message;
      current.history.unshift({ at: new Date().toISOString(), action: null, url: null, message });
      current.history = current.history.slice(0, 100);
    });
  }

  private async change(
    session: WarmingSession,
    work: (current: WarmingSession) => void,
  ): Promise<void> {
    await this.store.update((sessions) => {
      const current = sessions.find(
        (item) => item.account === session.account && item.platform === session.platform,
      );
      if (current !== undefined) work(current);
    });
  }
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = (): void => {
      reject(new Error('Sessão interrompida.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
