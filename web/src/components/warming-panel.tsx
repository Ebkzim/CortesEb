'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Flame,
  Play,
  Square,
  ChevronDown,
  Activity,
  Settings2,
  ExternalLink,
  X,
  Check,
  Minus,
  Plus,
  Leaf,
  Monitor,
  Eye,
  Heart,
  MessageCircle,
  Reply,
  Maximize2,
  Search,
  Copy,
} from 'lucide-react';
import { TimingField, type TimeRange } from './timing-field';
import { api, post } from '@/lib/api';
import type { ApiKeyView, PublishPlatform } from '@/lib/types';
import { Button } from './ui';
import { CompactSelect } from './compact-select';
import { DESK_REQUIRED_EVENT } from './desk-watcher';
import { useToast } from './toast';

type Action = 'views' | 'likes' | 'comments' | 'commentLikes' | 'replies';
type Counts = Record<Action, number>;
interface Config {
  searchMode: 'economy' | 'standard';
  verificationMode: 'browser' | 'panel';
  ai: { source: 'configured' | 'ollama' | 'key'; keyId: string | null; model: string };
  mode: 'goals' | 'continuous';
  goals: Counts;
  watchSeconds: number;
  watchRange: TimeRange | null;
  intervalRange: TimeRange | null;
  intervalSeconds: number;
  guidance: string;
}
interface Session {
  account: string;
  platform: PublishPlatform;
  config: Config;
  status: 'running' | 'stopped' | 'completed' | 'attention';
  counts: Counts;
  message: string | null;
  nextAt: string;
  progress?: {
    stage: string;
    updatedAt: string;
    videoUrl: string | null;
    until: string | null;
    frameAt: string | null;
  };
  history: { at: string; action: Action | null; message: string; url: string | null }[];
}
const LABELS: Record<Action, string> = {
  views: 'Vídeos para assistir',
  likes: 'Curtidas em vídeos',
  comments: 'Comentários com IA',
  commentLikes: 'Curtidas em comentários',
  replies: 'Respostas com IA',
};
const STATUS = {
  running: 'Em execução',
  stopped: 'Parado',
  completed: 'Concluído',
  attention: 'Precisa de atenção',
};
const DEFAULTS: Config = {
  searchMode: 'economy',
  verificationMode: 'browser',
  ai: { source: 'ollama', keyId: null, model: 'qwen2.5:3b-instruct' },
  mode: 'goals',
  goals: { views: 10, likes: 3, comments: 0, commentLikes: 0, replies: 0 },
  watchSeconds: 15,
  watchRange: null,
  intervalRange: null,
  intervalSeconds: 60,
  guidance: 'Escreva em português, de forma breve e natural.',
};

let snapshot: Session[] = [];
let failure: string | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let loading = false;
let revision = 0;
const drafts = new Map<string, Config>();
async function refresh(): Promise<void> {
  if (loading || document.visibilityState !== 'visible') return;
  loading = true;
  const version = revision;
  try {
    const received = await api<Session[]>('/warming');
    if (version === revision) snapshot = received;
    failure = null;
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Não consegui carregar as sessões.';
  } finally {
    loading = false;
    for (const listener of listeners) listener();
  }
}

function resumeRefresh(): void {
  void refresh();
}

export function useWarmingSessions() {
  const [sessions, setSessions] = useState(snapshot);
  const [error, setError] = useState(failure);
  useEffect(() => {
    const listener = (): void => {
      setSessions(snapshot);
      setError(failure);
    };
    listeners.add(listener);
    listener();
    if (timer === undefined) {
      document.addEventListener('visibilitychange', resumeRefresh);
      void refresh();
      timer = setInterval(() => {
        void refresh();
      }, 2000);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', resumeRefresh);
        timer = undefined;
      }
    };
  }, []);
  return { sessions, error };
}

