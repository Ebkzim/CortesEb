'use client';

import { useEffect, useRef, useState } from 'react';
import {
  UserRoundPlus,
  UserRoundMinus,
  X,
  ChevronDown,
  Play,
  Square,
  Activity,
  Settings2,
  Search,
  ExternalLink,
  Shuffle,
} from 'lucide-react';
import { api, post } from '@/lib/api';
import { Button } from './ui';
import { useToast } from './toast';
import { DESK_REQUIRED_EVENT } from './desk-watcher';
import { CompactSelect } from './compact-select';
import { TimingField, type TimeRange } from './timing-field';

interface Config {
  mode: 'follow' | 'unfollow';
  goal: number;
  interval: TimeRange;
  verificationMode: 'browser' | 'panel';
  searchMode: 'economy' | 'standard';
}
interface Session {
  account: string;
  config: Config;
  status: 'running' | 'stopped' | 'completed' | 'attention';
  counts: { follow: number; requested: number; unfollow: number };
  nextAt: string;
  message: string;
  lastIntervalSeconds: number | null;
  progress: { stage: string; username: string | null; until: string | null };
  pendingCount: number;
  history: { at: string; username: string | null; message: string }[];
}
const DEFAULTS: Config = {
  mode: 'follow',
  goal: 10,
  interval: { minSeconds: 30, maxSeconds: 90 },
  verificationMode: 'browser',
  searchMode: 'economy',
};
const STATUS = {
  running: 'Em execução',
  stopped: 'Parado',
  completed: 'Concluído',
  attention: 'Precisa de atenção',
};
const STAGES: Record<string, string> = {
  queued: 'Aguardando navegador',
  opening: 'Abrindo Instagram',
  discovering: 'Procurando perfis',
  checking: 'Conferindo perfil',
  acting: 'Enviando e confirmando',
  verification: 'Aguardando sua verificação',
  waiting: 'Intervalo entre ações',
  completed: 'Meta concluída',
  stopped: 'Parado',
  attention: 'Precisa de atenção',
};
const drafts = new Map<string, Config>();
let snapshot: Session[] = [];
let failure: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let fetching = false;
let revision = 0;
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
async function refresh() {
  if (fetching || document.visibilityState !== 'visible') return;
  const version = revision;
  fetching = true;
  try {
    const next = await api<Session[]>('/following');
    if (version === revision) {
      snapshot = next;
      failure = null;
    }
  } catch (error) {
    if (version === revision)
      failure = error instanceof Error ? error.message : 'Não consegui carregar as sessões.';
  } finally {
    fetching = false;
    emit();
  }
}
function resume() {
  void refresh();
}
export function useFollowingSessions() {
  const [state, setState] = useState({ sessions: snapshot, error: failure });
  useEffect(() => {
    const listener = () => setState({ sessions: snapshot, error: failure });
    listeners.add(listener);
    listener();
    if (!timer) {
      document.addEventListener('visibilitychange', resume);
      void refresh();
      timer = setInterval(resume, 2000);
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        clearInterval(timer);
        timer = undefined;
        document.removeEventListener('visibilitychange', resume);
      }
    };
  }, []);
  return state;
}

