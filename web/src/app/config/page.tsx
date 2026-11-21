'use client';

import {
  Cpu,
  Database,
  ImagePlus,
  KeyRound,
  Plus,
  Send,
  Star,
  Trash2,
  UserRound,
  Waves,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { KeyForm } from '@/components/key-form';
import { ImageDrop } from '@/components/image-drop';
import { useToast } from '@/components/toast';
import { Button, fade } from '@/components/ui';
import { api, patch, post, remove, upload } from '@/lib/api';
import type {
  AccountView,
  ApiKeyView,
  LoginWindowView,
  NetworksOverview,
  NetworkView,
  PublishingSettings,
  PublishPlatform,
} from '@/lib/types';

interface Settings {
  whisperModel: string;
  language: string;
  whisperModels: { model: string; ready: boolean }[];
  installing: string | null;
  publishing: PublishingSettings;
}

interface Health {
  database: boolean;
  ffmpeg: boolean;
  ytdlp: boolean;
  whisper: boolean;
  ollama: boolean;
}

const LANGUAGES = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
  { value: 'auto', label: 'Detectar sozinho' },
];

const MODEL_NOTE: Record<string, string> = {
  tiny: 'muito rápido, erra mais',
  base: 'rápido',
  small: 'equilibrado',
  medium: 'preciso, lento sem placa de vídeo',
  'large-v3': 'o mais preciso, bem lento',
};