export function WarmingPanel({
  account,
  platform,
  connected,
  connecting,
  onConnect,
  onDisconnect,
}: {
  account: string;
  platform: PublishPlatform;
  connected: boolean;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect?: () => void;
}) {
  const toast = useToast();
  const { sessions, error } = useWarmingSessions();
  const draftKey = `${account}:${platform}`;
  const [config, setConfig] = useState<Config>(() => drafts.get(draftKey) ?? DEFAULTS);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'activity' | 'settings' | 'preferences'>('settings');
  const dialog = useRef<HTMLDialogElement>(null);
  const [logFilter, setLogFilter] = useState('all');
  const [logQuery, setLogQuery] = useState('');
  const [frameError, setFrameError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(() => drafts.has(draftKey));
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const session = sessions.find((item) => item.account === account && item.platform === platform);
  const running = session?.status === 'running';
  const stored = dirty ? config : (session?.config ?? config);
  const settings: Config = {
    ...DEFAULTS,
    ...stored,
    goals: { ...stored.goals, ...(platform === 'tiktok' ? { commentLikes: 0 } : {}) },
  };
  const actions = (Object.keys(LABELS) as Action[]).filter(
    (action) => !(platform === 'tiktok' && action === 'commentLikes'),
  );
  const hasAI = settings.goals.comments > 0 || settings.goals.replies > 0;
  const locked = running || busy;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      element.showModal();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        element.close();
        document.body.style.overflow = overflow;
      };
    }
  }, [open]);

  useEffect(() => {
    const body = dialog.current?.querySelector('.warming-dialog__body');
    if (body) body.scrollTop = 0;
  }, [tab]);

  useEffect(() => {
    if (!open) return;
    const showVerification = (): void => setOpen(false);
    window.addEventListener(DESK_REQUIRED_EVENT, showVerification);
    return () => window.removeEventListener(DESK_REQUIRED_EVENT, showVerification);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'preferences' || !hasAI) return;
    let mounted = true;
    void api<ApiKeyView[]>('/keys')
      .then((items) => {
        if (mounted) {
          setKeys(items);
          setAiError(null);
        }
      })
      .catch((caught: unknown) => {
        if (mounted)
          setAiError(caught instanceof Error ? caught.message : 'Não consegui carregar as chaves.');
      });
    return () => {
      mounted = false;
    };
  }, [open, tab, hasAI]);

  useEffect(() => {
    if (running) {
      setNow(Date.now());
      setTab('activity');
    }
  }, [running]);
  useEffect(() => {
    if (!running || !open) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [running, open]);
  const stage =
    session?.status === 'running' ? (session.progress?.stage ?? 'queued') : session?.status;
  const stageLabel =
    (
      {
        queued: 'Na fila',
        opening: 'Abrindo o navegador',
        verification: 'Aguardando sua verificação',
        searching: 'Procurando vídeo',
        preparing: 'Preparando interação',
        watching: 'Assistindo ao vídeo',
        generating: 'Gerando texto com IA',
        acting: 'Enviando e confirmando',
        confirmed: 'Ação confirmada',
        skipped: 'Vídeo sem interação disponível',
        waiting: 'Intervalo entre vídeos',
        attention: 'Precisa de atenção',
        completed: 'Metas concluídas',
        stopped: 'Parado',
      } as Record<string, string>
    )[stage ?? ''] ?? 'Pronto para começar';
  const deadline = session?.progress?.until;
  const seconds = deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : 0;

  function change(patch: Partial<Config>): void {
    const next = { ...settings, ...patch };
    drafts.set(draftKey, next);
    setConfig(next);
    setDirty(true);
  }
  async function resolveVerification(): Promise<void> {
    setBusy(true);
    try {
      const next = await post<Session>(`/warming/${account}/${platform}/resolve`);
      revision += 1;
      snapshot = [
        ...snapshot.filter((item) => item.account !== account || item.platform !== platform),
        next,
      ];
      for (const listener of listeners) listener();
      toast('Retomando a sessão. Resolva a verificação no modo escolhido em Configurar metas.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Não consegui abrir a verificação.');
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'start' | 'stop'): Promise<void> {
    setBusy(true);
    try {
      const next = await post<Session>(
        `/warming/${account}/${platform}/${action}`,
        action === 'start' ? settings : {},
      );
      revision += 1;
      snapshot = [
        ...snapshot.filter((item) => item.account !== account || item.platform !== platform),
        next,
      ];
      for (const listener of listeners) listener();
      setDirty(false);
      drafts.delete(draftKey);
      if (action === 'start') setTab('activity');
      toast(action === 'start' ? 'Aquecimento iniciado.' : 'Parando o aquecimento.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Não consegui atualizar a sessão.');
    } finally {
      setBusy(false);
    }
  }

  const history = (session?.history ?? []).filter(
    (event) =>
      (logFilter === 'all' ||
        (logFilter === 'confirmed' ? event.action !== null : event.action === null)) &&
      event.message.toLocaleLowerCase().includes(logQuery.toLocaleLowerCase()),
  );
  const frameAt = session?.progress?.frameAt;
  const frameUrl = frameAt
    ? `/api/warming/${account}/${platform}/frame?v=${encodeURIComponent(frameAt)}`
    : null;
  const platformName = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' }[platform];
  const icons: Record<Action, ReactNode> = {
    views: <Eye size={15} />,
    likes: <Heart size={15} />,
    comments: <MessageCircle size={15} />,
    commentLikes: <Heart size={15} />,
    replies: <Reply size={15} />,
  };
  const shortLabels: Record<Action, string> = {
    views: 'Vídeos',
    likes: 'Curtidas',
    comments: 'Comentários',
    commentLikes: 'Curtir comentários',
    replies: 'Respostas',
  };

  return (
    <div className="warming">
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
          <Flame size={15} /> Aquecimento
        </span>
        <span className={`warming__status warming__status--${session?.status ?? 'idle'}`}>
          {running ? stageLabel : session ? STATUS[session.status] : 'Configurar'}
          <ChevronDown size={14} />
        </span>
      </button>
      {session && (
        <div className="warming__mini">
          <span>
            {session.counts.views} {session.counts.views === 1 ? 'vídeo' : 'vídeos'}
          </span>
          <span>
            {session.counts.likes} {session.counts.likes === 1 ? 'curtida' : 'curtidas'}
          </span>
          <span>
            {session.counts.comments + session.counts.replies}{' '}
            {session.counts.comments + session.counts.replies === 1 ? 'comentário' : 'comentários'}
          </span>
        </div>
      )}
      <dialog
        ref={dialog}
        className="warming-dialog"
        aria-labelledby={`warming-title-${account}-${platform}`}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            setOpen(false);
        }}
      >
        {open && (
          <>
            <header className="warming-dialog__header">
              <div className="warming-dialog__identity">
                <span className="warming-dialog__icon">
                  <Flame size={18} />
                </span>
                <div>
                  <h2 id={`warming-title-${account}-${platform}`}>Aquecimento</h2>
                  <p>
                    {platformName} <span>·</span> {account}
                  </p>
                </div>
              </div>
              <div className="warming-dialog__actions">
                <span className={`warming-badge warming-badge--${session?.status ?? 'idle'}`}>
                  {session ? STATUS[session.status] : 'Pronto para começar'}
                </span>
                <button
                  type="button"
                  className="warming-icon"
                  aria-label="Fechar aquecimento"
                  onClick={() => setOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="warming-dialog__toolbar">
              <div className="warming__tabs" role="tablist" aria-label="Aquecimento">
                {(
                  [
                    ['settings', 'Metas', <Settings2 size={14} />],
                    ['preferences', 'Preferências', <Leaf size={14} />],
                    ['activity', 'Atividade', <Activity size={14} />],
                  ] as const
                ).map(([value, label, icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    aria-controls={`warming-tab-${account}-${platform}`}
                    onClick={() => setTab(value)}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="small"
                variant={running ? 'light' : 'dark'}
                lead={running ? <Square /> : <Play />}
                disabled={
                  busy ||
                  (!running &&
                    (connecting ||
                      !connected ||
                      error !== null ||
                      !actions.some((action) => settings.goals[action] > 0)))
                }
                onClick={() => {
                  void act(running ? 'stop' : 'start');
                }}
              >
                {busy ? 'Aguarde…' : running ? 'Parar' : 'Iniciar'}
              </Button>
            </div>
            <div
              className="warming-dialog__body"
              id={`warming-tab-${account}-${platform}`}
              role="tabpanel"
              aria-label={
                { settings: 'Metas', preferences: 'Preferências', activity: 'Atividade' }[tab]
              }
            >
              {error && (
                <p className="warming-alert" role="alert">
                  {error}
                </p>
              )}
              {tab === 'settings' && (
                <div className="warming-setup">
                  <section className="warming-section">
                    <div className="warming-section__title">
                      <div>
                        <h3>O ritmo da conta</h3>
                        <p>Escolha quanto fazer em cada dia.</p>
                      </div>
                      <span className="warming-note">0 desativa a ação</span>
                    </div>
                    <div className="warming-goals">
                      {actions.map((action) => (
                        <div key={action} className="warming-goal">
                          <span className="warming-goal__label">
                            {icons[action]}
                            {shortLabels[action]}
                          </span>
                          <Stepper
                            label={LABELS[action]}
                            value={settings.goals[action]}
                            disabled={locked}
                            onChange={(value) =>
                              change({ goals: { ...settings.goals, [action]: value } })
                            }
                          />
                          <small>
                            {session?.counts[action] ?? 0}{' '}
                            {(session?.counts[action] ?? 0) === 1 ? 'feito' : 'feitos'} hoje
                          </small>
                        </div>
                      ))}
                    </div>
                    <div className="warming-timing">
                      <TimingField
                        label="Tempo por vídeo"
                        value={settings.watchSeconds}
                        range={settings.watchRange}
                        min={5}
                        max={120}
                        disabled={locked}
                        onChange={(watchSeconds, watchRange) =>
                          change({ watchSeconds, watchRange })
                        }
                      />
                      <TimingField
                        label="Intervalo entre vídeos"
                        value={settings.intervalSeconds}
                        range={settings.intervalRange}
                        min={10}
                        max={3600}
                        disabled={locked}
                        onChange={(intervalSeconds, intervalRange) =>
                          change({ intervalSeconds, intervalRange })
                        }
                      />
                    </div>
                  </section>
                  <aside className="warming-summary">
                    <span className="warming-eyebrow">Como vai funcionar</span>
                    <h3>
                      {settings.mode === 'goals' ? 'Concluir e descansar.' : 'Manter uma rotina.'}
                    </h3>
                    <p>
                      {settings.mode === 'goals'
                        ? 'A sessão termina quando todas as metas forem confirmadas.'
                        : 'As metas se renovam à meia-noite, enquanto o serviço estiver rodando.'}
                    </p>
                    <ChoicePair
                      label="Duração da sessão"
                      value={settings.mode}
                      disabled={locked}
                      onChange={(value) => change({ mode: value })}
                      options={[
                        { value: 'goals', label: 'Por metas', detail: 'Concluir e parar' },
                        { value: 'continuous', label: 'Contínuo', detail: 'Renovar a cada dia' },
                      ]}
                    />
                    <div className="warming-summary__foot">
                      <Leaf size={15} />
                      <span>
                        {settings.searchMode === 'economy' ? 'Busca econômica' : 'Busca padrão'}
                        <small>Ajuste em Preferências</small>
                      </span>
                    </div>
                  </aside>
                </div>
              )}
              {tab === 'preferences' && (
                <div className="warming-preferences">
                  <section className="warming-section">
                    <div className="warming-section__title">
                      <div>
                        <h3>Busca e desempenho</h3>
                        <p>Um ritmo que combina com seu computador.</p>
                      </div>
                    </div>
                    <ChoicePair
                      label="Modo de busca"
                      value={settings.searchMode}
                      disabled={locked}
                      onChange={(value) => change({ searchMode: value })}
                      options={[
                        {
                          value: 'economy',
                          label: 'Econômica',
                          detail: 'Para PCs mais fracos',
                          icon: <Leaf size={16} />,
                        },
                        {
                          value: 'standard',
                          label: 'Padrão',
                          detail: 'Para PCs mais rápidos',
                          icon: <Monitor size={16} />,
                        },
                      ]}
                    />
                    <p className="warming-explanation">
                      {settings.searchMode === 'economy'
                        ? 'Reaproveita o vídeo aberto no feed do TikTok, aguarda mais entre buscas e espaça as capturas em 20 segundos.'
                        : 'Busca em intervalos mais curtos e atualiza a captura a cada etapa. Consome mais recursos.'}
                    </p>
                    <ChoicePair
                      label="Resolver verificações"
                      value={settings.verificationMode}
                      disabled={locked}
                      onChange={(value) => change({ verificationMode: value })}
                      options={[
                        {
                          value: 'browser',
                          label: 'No Chrome',
                          detail: 'Mais leve, na janela original',
                        },
                        {
                          value: 'panel',
                          label: 'No painel',
                          detail: 'Tela interativa com captura',
                        },
                      ]}
                    />
                  </section>
                  <section className="warming-section warming-ai">
                    <div className="warming-section__title">
                      <div>
                        <h3>Texto com contexto</h3>
                        <p>Para comentários e respostas.</p>
                      </div>
                    </div>
                    {hasAI ? (
                      <>
                        <CompactSelect
                          label="Origem da IA"
                          value={settings.ai.source}
                          disabled={locked}
                          onChange={(value) =>
                            change({
                              ai: { ...settings.ai, source: value as Config['ai']['source'] },
                            })
                          }
                          options={[
                            {
                              value: 'ollama',
                              label: 'Ollama local',
                              detail: 'Usa os recursos deste computador',
                            },
                            {
                              value: 'key',
                              label: 'Chave de API',
                              detail: 'Usa um serviço de IA externo',
                            },
                            {
                              value: 'configured',
                              label: 'Configuração da CLI',
                              detail: 'Usa o provedor já configurado',
                            },
                          ]}
                        />
                        {settings.ai.source === 'ollama' && (
                          <label className="field">
                            <span className="field__label">Modelo do Ollama</span>
                            <input
                              className="input"
                              maxLength={100}
                              disabled={locked}
                              value={settings.ai.model}
                              onChange={(event) =>
                                change({ ai: { ...settings.ai, model: event.target.value } })
                              }
                            />
                          </label>
                        )}
                        {settings.ai.source === 'key' && (
                          <>
                            <CompactSelect
                              label="Chave cadastrada"
                              value={settings.ai.keyId ?? ''}
                              disabled={locked}
                              placeholder="Escolher uma chave"
                              onChange={(value) =>
                                change({ ai: { ...settings.ai, keyId: value || null } })
                              }
                              options={keys.map((key) => ({
                                value: key.id,
                                label: key.label,
                                detail: key.model ?? key.provider,
                              }))}
                            />
                            {aiError && (
                              <p className="warming-alert" role="alert">
                                {aiError}
                              </p>
                            )}
                            {!keys.length && !aiError && (
                              <p className="warming-note">
                                Cadastre uma chave em Configurações → Chaves de API.
                              </p>
                            )}
                          </>
                        )}
                        <label className="field">
                          <span className="field__label">Como a IA deve escrever</span>
                          <textarea
                            className="input"
                            rows={2}
                            maxLength={1000}
                            disabled={locked}
                            value={settings.guidance}
                            onChange={(event) => change({ guidance: event.target.value })}
                          />
                        </label>
                        <p className="warming-note">A IA usa o texto da página para escrever.</p>
                      </>
                    ) : (
                      <div className="warming-ai__empty">
                        <MessageCircle size={23} />
                        <p>Ative comentários ou respostas nas metas para escolher a IA.</p>
                      </div>
                    )}
                  </section>
                </div>
              )}
              {tab === 'activity' && (
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
                      <strong>{stageLabel}</strong>
                      <p>{session?.message ?? 'Inicie a sessão para acompanhar as ações aqui.'}</p>
                    </div>
                    {running && seconds > 0 && (
                      <span className="warming-live__time">
                        {seconds >= 3600 ? `${Math.ceil(seconds / 3600)} h` : `${seconds}s`}
                      </span>
                    )}
                    {session?.status === 'attention' &&
                      /verificaç|captcha/i.test(session.message ?? '') && (
                        <Button
                          size="small"
                          variant="light"
                          disabled={busy}
                          onClick={() => {
                            void resolveVerification();
                          }}
                        >
                          Resolver
                        </Button>
                      )}
                  </div>
                  <div className="warming-metrics">
                    {actions
                      .filter(
                        (action) =>
                          settings.goals[action] > 0 || (session?.counts[action] ?? 0) > 0,
                      )
                      .map((action) => (
                        <div key={action}>
                          <span>
                            {icons[action]}
                            {shortLabels[action]}
                          </span>
                          <strong>
                            {session?.counts[action] ?? 0}
                            <small>
                              {' '}
                              / {session?.config.goals[action] ?? settings.goals[action]}
                            </small>
                          </strong>
                          <progress
                            aria-label={LABELS[action]}
                            max={Math.max(
                              1,
                              session?.config.goals[action] ?? settings.goals[action],
                            )}
                            value={session?.counts[action] ?? 0}
                          />
                        </div>
                      ))}
                  </div>
                  <div className="warming-observation">
                    <section className="warming-preview">
                      <header>
                        <h3>Prévia do navegador</h3>
                        {session?.progress?.videoUrl && (
                          <a
                            href={session.progress.videoUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label="Abrir vídeo"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </header>
                      {frameUrl && frameError !== frameAt ? (
                        <a
                          className="warming-preview__image"
                          href={frameUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          title="Ampliar captura"
                        >
                          <img
                            src={frameUrl}
                            alt="Última captura do navegador desta conta"
                            decoding="async"
                            onError={() => setFrameError(frameAt ?? null)}
                          />
                          <span>
                            <Maximize2 size={15} /> Ampliar
                          </span>
                        </a>
                      ) : (
                        <div className="warming-preview__empty">
                          <Monitor size={24} />
                          <p>
                            {frameUrl
                              ? 'A captura não está disponível.'
                              : 'A prévia aparece quando a navegação começar.'}
                          </p>
                        </div>
                      )}
                      <p className="warming-note">
                        Captura por etapa
                        {frameAt ? ` · ${new Date(frameAt).toLocaleTimeString('pt-BR')}` : ''}
                        {settings.searchMode === 'economy' ? ' · modo econômico' : ''}
                      </p>
                    </section>
                    <section className="warming-log">
                      <header>
                        <h3>
                          Histórico <small>{session?.history.length ?? 0}</small>
                        </h3>
                        <button
                          type="button"
                          className="warming-icon"
                          aria-label="Copiar histórico"
                          disabled={!history.length}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(
                                history
                                  .map(
                                    (event) =>
                                      `${new Date(event.at).toLocaleTimeString('pt-BR')} ${event.message}`,
                                  )
                                  .join('\n'),
                              )
                              .then(() => toast('Histórico copiado.'))
                              .catch(() => toast('Não consegui copiar o histórico.'));
                          }}
                        >
                          <Copy size={14} />
                        </button>
                      </header>
                      <div className="warming-log__tools">
                        <div
                          className="warming-log__filters"
                          role="group"
                          aria-label="Filtrar histórico"
                        >
                          {[
                            ['all', 'Todos'],
                            ['confirmed', 'Confirmados'],
                            ['attempts', 'Tentativas'],
                          ].map(([value, label]) => (
                            <button
                              type="button"
                              key={value}
                              aria-pressed={logFilter === value}
                              onClick={() => setLogFilter(value!)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <label className="warming-log__search">
                          <Search size={13} />
                          <input
                            aria-label="Buscar no histórico"
                            placeholder="Buscar no histórico"
                            value={logQuery}
                            onChange={(event) => setLogQuery(event.target.value)}
                          />
                        </label>
                      </div>
                      <ol
                        className="warming-log__list"
                        tabIndex={0}
                        aria-label="Eventos do aquecimento"
                      >
                        {history.map((event) => (
                          <li
                            key={`${event.at}-${event.message}`}
                            className={event.action ? 'warming-log__confirmed' : ''}
                          >
                            <time dateTime={event.at}>
                              {new Date(event.at).toLocaleTimeString('pt-BR')}
                            </time>
                            <span className="warming-log__marker">
                              {event.action ? <Check size={11} /> : <span />}
                            </span>
                            <p>{event.message}</p>
                            {event.url && (
                              <a
                                href={event.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                aria-label="Abrir vídeo deste evento"
                              >
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </li>
                        ))}
                        {!history.length && (
                          <li className="warming-log__empty">
                            {logQuery
                              ? 'Nenhum evento com esse texto.'
                              : 'As ações e tentativas aparecerão aqui.'}
                          </li>
                        )}
                      </ol>
                    </section>
                  </div>
                </div>
              )}
            </div>
            <footer className="warming-dialog__footer">
              <span className={connected ? 'warming-connected' : ''}>
                {connected ? 'Navegação conectada' : 'Conecte a navegação para iniciar'}
                {connected && onDisconnect && !running && (
                  <button type="button" disabled={connecting || busy} onClick={onDisconnect}>
                    Desconectar
                  </button>
                )}
              </span>
              {!connected ? (
                <button
                  type="button"
                  className="warming-footer-action"
                  disabled={connecting || busy}
                  onClick={onConnect}
                >
                  {connecting ? 'Conectando…' : 'Conectar navegação'}
                </button>
              ) : (
                <span>
                  {running
                    ? 'Pare a sessão para editar.'
                    : dirty
                      ? 'Alterações aplicadas ao iniciar.'
                      : 'O progresso de hoje é preservado.'}
                </span>
              )}
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="warming-stepper">
      <button
        type="button"
        aria-label={`Diminuir ${label}`}
        disabled={disabled || value === 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Minus size={13} />
      </button>
      <input
        type="number"
        aria-label={label}
        min={0}
        max={1000}
        disabled={disabled}
        value={value}
        onChange={(event) =>
          onChange(Math.max(0, Math.min(1000, Math.floor(Number(event.target.value) || 0))))
        }
      />
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={disabled || value === 1000}
        onClick={() => onChange(Math.min(1000, value + 1))}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function ChoicePair<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; detail: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="warming-choice">
      <span className="field__label">{label}</span>
      <div role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            <span className="warming-choice__label">
              {option.icon}
              {option.label}
              <span className="warming-choice__check">
                {value === option.value && <Check size={11} />}
              </span>
            </span>
            <small>{option.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
