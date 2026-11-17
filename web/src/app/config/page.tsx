'use client';

import { Cpu, Database, ImagePlus, KeyRound, Star, Trash2, UserRound, Waves } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyForm } from '@/components/key-form';
import { useToast } from '@/components/toast';
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

export default function SettingsPage() {
  return (
    <div className="settings">
      <header className="stack" style={{ gap: 10 }}>
        <span className="eyebrow">Configurações</span>
        <h1 className="title-lg">Ajustes do painel</h1>
      </header>
      <Keys />
      <Ollama />
      <Transcription />
      <Accounts />
      <System />
    </div>
  );
}

function Section({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      className="panel settings__section"
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="settings__aside">
        <span className="choice__icon">{icon}</span>
        <h2 className="title-md">{title}</h2>
        <p className="muted small" style={{ lineHeight: 1.6 }}>
          {text}
        </p>
      </div>
      <div className="stack">{children}</div>
    </motion.section>
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
      icon={<KeyRound size={20} />}
      title="Chaves de API"
      text="Para usar Claude, OpenAI ou outro serviço compatível na escolha dos cortes. Ficam guardadas com criptografia."
    >
      {keys.map((key) => (
        <div key={key.id} className="key-row">
          <KeyRound size={16} />
          <span className="stack" style={{ gap: 2 }}>
            <span className="key-row__name">{key.label}</span>
            <span className="muted small">
              {key.provider} · {key.model ?? 'modelo padrão'} · {key.hint}
            </span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={testing === key.id}
              onClick={() => {
                void test(key);
              }}
            >
              {testing === key.id ? 'Testando…' : 'Testar'}
            </button>
            <button
              type="button"
              className="clip__action"
              aria-label="apagar"
              onClick={() => {
                void drop(key);
              }}
            >
              <Trash2 size={16} />
            </button>
          </span>
        </div>
      ))}
      {keys.length > 0 && <div className="divider" />}
      <KeyForm
        onSaved={(key) => {
          setKeys((current) => [key, ...current]);
          toast('Chave guardada.');
        }}
      />
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
      icon={<Cpu size={20} />}
      title="IA local"
      text="O Ollama roda modelos no seu computador, sem custo por uso. Modelos maiores escolhem melhor e pedem mais máquina."
    >
      {state === null ? (
        <div className="row muted">
          <span className="spinner" /> procurando
        </div>
      ) : !state.reachable ? (
        <div className="stack">
          <p>O Ollama não respondeu em {state.baseUrl}.</p>
          <p className="muted small">
            Abra o Ollama ou rode <span className="kbd">ollama serve</span>. Para baixar um modelo:{' '}
            <span className="kbd">ollama pull qwen2.5:7b</span>.
          </p>
          <button
            type="button"
            className="button button--light button--small"
            style={{ alignSelf: 'flex-start' }}
            onClick={refresh}
          >
            Procurar de novo
          </button>
        </div>
      ) : (
        <div className="stack">
          <span className="chip" style={{ alignSelf: 'flex-start' }}>
            Conectado · {state.models.length} modelos
          </span>
          {state.models.length > 0 && (
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
              <button
                type="button"
                className="button button--light button--small"
                disabled={testing || model === ''}
                onClick={() => {
                  void test();
                }}
              >
                {testing ? 'Testando…' : 'Testar modelo'}
              </button>
            </div>
          )}
        </div>
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
    if (settings?.installing === null || settings === null) return;
    const timer = setInterval(() => {
      void api<Settings>('/settings').then(setSettings);
    }, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [settings]);
  if (settings === null) return null;
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
    <Section
      icon={<Waves size={20} />}
      title="Transcrição"
      text="Usada quando o vídeo não tem legenda automática do YouTube. Modelos maiores acertam mais as palavras, mas demoram mais."
    >
      <div className="grid grid--2">
        <label className="field">
          <span className="field__label">Modelo do whisper</span>
          <select
            className="input"
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
        </label>
        <label className="field">
          <span className="field__label">Idioma dos vídeos</span>
          <select
            className="input"
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
        </label>
      </div>
      {current !== undefined && !current.ready && (
        <div className="row wrap">
          <span className="small">O modelo {current.model} ainda não foi baixado.</span>
          <button
            type="button"
            className="button button--dark button--small"
            disabled={settings.installing !== null}
            onClick={() => {
              void install(current.model);
            }}
          >
            {settings.installing === current.model ? 'Baixando…' : 'Baixar agora'}
          </button>
        </div>
      )}
      {settings.installing !== null && (
        <span className="row muted small">
          <span className="spinner" /> baixando o modelo {settings.installing}
        </span>
      )}
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
      icon={<UserRound size={20} />}
      title="Contas"
      text="Cada conta tem um nome e uma logo opcionais, usados na marca d’água. Sem conta, o corte sai limpo."
    >
      {accounts.map((account) => (
        <div key={account.id} className="key-row">
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
              <button
                type="button"
                className="clip__action"
                aria-label="tornar padrão"
                onClick={() => {
                  void post<AccountView>(`/accounts/${account.id}/default`)
                    .then(() => api<AccountView[]>('/accounts'))
                    .then(setAccounts);
                }}
              >
                <Star size={16} />
              </button>
            )}
            <button
              type="button"
              className="clip__action"
              aria-label="apagar"
              onClick={() => {
                if (window.confirm(`Apagar a conta ${account.id}?`))
                  void remove<AccountView[]>(`/accounts/${account.id}`).then(setAccounts);
              }}
            >
              <Trash2 size={16} />
            </button>
          </span>
        </div>
      ))}
      {accounts.length > 0 && <div className="divider" />}
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
          <span className="field__label">Nome na marca d’água (opcional)</span>
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
      <button
        type="button"
        className="button button--dark button--small"
        style={{ alignSelf: 'flex-start' }}
        disabled={id === ''}
        onClick={() => {
          void create();
        }}
      >
        Adicionar conta
      </button>
    </Section>
  );
}

function System() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    void api<Health>('/health').then(setHealth);
  }, []);
  if (health === null) return null;
  const items: [string, boolean, string][] = [
    [
      'Banco de dados',
      health.database,
      'defina DATABASE_URL no .env da pasta de dados e rode cortes-eb db migrate',
    ],
    ['FFmpeg', health.ffmpeg, 'instale o ffmpeg'],
    ['yt-dlp', health.ytdlp, 'instale o yt-dlp para baixar links'],
    ['Transcrição', health.whisper, 'baixe o modelo acima'],
    ['IA local', health.ollama, 'opcional: abra o Ollama'],
  ];
  return (
    <Section
      icon={<Database size={20} />}
      title="Sistema"
      text="O que o painel precisa para funcionar."
    >
      {items.map(([label, ok, fix]) => (
        <div key={label} className="spread review-row">
          <span className="row" style={{ gap: 10 }}>
            <span className={`health__dot ${ok ? 'is-ok' : ''}`} />
            {label}
          </span>
          <span className="muted small">{ok ? 'ok' : fix}</span>
        </div>
      ))}
    </Section>
  );
}