const SECTIONS = [
  { id: 'keys', label: 'Chaves de API', icon: KeyRound },
  { id: 'ollama', label: 'IA local', icon: Cpu },
  { id: 'transcription', label: 'Transcrição', icon: Waves },
  { id: 'accounts', label: 'Contas', icon: UserRound },
  { id: 'publishing', label: 'Postagem', icon: Send },
  { id: 'system', label: 'Sistema', icon: Database },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('keys');
  return (
    <div className="settings">
      <nav className="settings__menu" aria-label="Seções">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <motion.button
            key={id}
            type="button"
            whileTap={{ scale: 0.97 }}
            className={`settings__item ${section === id ? 'settings__item--active' : ''}`}
            onClick={() => {
              setSection(id);
            }}
          >
            {section === id && (
              <motion.span
                layoutId="settings-pill"
                className="settings__pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <Icon size={17} />
            {label}
          </motion.button>
        ))}
      </nav>
      <AnimatePresence mode="wait">
        <motion.div key={section} className="settings__body" {...fade}>
          {section === 'keys' && <Keys />}
          {section === 'ollama' && <Ollama />}
          {section === 'transcription' && <Transcription />}
          {section === 'accounts' && <Accounts />}
          {section === 'publishing' && <Publishing />}
          {section === 'system' && <System />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Section({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <>
      <header className="stack" style={{ gap: 8 }}>
        <h1 className="title-lg">{title}</h1>
        <p className="lead">{text}</p>
      </header>
      <div className="panel" style={{ padding: '4px 26px' }}>
        {children}
      </div>
    </>
  );
}

function Row({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <p className="setting-row__title">{title}</p>
        {text !== undefined && <p className="setting-row__text">{text}</p>}
      </div>
      <div className="stack" style={{ gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Keys() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  useEffect(() => {
    void api<ApiKeyView[]>('/keys')
      .then(setKeys)
      .catch(() => undefined);
  }, []);
  async function test(key: ApiKeyView): Promise<void> {
    setTesting(key.id);
    type Result = { ok: boolean; seconds?: number; error?: string };
    const result = await post<Result>(`/keys/${key.id}/test`).catch((caught: unknown): Result => ({
      ok: false,
      error: caught instanceof Error ? caught.message : 'falhou',
    }));
    setTesting(null);
    toast(
      result.ok
        ? `${key.label} respondeu em ${String(result.seconds ?? 0)} s.`
        : `${key.label} falhou: ${result.error ?? ''}`,
    );
  }
  async function drop(key: ApiKeyView): Promise<void> {
    if (!window.confirm(`Apagar a chave “${key.label}”?`)) return;
    await remove(`/keys/${key.id}`);
    setKeys((current) => current.filter((item) => item.id !== key.id));
  }
  return (
    <Section
      title="Chaves de API"
      text="Para escolher os cortes com Claude, OpenAI ou outro serviço compatível. Ficam guardadas com criptografia."
    >
      <Row title="Guardadas" text="Use Testar para conferir se a chave responde.">
        {keys.length === 0 ? (
          <p className="muted small">Nenhuma chave ainda.</p>
        ) : (
          <AnimatePresence initial={false}>
            {keys.map((key) => (
              <motion.div
                key={key.id}
                className="key-row"
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
              >
                <KeyRound size={16} />
                <span className="stack" style={{ gap: 2 }}>
                  <span className="key-row__name">{key.label}</span>
                  <span className="muted small">
                    {key.provider} · {key.model ?? 'modelo padrão'} · {key.hint}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={testing === key.id}
                    onClick={() => {
                      void test(key);
                    }}
                  >
                    {testing === key.id ? 'Testando…' : 'Testar'}
                  </Button>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    type="button"
                    className="clip__action"
                    aria-label="apagar"
                    onClick={() => {
                      void drop(key);
                    }}
                  >
                    <Trash2 size={15} />
                  </motion.button>
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </Row>
      <Row title="Nova chave" text="A chave nunca mais aparece na tela depois de salva.">
        <KeyForm
          onSaved={(key) => {
            setKeys((current) => [key, ...current]);
            toast('Chave guardada.');
          }}
        />
      </Row>
    </Section>
  );
}

function Ollama() {
  const toast = useToast();
  const [state, setState] = useState<{
    reachable: boolean;
    models: string[];
    baseUrl: string;
  } | null>(null);
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState(false);
  function refresh(): void {
    setState(null);
    void api<{ reachable: boolean; models: string[]; baseUrl: string }>('/ollama').then(
      (result) => {
        setState(result);
        setModel((current) => current || (result.models[0] ?? ''));
      },
    );
  }
  useEffect(refresh, []);
  async function test(): Promise<void> {
    setTesting(true);
    const result = await post<{ ok: boolean; seconds?: number; error?: string }>('/ollama/test', {
      model,
    });
    setTesting(false);
    toast(
      result.ok
        ? `${model} respondeu em ${String(result.seconds ?? 0)} s.`
        : `falhou: ${result.error ?? ''}`,
    );
  }
  return (
    <Section
      title="IA local"
      text="O Ollama roda modelos no seu computador, sem custo por uso. Modelos maiores escolhem melhor e pedem mais máquina."
    >
      <Row title="Conexão" text={state?.baseUrl ?? 'http://127.0.0.1:11434'}>
        {state === null ? (
          <div className="row muted">
            <span className="spinner" /> procurando
          </div>
        ) : state.reachable ? (
          <span className="row small">
            <span className="dot" /> conectado · {state.models.length}{' '}
            {state.models.length === 1 ? 'modelo' : 'modelos'}
          </span>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <span className="row small muted">
              <span className="health__dot" /> não respondeu
            </span>
            <p className="muted small">
              Abra o Ollama ou rode <span className="kbd">ollama serve</span> num terminal.
            </p>
            <div>
              <Button variant="light" size="small" onClick={refresh}>
                Procurar de novo
              </Button>
            </div>
          </div>
        )}
      </Row>
      {state?.reachable === true && (
        <Row title="Modelo" text="Teste para ver quanto tempo ele leva para responder.">
          {state.models.length === 0 ? (
            <p className="muted small">
              Sem modelos. Rode <span className="kbd">ollama pull qwen2.5:7b</span>.
            </p>
          ) : (
            <div className="row wrap">
              <select
                className="input"
                style={{ maxWidth: 320 }}
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                }}
              >
                {state.models.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <Button
                variant="light"
                size="small"
                disabled={testing || model === ''}
                onClick={() => {
                  void test();
                }}
              >
                {testing ? 'Testando…' : 'Testar'}
              </Button>
            </div>
          )}
        </Row>
      )}
    </Section>
  );
}

function Transcription() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void api<Settings>('/settings').then(setSettings);
  }, []);
  useEffect(() => {
    if (settings === null || settings.installing === null) return;
    const timer = setInterval(() => {
      void api<Settings>('/settings').then(setSettings);
    }, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [settings]);
  if (settings === null)
    return (
      <div className="row muted">
        <span className="spinner" /> carregando
      </div>
    );
  async function save(change: Partial<Pick<Settings, 'whisperModel' | 'language'>>): Promise<void> {
    setSettings(await patch<Settings>('/settings', change));
    toast('Salvo.');
  }
  async function install(model: string): Promise<void> {
    await post(`/settings/whisper/${model}`);
    setSettings(await api<Settings>('/settings'));
  }
  const current = settings.whisperModels.find((item) => item.model === settings.whisperModel);
  return (
    <Section title="Transcrição" text="Usada quando o vídeo não tem legenda automática do YouTube.">
      <Row title="Modelo" text="Modelos maiores acertam mais as palavras e demoram mais.">
        <select
          className="input"
          style={{ maxWidth: 420 }}
          value={settings.whisperModel}
          onChange={(event) => {
            void save({ whisperModel: event.target.value });
          }}
        >
          {settings.whisperModels.map((item) => (
            <option key={item.model} value={item.model}>
              {item.model} · {MODEL_NOTE[item.model] ?? ''}
              {item.ready ? '' : ' · não instalado'}
            </option>
          ))}
        </select>
        {current !== undefined && !current.ready && (
          <div className="row wrap">
            <span className="small">Esse modelo ainda não foi baixado.</span>
            <Button
              size="small"
              disabled={settings.installing !== null}
              onClick={() => {
                void install(current.model);
              }}
            >
              {settings.installing === current.model ? 'Baixando…' : 'Baixar agora'}
            </Button>
          </div>
        )}
        {settings.installing !== null && (
          <span className="row muted small">
            <span className="spinner" /> baixando o modelo {settings.installing}
          </span>
        )}
      </Row>
      <Row title="Idioma dos vídeos">
        <select
          className="input"
          style={{ maxWidth: 420 }}
          value={settings.language}
          onChange={(event) => {
            void save({ language: event.target.value });
          }}
        >
          {LANGUAGES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Row>
    </Section>
  );
}

const METHOD_OPTIONS = [
  { value: 'browser', label: 'Navegador · entra na sua conta pelo Chrome, igual ao TikTok' },
  { value: 'api', label: 'API oficial · usa o token do app da Meta ou do Google' },
] as const;

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Público' },
  { value: 'unlisted', label: 'Não listado' },
  { value: 'private', label: 'Privado' },
] as const;

function Publishing() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void api<Settings>('/settings').then(setSettings);
  }, []);
  if (settings === null)
    return (
      <div className="row muted">
        <span className="spinner" /> carregando
      </div>
    );
  async function save(change: Partial<PublishingSettings>): Promise<void> {
    setSettings(await patch<Settings>('/settings', { publishing: change }));
    toast('Salvo. Vale para as próximas postagens.');
  }
  const { publishing } = settings;
  return (
    <Section
      title="Postagem"
      text="Escolha como cada rede recebe os clipes. Pelo navegador, você conecta a conta uma vez em Publicar e, se pedirem verificação, resolve no pop-up do painel."
    >
      <Row
        title="Instagram"
        text="A API oficial precisa do token do app da Meta. Pelo navegador basta entrar na conta."
      >
        <select
          className="input"
          style={{ maxWidth: 520 }}
          value={publishing.instagram}
          onChange={(event) => {
            void save({ instagram: event.target.value as PublishingSettings['instagram'] });
          }}
        >
          {METHOD_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Row>
      <Row
        title="YouTube Shorts"
        text="Pela API oficial o vídeo sai privado até o Google aprovar o app."
      >
        <select
          className="input"
          style={{ maxWidth: 520 }}
          value={publishing.youtube}
          onChange={(event) => {
            void save({ youtube: event.target.value as PublishingSettings['youtube'] });
          }}
        >
          {METHOD_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Row>
      {publishing.youtube === 'browser' && (
        <Row title="Visibilidade no YouTube" text="Como o Short aparece quando termina de subir.">
          <select
            className="input"
            style={{ maxWidth: 320 }}
            value={publishing.youtubeVisibility}
            onChange={(event) => {
              void save({
                youtubeVisibility: event.target.value as PublishingSettings['youtubeVisibility'],
              });
            }}
          >
            {VISIBILITY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row title="TikTok" text="Sempre pelo navegador.">
        <span className="muted small">Navegador</span>
      </Row>
    </Section>
  );
}

const NETWORK_NAME: Record<PublishPlatform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

const NETWORK_ORDER: PublishPlatform[] = ['tiktok', 'instagram', 'youtube'];

function Accounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [overview, setOverview] = useState<NetworksOverview | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [stamp, setStamp] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<NetworksOverview | null> => {
    try {
      const data = await api<NetworksOverview>('/networks');
      setOverview(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void api<AccountView[]>('/accounts').then(setAccounts);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (waiting === null) return;
    const [account, platform] = waiting.split(':');
    const timer = window.setInterval(() => {
      void refresh().then((data) => {
        const login = data?.logins.find(
          (item) => item.account === account && item.platform === platform,
        );
        if (login === undefined || login.phase === 'open' || login.phase === 'checking') return;
        setWaiting(null);
        toast(
          login.phase === 'connected'
            ? `${NETWORK_NAME[login.platform]} conectado na conta ${account ?? ''}.`
            : (login.message ?? 'o login não foi concluído'),
        );
      });
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [waiting, refresh, toast]);

  async function create(): Promise<void> {
    try {
      const account = await patch<AccountView>(`/accounts/${id.trim()}`, {
        name: name.trim() === '' ? null : name.trim(),
      });
      setAccounts((current) => [...current.filter((item) => item.id !== account.id), account]);
      setId('');
      setName('');
      toast('Conta criada. Agora conecte as redes dela.');
      void refresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui salvar');
    }
  }

  async function logo(account: AccountView, file: File): Promise<void> {
    try {
      const saved = await upload<AccountView>(
        `/accounts/${account.id}/logo`,
        file,
        () => undefined,
      );
      setAccounts((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setStamp(Date.now());
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui enviar a logo');
    }
  }

  async function connect(account: string, platform: PublishPlatform): Promise<void> {
    try {
      await post('/desk/connect', { platform, account });
      setWaiting(`${account}:${platform}`);
      toast(
        `Abri uma janela do Chrome. Entre no ${NETWORK_NAME[platform]} e feche a janela quando terminar.`,
      );
      void refresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui abrir o Chrome');
    }
  }

  async function check(account: string, platform: PublishPlatform): Promise<void> {
    const key = `${account}:${platform}`;
    setBusy(key);
    try {
      const data = await post<NetworksOverview>(`/networks/${account}/${platform}/check`);
      setOverview(data);
      const network = data.accounts
        .find((item) => item.id === account)
        ?.networks.find((item) => item.platform === platform);
      toast(
        network?.connected === true
          ? `Sessão ativa${network.handle !== null ? ` como ${network.handle}` : ''}.`
          : `A sessão do ${NETWORK_NAME[platform]} caiu. Conecte de novo.`,
      );
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui conferir');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(account: string, platform: PublishPlatform): Promise<void> {
    const key = `${account}:${platform}`;
    setBusy(key);
    setConfirming(null);
    try {
      setOverview(await remove<NetworksOverview>(`/networks/${account}/${platform}`));
      toast(`${NETWORK_NAME[platform]} desconectado da conta ${account}.`);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui desconectar');
    } finally {
      setBusy(null);
    }
  }

  function networksOf(account: string): NetworkView[] {
    const found = overview?.accounts.find((item) => item.id === account)?.networks ?? [];
    return NETWORK_ORDER.map(
      (platform) =>
        found.find((item) => item.platform === platform) ?? {
          platform,
          method: 'browser',
          connected: false,
          handle: null,
          url: null,
          connectedAt: null,
        },
    );
  }

  function loginOf(account: string, platform: PublishPlatform): LoginWindowView | undefined {
    return overview?.logins.find(
      (item) =>
        item.account === account &&
        item.platform === platform &&
        (item.phase === 'open' || item.phase === 'checking'),
    );
  }

  return (
    <Section
      title="Contas"
      text="Cada conta tem a sua marca d’água e as redes onde os clipes dela são postados."
    >
      <Row
        title="Suas contas"
        text="Clique na foto para trocar a logo. A estrela marca a conta padrão. Conecte cada rede uma vez; o @ aparece sozinho."
      >
        {accounts.length === 0 ? (
          <p className="muted small">Nenhuma conta ainda. Crie a primeira logo abaixo.</p>
        ) : (
          accounts.map((account) => (
            <motion.div
              key={account.id}
              className="account-card"
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="account-card__head">
                <ImageDrop
                  className="account__logo"
                  title="Trocar a logo: clique ou arraste uma imagem"
                  onFile={(file) => {
                    void logo(account, file);
                  }}
                >
                  {account.logo !== null ? (
                    <img src={`/api/accounts/${account.id}/logo?v=${String(stamp)}`} alt="" />
                  ) : (
                    <ImagePlus size={16} />
                  )}
                </ImageDrop>
                <span className="stack" style={{ gap: 2 }}>
                  <span className="key-row__name">{account.name ?? account.id}</span>
                  <span className="muted small">
                    {account.id}
                    {account.isDefault ? ' · padrão' : ''}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {!account.isDefault && (
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      type="button"
                      className="clip__action"
                      aria-label="tornar padrão"
                      onClick={() => {
                        void post<AccountView>(`/accounts/${account.id}/default`)
                          .then(() => api<AccountView[]>('/accounts'))
                          .then(setAccounts);
                      }}
                    >
                      <Star size={15} />
                    </motion.button>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    type="button"
                    className="clip__action"
                    aria-label="apagar"
                    onClick={() => {
                      if (window.confirm(`Apagar a conta ${account.id}?`))
                        void remove<AccountView[]>(`/accounts/${account.id}`).then(setAccounts);
                    }}
                  >
                    <Trash2 size={15} />
                  </motion.button>
                </span>
              </div>
              <div className="networks">
                {networksOf(account.id).map((network) => {
                  const key = `${account.id}:${network.platform}`;
                  const login = loginOf(account.id, network.platform);
                  const viaApi = network.method === 'api';
                  const working = busy === key || login !== undefined || waiting === key;
                  return (
                    <div
                      key={network.platform}
                      className={`network ${network.connected ? 'network--on' : ''}`}
                    >
                      <div className="network__top">
                        <span className="network__name">{NETWORK_NAME[network.platform]}</span>
                        <span className="network__status">
                          <span className="network__dot" />
                          {login !== undefined
                            ? login.phase === 'checking'
                              ? 'conferindo'
                              : 'janela aberta'
                            : network.connected
                              ? 'conectado'
                              : 'desconectado'}
                        </span>
                      </div>
                      <span className="network__handle">
                        {viaApi ? (
                          network.connected ? (
                            'pela API oficial'
                          ) : (
                            'API oficial sem token'
                          )
                        ) : network.connected ? (
                          network.url !== null ? (
                            <a href={network.url} target="_blank" rel="noreferrer noopener">
                              {network.platform === 'youtube'
                                ? network.handle
                                : `@${network.handle ?? ''}`}
                            </a>
                          ) : (
                            'perfil ainda não identificado'
                          )
                        ) : (
                          'nenhum perfil ligado'
                        )}
                      </span>
                      <div className="network__actions">
                        {viaApi ? (
                          network.connected ? (
                            confirming === key ? (
                              <>
                                <button
                                  type="button"
                                  className="network__link"
                                  onClick={() => {
                                    void disconnect(account.id, network.platform);
                                  }}
                                >
                                  Apagar o token
                                </button>
                                <button
                                  type="button"
                                  className="network__link network__link--danger"
                                  onClick={() => {
                                    setConfirming(null);
                                  }}
                                >
                                  Manter
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="network__link network__link--danger"
                                disabled={working}
                                onClick={() => {
                                  setConfirming(key);
                                }}
                              >
                                Desconectar
                              </button>
                            )
                          ) : (
                            <span className="muted small">troque para Navegador em Postagem</span>
                          )
                        ) : confirming === key ? (
                          <>
                            <button
                              type="button"
                              className="network__link"
                              onClick={() => {
                                void disconnect(account.id, network.platform);
                              }}
                            >
                              Sair e apagar a sessão
                            </button>
                            <button
                              type="button"
                              className="network__link network__link--danger"
                              onClick={() => {
                                setConfirming(null);
                              }}
                            >
                              Manter
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="network__link"
                              disabled={working}
                              onClick={() => {
                                void connect(account.id, network.platform);
                              }}
                            >
                              {network.connected ? 'Trocar perfil' : 'Conectar'}
                            </button>
                            {network.connected && (
                              <>
                                <button
                                  type="button"
                                  className="network__link"
                                  disabled={working}
                                  onClick={() => {
                                    void check(account.id, network.platform);
                                  }}
                                >
                                  {busy === key ? 'Conferindo…' : 'Conferir'}
                                </button>
                                <button
                                  type="button"
                                  className="network__link network__link--danger"
                                  disabled={working}
                                  onClick={() => {
                                    setConfirming(key);
                                  }}
                                >
                                  Desconectar
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))
        )}
      </Row>
      <Row title="Nova conta" text="Crie a conta aqui e depois conecte as redes nela.">
        <div className="grid grid--2">
          <label className="field">
            <span className="field__label">Identificador</span>
            <input
              className="input"
              placeholder="minha-conta"
              value={id}
              maxLength={32}
              onChange={(event) => {
                setId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">Nome na marca d’água</span>
            <input
              className="input"
              placeholder="@meucanal"
              value={name}
              maxLength={40}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
        </div>
        <div>
          <Button
            size="small"
            lead={<Plus />}
            disabled={id === ''}
            onClick={() => {
              void create();
            }}
          >
            Criar conta
          </Button>
        </div>
      </Row>
    </Section>
  );
}

function System() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    void api<Health>('/health').then(setHealth);
  }, []);
  const items: [string, keyof Health, string][] = [
    ['Banco de dados', 'database', 'rode cortes-eb db migrate e veja o erro'],
    ['FFmpeg', 'ffmpeg', 'instale o ffmpeg'],
    ['yt-dlp', 'ytdlp', 'instale o yt-dlp para baixar links'],
    ['Transcrição', 'whisper', 'baixe o modelo em Transcrição'],
    ['IA local', 'ollama', 'opcional: abra o Ollama'],
  ];
  return (
    <Section title="Sistema" text="O que o painel precisa para funcionar.">
      {health === null ? (
        <Row title="Verificando">
          <span className="spinner" />
        </Row>
      ) : (
        items.map(([label, key, fix], index) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Row title={label}>
              <span className="row small">
                <span className={`health__dot ${health[key] ? 'is-ok' : ''}`} />
                {health[key] ? 'funcionando' : fix}
              </span>
            </Row>
          </motion.div>
        ))
      )}
    </Section>
  );
}
