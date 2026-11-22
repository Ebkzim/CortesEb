import { Injectable } from '@nestjs/common';
import { AccountService } from '../accounts/account.service.js';
import { BrowserSessions } from '../browser/browser-sessions.js';
import { LoginWindows } from '../browser/login-windows.js';
import { AppError } from '../common/app-error.js';
import { QueueStore } from '../publish/queue-store.js';
import { WarmingBrowser } from '../warming/warming-browser.js';
import { WarmingDesk } from '../warming/warming-desk.js';
import { sampleSeconds } from '../warming/timing.js';
import { FollowingStore } from './following-store.js';
import { achieved, followingConfigSchema, type FollowingSession } from './following-state.js';
import { InstagramFollowingBrowser } from './instagram-following.js';

@Injectable()
export class FollowingService {
  private enabled = false;
  private active: { account: string; controller: AbortController } | null = null;
  constructor(
    private readonly accounts: AccountService,
    private readonly sessions: BrowserSessions,
    private readonly logins: LoginWindows,
    private readonly queue: QueueStore,
    private readonly warming: WarmingBrowser,
    private readonly browser: InstagramFollowingBrowser,
    private readonly store: FollowingStore,
    private readonly desk: WarmingDesk,
  ) {}

  async initialize(): Promise<void> {
    await this.reset('O serviço foi reiniciado. Confira o histórico antes de continuar.');
    this.enabled = true;
  }
  cancel(): void {
    this.active?.controller.abort();
  }
  async shutdown(): Promise<void> {
    this.enabled = false;
    this.cancel();
    await this.reset('Serviço encerrado. Inicie para continuar.');
  }
  list(): Promise<FollowingSession[]> {
    return this.store.list();
  }

