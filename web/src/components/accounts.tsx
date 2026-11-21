'use client';

import { PageLoading } from '@/components/page-loading';

import { ImagePlus, Plus, Star, Trash2, X, Search, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { ImageDrop } from '@/components/image-drop';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui';
import { api, patch, post, remove, upload } from '@/lib/api';
import type {
  AccountView,
  LoginWindowView,
  NetworksOverview,
  NetworkView,
  PublishPlatform,
} from '@/lib/types';
import { WarmingPanel, useWarmingSessions } from './warming-panel';

const NETWORK_NAME: Record<PublishPlatform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

const NETWORK_ORDER: PublishPlatform[] = ['tiktok', 'instagram', 'youtube'];

export function Accounts() {
  const toast = useToast();
  const { sessions: warmings } = useWarmingSessions();
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [overview, setOverview] = useState<NetworksOverview | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [stamp, setStamp] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<NetworksOverview | null> => {
    try {
      const data = await api<NetworksOverview>('/networks');
      setOverview(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [items, networks] = await Promise.all([
        api<AccountView[]>('/accounts'),
        api<NetworksOverview>('/networks'),
      ]);
      setAccounts(items);
      setOverview(networks);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Não consegui carregar as contas.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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
      setCreating(false);
      setSelected(account.id);
      setSearch('');
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

  const linked = (account: string): number =>
    networksOf(account).filter((network) => network.connected).length;
  const totalLinked = accounts.reduce((sum, account) => sum + linked(account.id), 0);

  const currentAccount = accounts.find((account) => account.id === selected) ?? accounts[0];
  const visibleAccounts = accounts.filter((account) =>
    `${account.name ?? ''} ${account.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  return (
    <section className="accounts">
      <header className="accounts__header">
        <div className="stack" style={{ gap: 8 }}>
          <h1 className="title-lg">Suas contas</h1>
          <p className="lead">Suas redes e rotinas, em um só lugar.</p>
        </div>
        <div className="accounts__summary">
          <span className="accounts__count">
            {accounts.length} {accounts.length === 1 ? 'conta' : 'contas'} · {totalLinked}{' '}
            {totalLinked === 1 ? 'rede conectada' : 'redes conectadas'}
          </span>
          <Button
            size="small"
            variant={creating ? 'ghost' : undefined}
            lead={creating ? <X /> : <Plus />}
            onClick={() => {
              setCreating((current) => !current);
            }}
          >
            {creating ? 'Fechar' : 'Nova conta'}
          </Button>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            key="new-account"
            className="account-new"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="account-new__inner">
              <label className="field">
                <span className="field__label">Identificador</span>
                <input
                  className="input"
                  placeholder="minha-conta"
                  value={id}
                  maxLength={32}
                  autoFocus
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
            <p className="muted small">
              Use letras minúsculas, números e hífen. Depois de criar, conecte as redes no cartão
              dela.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <PageLoading label="Carregando contas e redes…" />
      ) : loadError ? (
        <div className="panel stack" role="alert">
          <p>{loadError}</p>
          <Button
            size="small"
            onClick={() => {
              void load();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty">
          Nenhuma conta ainda. Clique em Nova conta para criar a primeira.
        </div>
      ) : (
        <div className="accounts__workspace">
          <aside className="accounts-sidebar" aria-label="Selecionar conta">
            <label className="accounts-sidebar__search">
              <Search size={15} />
              <input
                aria-label="Buscar conta"
                placeholder="Buscar conta…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="accounts-sidebar__list">
              {visibleAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className="accounts-sidebar__item"
                  aria-pressed={currentAccount?.id === account.id}
                  onClick={() => setSelected(account.id)}
                >
                  <span className="accounts-sidebar__avatar">
                    {account.logo ? (
                      <img src={`/api/accounts/${account.id}/logo?v=${String(stamp)}`} alt="" />
                    ) : (
                      (account.name ?? account.id).slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="accounts-sidebar__name">
                    <strong>{account.name ?? account.id}</strong>
                    <small
                      className={
                        warmings.some((s) => s.account === account.id && s.status === 'attention')
                          ? 'accounts-sidebar__attention'
                          : warmings.some((s) => s.account === account.id && s.status === 'running')
                            ? 'accounts-sidebar__running'
                            : ''
                      }
                    >
                      {warmings.some((s) => s.account === account.id && s.status === 'attention')
                        ? 'Precisa de atenção'
                        : warmings.some((s) => s.account === account.id && s.status === 'running')
                          ? 'Em aquecimento'
                          : `${linked(account.id)} redes conectadas`}
                    </small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
              {!visibleAccounts.length && (
                <p className="accounts-sidebar__empty">Nenhuma conta encontrada.</p>
              )}
            </div>
            <p className="accounts-sidebar__foot">Selecione uma conta para gerenciar suas redes.</p>
          </aside>
          <div className="accounts__detail">
            {accounts
              .filter((account) => account.id === currentAccount?.id)
              .map((account) => (
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
                    <span className="account-card__title">
                      <span className="row" style={{ gap: 8 }}>
                        <span className="key-row__name">{account.name ?? account.id}</span>
                        {account.isDefault && <span className="tag">padrão</span>}
                      </span>
                      <span className="muted small">
                        {account.id} · {linked(account.id)} de 3 redes conectadas
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
                            <span
                              className={`network__status ${network.connected ? 'network__status--on' : ''}`}
                            >
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
                                <span className="muted small">
                                  troque para Navegador em Postagem
                                </span>
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
                          <WarmingPanel
                            account={account.id}
                            platform={network.platform}
                            connected={
                              network.browserConnected ??
                              (network.method === 'browser' && network.connected)
                            }
                            connecting={working}
                            onConnect={() => {
                              void connect(account.id, network.platform);
                            }}
                            onDisconnect={
                              viaApi
                                ? () => {
                                    setBusy(key);
                                    void remove<NetworksOverview>(
                                      `/networks/${account.id}/${network.platform}/browser`,
                                    )
                                      .then(setOverview)
                                      .catch((caught: unknown) =>
                                        toast(
                                          caught instanceof Error
                                            ? caught.message
                                            : 'Não consegui desconectar a navegação.',
                                        ),
                                      )
                                      .finally(() => setBusy(null));
                                  }
                                : undefined
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