export function FollowingPanel({
  account,
  connected,
  connecting,
  onConnect,
}: {
  account: string;
  connected: boolean;
  connecting: boolean;
  onConnect: () => void;
}) {
  const { sessions, error } = useFollowingSessions();
  const toast = useToast();
  const session = sessions.find((item) => item.account === account);
  const [config, setConfig] = useState<Config>(() => drafts.get(account) ?? DEFAULTS);
  const [dirty, setDirty] = useState(() => drafts.has(account));
  const settings = dirty ? config : (session?.config ?? config);
  const running = session?.status === 'running';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'settings' | 'activity'>('settings');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = running || busy;
  const stage = running ? session.progress.stage : session?.status;
  const seconds = session?.progress.until
    ? Math.max(0, Math.ceil((Date.parse(session.progress.until) - now) / 1000))
    : 0;
  const queued = running && session.progress.stage === 'waiting' && seconds === 0;
  const title = queued
    ? 'Aguardando a vez no navegador'
    : (STAGES[stage ?? ''] ?? 'Pronto para começar');
  const completed = session
    ? session.config.mode === 'follow'
      ? session.counts.follow + session.counts.requested
      : session.counts.unfollow
    : 0;
  const pending = session?.pendingCount ?? 0;
  const history = (session?.history ?? []).filter((e) =>
    `${e.username ?? ''} ${e.message}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => setOpen(false);
    window.addEventListener(DESK_REQUIRED_EVENT, close);
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      window.removeEventListener(DESK_REQUIRED_EVENT, close);
    };
  }, [open]);
  useEffect(() => {
    if (running) setTab('activity');
  }, [running]);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [running]);
  useEffect(() => {
    const body = dialog.current?.querySelector('.warming-dialog__body');
    if (body) body.scrollTop = 0;
  }, [tab]);
  function change(patch: Partial<Config>) {
    const next = { ...settings, ...patch };
    setConfig(next);
    setDirty(true);
    drafts.set(account, next);
  }
  async function act(action: 'start' | 'stop') {
    setBusy(true);
    try {
      const next = await post<Session>(
        `/following/${account}/${action}`,
        action === 'start' ? settings : {},
      );
      revision++;
      snapshot = [...snapshot.filter((item) => item.account !== account), next];
      failure = null;
      emit();
      setDirty(false);
      drafts.delete(account);
      if (action === 'start') setTab('activity');
      toast(action === 'start' ? 'Sessão de seguidores iniciada.' : 'Parando a sessão.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Não consegui atualizar a sessão.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="warming following">
      <button
        className="warming__toggle"
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setTab(session ? 'activity' : 'settings');
          setOpen(true);
        }}
      >
        <span>
          <UserRoundPlus size={15} /> Seguidores
        </span>
        <span className={`warming__status warming__status--${session?.status ?? 'idle'}`}>
          {session ? (running ? title : STATUS[session.status]) : 'Configurar'}
          <ChevronDown size={14} />
        </span>
      </button>
      {session && (
        <div className="warming__mini">
          <span>
            {session.config.mode === 'follow' ? 'Seguir' : 'Deixar de seguir'} · {completed}/
            {session.config.goal}
          </span>
          {running && seconds > 0 && <span>Próxima ação em {seconds}s</span>}
          {pending > 0 && <span>{pending} sem confirmação</span>}
        </div>
      )}
      <dialog
        ref={dialog}
        className="warming-dialog following-dialog"
        aria-labelledby={`following-title-${account}`}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            setOpen(false);
        }}
      >
        {open && (
          <>
            <header className="warming-dialog__header">
              <div className="warming-dialog__identity">
                <span className="warming-dialog__icon">
                  <UserRoundPlus size={18} />
                </span>
                <div>
                  <h2 id={`following-title-${account}`}>Seguidores</h2>
                  <p>
                    Instagram <span>·</span> {account}
                  </p>
                </div>
              </div>
              <div className="warming-dialog__actions">
                <span className={`warming-badge warming-badge--${session?.status ?? 'idle'}`}>
                  {session ? STATUS[session.status] : 'Configurar'}
                </span>
                <button
                  className="warming-icon"
                  type="button"
                  aria-label="Fechar seguidores"
                  onClick={() => setOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="warming-dialog__toolbar">
              <div className="warming__tabs" role="tablist" aria-label="Seguidores">
                {(
                  [
                    ['settings', 'Configurar', Settings2],
                    ['activity', 'Atividade', Activity],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    aria-controls={`following-tab-${account}`}
                    onClick={() => setTab(value)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="small"
                variant={running ? 'light' : 'dark'}
                lead={running ? <Square /> : <Play />}
                disabled={busy || (!running && (!connected || connecting || error !== null))}
                onClick={() => {
                  void act(running ? 'stop' : 'start');
                }}
              >
                {busy ? 'Aguarde…' : running ? 'Parar' : 'Iniciar'}
              </Button>
            </div>
            <div
              className="warming-dialog__body"
              role="tabpanel"
              id={`following-tab-${account}`}
              aria-label={tab === 'settings' ? 'Configurar seguidores' : 'Atividade de seguidores'}
            >
              {error && (
                <p className="warming-alert" role="alert">
                  {error}
                </p>
              )}
              {tab === 'settings' ? (
                <div className="following-setup">
                  <fieldset className="following-modes" disabled={locked}>
                    <legend>Uma ação por sessão</legend>
                    <div role="group" aria-label="Ação de seguidores">
                      {(
                        [
                          {
                            value: 'follow',
                            label: 'Seguir',
                            detail: 'Perfis aleatórios dos comentários de Reels',
                            Icon: UserRoundPlus,
                          },
                          {
                            value: 'unfollow',
                            label: 'Deixar de seguir',
                            detail: 'Quem esta conta segue e não segue de volta',
                            Icon: UserRoundMinus,
                          },
                        ] as const
                      ).map(({ value, label, detail, Icon }) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={settings.mode === value}
                          onClick={() => change({ mode: value })}
                        >
                          <Icon size={18} />
                          <span>
                            <strong>{label}</strong>
                            <small>{detail}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="following-controls">
                    <label className="field">
                      <span className="field__label">Quantidade nesta sessão</span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={1000}
                        value={settings.goal}
                        disabled={locked}
                        onChange={(e) =>
                          change({
                            goal: Math.max(1, Math.min(1000, Math.round(Number(e.target.value)))),
                          })
                        }
                      />
                      <small className="warming-note">
                        {settings.mode === 'follow'
                          ? 'Inclui solicitações enviadas a perfis privados.'
                          : 'A reciprocidade é conferida antes de cada remoção.'}
                      </small>
                    </label>
                    <TimingField
                      label="Intervalo entre ações"
                      value={60}
                      range={settings.interval}
                      min={10}
                      max={3600}
                      disabled={locked}
                      alwaysRandom
                      onChange={(_, interval) => {
                        if (interval) change({ interval });
                      }}
                    />
                  </div>
                  <div className="following-preferences">
                    <CompactSelect
                      label="Desempenho"
                      value={settings.searchMode}
                      disabled={locked}
                      onChange={(value) => change({ searchMode: value as Config['searchMode'] })}
                      options={[
                        { value: 'economy', label: 'Econômico', detail: 'PC mais fraco' },
                        { value: 'standard', label: 'Padrão', detail: 'Busca mais frequente' },
                      ]}
                    />
                    <CompactSelect
                      label="Verificações"
                      value={settings.verificationMode}
                      disabled={locked}
                      onChange={(value) =>
                        change({ verificationMode: value as Config['verificationMode'] })
                      }
                      options={[
                        { value: 'browser', label: 'No Chrome', detail: 'Menor uso de recursos' },
                        { value: 'panel', label: 'No painel', detail: 'Tela interativa' },
                      ]}
                    />
                  </div>
                  <p className="following-hint">
                    <Shuffle size={15} />
                    <span>
                      O cronômetro é próprio desta sessão e começa após a ação anterior. Aquecimento
                      e publicações compartilham o navegador; uma ação pode aguardar a vez.
                    </span>
                  </p>
                </div>
              ) : (
                <div className="warming-monitor">
                  <div
                    className={`warming-live warming-live--${session?.status ?? 'idle'}`}
                    role="status"
                  >
                    <span
                      className={
                        running ? 'warming-live__dot warming-live__dot--on' : 'warming-live__dot'
                      }
                    />
                    <div>
                      <strong>{title}</strong>
                      <p>
                        {queued
                          ? 'O intervalo terminou. A sessão retoma quando o navegador estiver disponível.'
                          : (session?.message ??
                            'Inicie uma sessão para acompanhar os perfis aqui.')}
                      </p>
                    </div>
                    {running && seconds > 0 && (
                      <span className="warming-live__time">{seconds}s</span>
                    )}
                  </div>
                  {session && (
                    <>
                      <div className="following-progress">
                        <div>
                          <span>
                            {session.config.mode === 'follow' ? 'Seguir' : 'Deixar de seguir'}
                          </span>
                          <strong>
                            {completed}
                            <small> / {session.config.goal}</small>
                          </strong>
                        </div>
                        <progress
                          aria-label="Meta de seguidores"
                          max={session.config.goal}
                          value={completed}
                        />
                        <p>
                          {session.config.mode === 'follow'
                            ? `${session.counts.follow} seguindo · ${session.counts.requested} solicitações enviadas`
                            : `${session.counts.unfollow} remoções confirmadas`}
                          {session.lastIntervalSeconds !== null
                            ? ` · último intervalo: ${session.lastIntervalSeconds}s`
                            : ''}
                        </p>
                      </div>
                      {pending > 0 && (
                        <p className="warming-note">
                          {pending} tentativa(s) sem confirmação. Não entram na meta nem são
                          repetidas automaticamente.
                        </p>
                      )}
                    </>
                  )}
                  <section className="following-history">
                    <header>
                      <h3>Histórico de perfis</h3>
                      <label>
                        <Search size={14} />
                        <input
                          className="input"
                          aria-label="Buscar no histórico de seguidores"
                          placeholder="Buscar perfil ou ação"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </header>
                    <div className="following-history__list">
                      {history.length ? (
                        history.map((event, index) => (
                          <div className="following-event" key={`${event.at}-${index}`}>
                            <time dateTime={event.at}>
                              {new Date(event.at).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </time>
                            <div>
                              {event.username && (
                                <a
                                  href={`https://www.instagram.com/${event.username}/`}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  @{event.username}
                                  <ExternalLink size={11} />
                                </a>
                              )}
                              <p>{event.message}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="warming-note">
                          {query
                            ? 'Nenhum evento corresponde à busca.'
                            : 'As ações e conferências aparecerão aqui.'}
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </div>
            <footer className="warming-dialog__footer">
              <span>
                {connected
                  ? 'Sessão do Instagram conectada'
                  : 'Conecte o Instagram pelo navegador para iniciar'}
              </span>
              {!connected && (
                <button type="button" disabled={connecting || busy} onClick={onConnect}>
                  Conectar
                </button>
              )}
              {tab === 'activity' && (
                <button type="button" onClick={() => setTab('settings')}>
                  Configurar sessão
                </button>
              )}
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