  async start(account: string, input: unknown): Promise<FollowingSession> {
    if (!this.enabled)
      throw new AppError('PROCESS_FAILED', 'Outra instância está gerenciando as sessões.');
    const parsed = followingConfigSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        'INVALID_INPUT',
        parsed.error.issues[0]?.message ?? 'configuração inválida',
      );
    if (!(await this.accounts.list()).some((item) => item.id === account))
      throw new AppError('INVALID_INPUT', 'conta não cadastrada');
    const profile = (await this.sessions.profiles()).find(
      (item) => item.account === account && item.platform === 'instagram',
    );
    if (profile?.connected !== true)
      throw new AppError('NOT_CONFIGURED', 'Conecte o Instagram pelo navegador antes de iniciar.');
    if (this.loginBusy(account))
      throw new AppError(
        'INVALID_INPUT',
        'Conclua o login e feche a janela do Chrome antes de iniciar.',
      );
    return this.store.update((sessions) => {
      const previous = sessions.find((item) => item.account === account);
      if (previous?.status === 'running' || this.active?.account === account)
        throw new AppError(
          'INVALID_INPUT',
          'Pare a sessão e aguarde o encerramento antes de trocar de modo.',
        );
      if ((previous?.ledger.length ?? 0) >= 5000)
        throw new AppError(
          'INVALID_INPUT',
          'O histórico atingiu 5.000 ações. Revise a conta antes de continuar.',
        );
      const resume =
        previous && previous.status !== 'completed' && previous.config.mode === parsed.data.mode;
      const now = new Date().toISOString();
      const session: FollowingSession = {
        account,
        platform: 'instagram',
        config: parsed.data,
        status: 'running',
        counts: resume ? previous.counts : { follow: 0, requested: 0, unfollow: 0 },
        startedAt: resume ? previous.startedAt : now,
        nextAt: now,
        message: 'Aguardando a vez no navegador.',
        progress: { stage: 'queued', username: null, until: null },
        lastIntervalSeconds: previous?.lastIntervalSeconds ?? null,
        candidates: [],
        checked: [],
        reels: previous?.reels ?? [],
        ledger: previous?.ledger ?? [],
        history: previous?.history ?? [],
      };
      if (previous) sessions[sessions.indexOf(previous)] = session;
      else sessions.push(session);
      return session;
    });
  }
  async stop(account: string): Promise<FollowingSession> {
    if (this.active?.account === account) {
      this.desk.cancel();
      this.cancel();
    }
    return this.store.update((sessions) => {
      const session = sessions.find((item) => item.account === account);
      if (!session) throw new AppError('INVALID_INPUT', 'Nenhuma sessão nesta conta.');
      session.status = 'stopped';
      session.progress = { ...session.progress, stage: 'stopped', until: null };
      session.message = 'Parado. Uma ação enviada à rede pode aparecer após o encerramento.';
      return session;
    });
  }
  async due(): Promise<FollowingSession | undefined> {
    if (!this.enabled) return undefined;
    return (await this.list())
      .filter((s) => s.status === 'running' && Date.parse(s.nextAt) <= Date.now())
      .sort((a, b) => a.nextAt.localeCompare(b.nextAt))[0];
  }

  async run(session: FollowingSession): Promise<void> {
    if (!this.enabled) return;
    const controller = new AbortController();
    this.active = { account: session.account, controller };
    const signal = controller.signal;
    try {
      const current = (await this.list()).find((item) => item.account === session.account);
      if (current?.status !== 'running') return;
      if (achieved(current) >= current.config.goal) {
        await this.finish(session);
        return;
      }
      const profile = (await this.sessions.profiles()).find(
        (item) => item.account === session.account && item.platform === 'instagram',
      );
      if (
        profile?.connected !== true ||
        !(await this.accounts.list()).some((item) => item.id === session.account)
      )
        throw new Error('Conta removida ou Instagram desconectado. Reconecte antes de continuar.');
      const publishing = (await this.queue.list()).some(
        (job) =>
          job.account === session.account &&
          job.platform === 'instagram' &&
          (job.status === 'publishing' ||
            (job.status === 'approved' &&
              Date.parse(job.scheduledAt ?? job.createdAt) <= Date.now())),
      );
      if (publishing || this.loginBusy(session.account)) {
        await this.change(session, (s) => {
          s.nextAt = new Date(Date.now() + 30_000).toISOString();
          s.progress = { ...s.progress, stage: 'queued', until: s.nextAt };
          s.message = publishing
            ? 'Aguardando a publicação desta conta.'
            : 'Aguardando a janela de login fechar.';
        });
        return;
      }
      await this.progress(
        session,
        'opening',
        'Abrindo o Instagram e confirmando a conta conectada.',
      );
      await this.sessions.with(
        'instagram',
        session.account,
        async (page, context) => {
          this.warming.observeVerification(
            page,
            session.account,
            (waiting) =>
              this.progress(
                session,
                waiting ? 'verification' : 'checking',
                waiting
                  ? 'Resolva a verificação na janela de verificação. A sessão está pausada.'
                  : 'Verificação resolvida. Continuando.',
              ),
            signal,
            session.config.verificationMode,
          );
          await this.warming.clear('instagram', page, context);
          const self = await this.browser.self(page, context, profile.handle);
          for (let attempt = 0; attempt < 20; attempt++) {
            signal.throwIfAborted();
            const latest = (await this.list()).find((item) => item.account === session.account);
            if (!latest || latest.status !== 'running') return;
            if (latest.candidates.length === 0) {
              const found = await this.browser.discover(
                page,
                context,
                latest,
                self,
                (stage, message, username) => this.progress(session, stage, message, username),
                signal,
              );
              await this.change(session, (s) => {
                s.candidates = found.usernames.filter(
                  (name) =>
                    name !== self &&
                    !s.checked.includes(name) &&
                    !s.ledger.some(
                      (e) =>
                        e.mode === s.config.mode && e.username === name && e.state === 'pending',
                    ),
                );
                if (found.reel) s.reels = [...new Set([...s.reels, found.reel])].slice(-5000);
              });
              if (!found.usernames.length)
                throw new Error('Nenhum perfil novo disponível neste ciclo.');
            }
            const candidate = (await this.list()).find((s) => s.account === session.account)
              ?.candidates[0];
            if (!candidate) continue;
            await this.change(session, (s) => {
              s.candidates = s.candidates.filter((name) => name !== candidate);
              s.checked.push(candidate);
            });
            if (candidate === self) continue;
            let checkedAt: string | null = null;
            if (session.config.mode === 'unfollow') {
              await this.progress(
                session,
                'checking',
                `Conferindo se @${candidate} segue esta conta de volta.`,
                candidate,
              );
              const membership = await this.browser.membership(
                page,
                context,
                self,
                candidate,
                signal,
              );
              if (membership !== 'no') {
                await this.note(
                  session,
                  candidate,
                  membership === 'yes'
                    ? 'Segue a conta de volta; mantido.'
                    : 'Não foi possível confirmar a reciprocidade; mantido.',
                );
                continue;
              }
              checkedAt = new Date().toISOString();
            }
            await this.progress(
              session,
              'checking',
              `Abrindo @${candidate} e conferindo o vínculo atual.`,
              candidate,
            );
            const target = await this.browser.profile(page, context, candidate);
            if (target.relation !== (session.config.mode === 'follow' ? 'follow' : 'following')) {
              await this.note(
                session,
                candidate,
                target.relation === 'requested'
                  ? 'Já existe uma solicitação pendente; ignorado.'
                  : 'O perfil não precisa desta ação; ignorado.',
              );
              continue;
            }
            signal.throwIfAborted();
            await this.change(session, (s) => {
              signal.throwIfAborted();
              if (s.status !== 'running') throw new Error('Sessão interrompida.');
              if (
                s.ledger.some(
                  (e) =>
                    e.username === candidate && e.mode === s.config.mode && e.state === 'pending',
                )
              )
                throw new Error('Esta ação já foi tentada neste perfil; confira o histórico.');
              if (s.ledger.length >= 5000) throw new Error('Histórico de 5.000 ações atingido.');
              s.ledger.push({
                username: candidate,
                mode: s.config.mode,
                state: 'pending',
                at: new Date().toISOString(),
                checkedAt,
              });
              this.addNote(
                s,
                candidate,
                'Enviando a ação. Uma tentativa sem confirmação não será repetida automaticamente.',
              );
            });
            await this.progress(
              session,
              'acting',
              session.config.mode === 'follow'
                ? `Seguindo @${candidate} e aguardando confirmação.`
                : `Deixando de seguir @${candidate} após conferir a reciprocidade.`,
              candidate,
            );
            signal.throwIfAborted();
            const result = await this.browser.perform(
              page,
              context,
              target.header,
              session.config.mode,
              signal,
            );
            await this.change(session, (s) => {
              const entry = s.ledger.find(
                (e) =>
                  e.username === candidate &&
                  e.mode === session.config.mode &&
                  e.state === 'pending',
              );
              if (!entry) throw new Error('Tentativa não encontrada no histórico.');
              entry.state = result;
              s.counts[
                result === 'requested'
                  ? 'requested'
                  : result === 'following'
                    ? 'follow'
                    : 'unfollow'
              ] += 1;
              this.addNote(
                s,
                candidate,
                result === 'requested'
                  ? 'Solicitação enviada a perfil privado.'
                  : result === 'following'
                    ? 'Seguindo: confirmado pela página.'
                    : 'Deixou de seguir: confirmado pela página.',
              );
            });
            return;
          }
          throw new Error(
            'Os perfis consultados não tiveram uma ação elegível confirmada. Confira o histórico antes de continuar.',
          );
        },
        signal,
        { visible: session.config.verificationMode === 'browser' },
      );
      await this.change(session, (s) => {
        if (s.status !== 'running') return;
        if (achieved(s) >= s.config.goal) {
          this.completed(s);
          return;
        }
        const seconds = sampleSeconds(60, s.config.interval, s.lastIntervalSeconds);
        s.lastIntervalSeconds = seconds;
        s.nextAt = new Date(Date.now() + seconds * 1000).toISOString();
        s.progress = { ...s.progress, stage: 'waiting', until: s.nextAt };
        s.message = `Próxima ação em ${seconds}s. O intervalo é sorteado após cada ação.`;
      });
    } catch (error) {
      if (!signal.aborted)
        await this.change(session, (s) => {
          if (s.status !== 'running') return;
          s.status = 'attention';
          s.message =
            error instanceof Error
              ? (error.message.split('\n')[0] ?? 'Erro na navegação.').slice(0, 500)
              : 'Erro na navegação.';
          s.progress = { ...s.progress, stage: 'attention', until: null };
          this.addNote(s, s.progress.username, s.message);
        });
    } finally {
      this.active = null;
    }
  }

  private loginBusy(account: string): boolean {
    return this.logins
      .list()
      .some(
        (item) =>
          item.account === account &&
          item.platform === 'instagram' &&
          ['open', 'checking'].includes(item.phase),
      );
  }
  private async reset(message: string): Promise<void> {
    await this.store.update((sessions) => {
      for (const s of sessions)
        if (s.status === 'running') {
          s.status = 'stopped';
          s.message = message;
          s.progress = { ...s.progress, stage: 'stopped', until: null };
        }
    });
  }
  private completed(s: FollowingSession): void {
    s.status = 'completed';
    s.message = 'Quantidade selecionada concluída.';
    s.progress = { ...s.progress, stage: 'completed', until: null };
  }
  private finish(session: FollowingSession): Promise<void> {
    return this.change(session, (s) => {
      if (s.status === 'running') this.completed(s);
    });
  }
  private progress(
    session: FollowingSession,
    stage: string,
    message: string,
    username?: string,
  ): Promise<void> {
    return this.change(session, (s) => {
      if (s.status !== 'running') return;
      s.message = message;
      s.progress = { stage, username: username ?? s.progress.username, until: null };
    });
  }
  private addNote(s: FollowingSession, username: string | null, message: string): void {
    s.history.unshift({ at: new Date().toISOString(), username, message });
    s.history = s.history.slice(0, 100);
  }
  private note(session: FollowingSession, username: string, message: string): Promise<void> {
    return this.change(session, (s) => {
      this.addNote(s, username, message);
    });
  }
  private async change(
    session: FollowingSession,
    work: (current: FollowingSession) => void,
  ): Promise<void> {
    await this.store.update((sessions) => {
      const current = sessions.find((s) => s.account === session.account);
      if (current) work(current);
    });
  }
}
