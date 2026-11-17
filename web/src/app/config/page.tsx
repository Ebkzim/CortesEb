'use client';

import {
  Cpu,
  Database,
  ImagePlus,
  KeyRound,
  Plus,
  Star,
  Trash2,
  UserRound,
  Waves,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyForm } from '@/components/key-form';
import { useToast } from '@/components/toast';
import { Button, fade } from '@/components/ui';
import { api, patch, post, remove, upload } from '@/lib/api';
import type { AccountView, ApiKeyView } from '@/lib/types';

interface Settings {
  whisperModel: string;
  language: string;
  whisperModels: { model: string; ready: boolean }[];
  installing: string | null;
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

function Accounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    void api<AccountView[]>('/accounts').then(setAccounts);
  }, []);
  async function create(): Promise<void> {
    try {
      const account = await patch<AccountView>(`/accounts/${id.trim()}`, {
        name: name.trim() === '' ? null : name.trim(),
      });
      setAccounts((current) => [...current.filter((item) => item.id !== account.id), account]);
      setId('');
      setName('');
      toast('Conta salva.');
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
  return (
    <Section
      title="Contas"
      text="Nome e logo opcionais, usados na marca d’água. Sem conta, o corte sai limpo."
    >
      <Row
        title="Suas contas"
        text="Clique na foto para trocar a logo. A estrela marca a conta padrão."
      >
        {accounts.length === 0 ? (
          <p className="muted small">Nenhuma conta ainda.</p>
        ) : (
          accounts.map((account) => (
            <motion.div
              key={account.id}
              className="key-row"
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <label className="account__logo" title="trocar a logo">
                {account.logo !== null ? (
                  <img src={`/api/accounts/${account.id}/logo?v=${String(stamp)}`} alt="" />
                ) : (
                  <ImagePlus size={16} />
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) void logo(account, file);
                  }}
                />
              </label>
              <span className="stack" style={{ gap: 2 }}>
                <span className="key-row__name">{account.name ?? account.id}</span>
                <span className="muted small">
                  @{account.id}
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
            </motion.div>
          ))
        )}
      </Row>
      <Row title="Nova conta">
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
            Adicionar conta
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
    ['Banco de dados', 'database', 'defina DATABASE_URL e rode cortes-eb db migrate'],
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
