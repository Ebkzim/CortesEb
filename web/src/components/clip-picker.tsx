'use client';

import { CalendarClock, Check, Download, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, post } from '@/lib/api';
import type { LoginWindowView, PublishOutcome, PublishPlatform, PublishStatus } from '@/lib/types';
import { useToast } from './toast';
import { Button, Choice, EASE, Segmented } from './ui';

const MAX_SELECTION = 50;

const PLATFORM_LABEL: Record<PublishPlatform, string> = {
  instagram: 'Instagram Reels',
  youtube: 'YouTube Shorts',
  tiktok: 'TikTok',
};

export const SITE_NAME: Record<PublishPlatform, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

const PLATFORM_ORDER: PublishPlatform[] = ['tiktok', 'instagram', 'youtube'];

export interface ClipSelection {
  selected: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  clear: () => void;
}

export function useClipSelection(): ClipSelection {
  const [selected, setSelected] = useState<string[]>([]);
  const has = useCallback((id: string) => selected.includes(id), [selected]);
  const toggle = useCallback((id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id].slice(-MAX_SELECTION),
    );
  }, []);
  const setAll = useCallback((ids: string[]) => {
    setSelected(ids.slice(0, MAX_SELECTION));
  }, []);
  const clear = useCallback(() => {
    setSelected([]);
  }, []);
  return { selected, has, toggle, setAll, clear };
}

export function SelectBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`select-box ${checked ? 'select-box--on' : ''}`}
      aria-pressed={checked}
      aria-label={checked ? 'tirar da seleção' : 'selecionar'}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <AnimatePresence>
        {checked && (
          <motion.span
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            style={{ display: 'grid' }}
          >
            <Check size={13} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

export function SelectionBar({
  all,
  selection,
  onPublish,
}: {
  all: string[];
  selection: ClipSelection;
  onPublish: (ids: string[]) => void;
}) {
  const visible = selection.selected.filter((id) => all.includes(id));
  const everything = all.length > 0 && all.slice(0, MAX_SELECTION).every(selection.has);
  return (
    <AnimatePresence>
      {visible.length > 0 && (
        <motion.div
          className="selection-bar"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          <span className="selection-bar__count">
            {visible.length} {visible.length === 1 ? 'selecionado' : 'selecionados'}
          </span>
          <button
            type="button"
            className="selection-bar__link"
            onClick={() => {
              if (everything) selection.clear();
              else selection.setAll(all);
            }}
          >
            {everything ? 'Limpar' : 'Selecionar todos'}
          </button>
          <span className="selection-bar__actions">
            <Button
              href={`/api/clips/zip?ids=${visible.join(',')}`}
              download
              variant="light"
              size="small"
              lead={<Download />}
            >
              Baixar ZIP
            </Button>
            <Button
              size="small"
              variant="light"
              lead={<Send />}
              onClick={() => {
                onPublish(visible);
              }}
            >
              Publicar
            </Button>
            <button
              type="button"
              className="icon-button selection-bar__close"
              aria-label="limpar seleção"
              onClick={selection.clear}
            >
              <X size={16} />
            </button>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type When = 'now' | 'later';

export function PublishDialog({
  clipIds,
  onClose,
  onDone,
}: {
  clipIds: string[] | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [account, setAccount] = useState<string>('');
  const [platforms, setPlatforms] = useState<PublishPlatform[]>([]);
  const [when, setWhen] = useState<When>('now');
  const [at, setAt] = useState<string>(defaultLater());
  const [sending, setSending] = useState(false);
  const open = clipIds !== null && clipIds.length > 0;

  const [connecting, setConnecting] = useState<PublishPlatform | null>(null);
  const [loginPhase, setLoginPhase] = useState<LoginWindowView['phase'] | null>(null);

  const load = useCallback(
    (quiet: boolean) =>
      api<PublishStatus>('/publish/status')
        .then((data) => {
          setStatus(data);
          const names = accountsOf(data);
          const first = data.targets[0]?.account ?? names[0] ?? '';
          setAccount((current) => (names.includes(current) ? current : first));
        })
        .catch((caught: unknown) => {
          if (!quiet)
            toast(caught instanceof Error ? caught.message : 'não consegui ler as contas');
        }),
    [toast],
  );

  useEffect(() => {
    if (!open) return;
    setWhen('now');
    setAt(defaultLater());
    setConnecting(null);
    void load(false);
  }, [open, load]);

  const target = useMemo(
    () => status?.targets.find((item) => item.account === account) ?? null,
    [status, account],
  );
  const connected = useMemo(() => target?.platforms ?? [], [target]);
  const missing = PLATFORM_ORDER.filter(
    (platform) => status?.methods[platform] === 'browser' && !connected.includes(platform),
  );
  const isPrivate = (platform: PublishPlatform): boolean =>
    platform === 'youtube' && status?.methods.youtube === 'api';

  useEffect(() => {
    if (connecting === null || !open) return;
    if (connected.includes(connecting)) {
      setConnecting(null);
      toast(`${SITE_NAME[connecting]} conectado.`);
      return;
    }
    const timer = window.setInterval(() => {
      void load(true);
      void api<LoginWindowView[]>('/desk/logins')
        .then((windows) => {
          const mine = windows.find(
            (item) => item.platform === connecting && item.account === account,
          );
          if (mine === undefined) return;
          setLoginPhase(mine.phase);
          if (mine.phase === 'failed') {
            setConnecting(null);
            toast(mine.message ?? `o login no ${SITE_NAME[connecting]} não foi concluído`);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [connecting, open, connected, load, account, toast]);

  useEffect(() => {
    setPlatforms(
      connected.filter((item) => !(item === 'youtube' && status?.methods.youtube === 'api')),
    );
  }, [connected, status]);

  async function connect(platform: PublishPlatform): Promise<void> {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
      await post('/desk/connect', { platform, account });
      setConnecting(platform);
      setLoginPhase('open');
      toast(
        `Abri uma janela do Chrome. Entre no ${SITE_NAME[platform]} por lá e feche a janela quando terminar.`,
      );
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : `não consegui abrir o ${SITE_NAME[platform]}`,
      );
    }
  }

  const count = clipIds?.length ?? 0;
  const laterDate = new Date(at);
  const validLater = !Number.isNaN(laterDate.getTime()) && laterDate.getTime() > Date.now();
  const ready = target !== null && platforms.length > 0 && (when === 'now' || validLater);

  async function submit(): Promise<void> {
    if (clipIds === null || !ready) return;
    setSending(true);
    try {
      const result = await post<PublishOutcome>('/publish', {
        clipIds,
        account,
        platforms,
        ...(when === 'later' ? { scheduledAt: laterDate.toISOString() } : {}),
      });
      const posts = result.queued.length;
      const base =
        when === 'now'
          ? `${String(posts)} ${posts === 1 ? 'post na fila' : 'posts na fila'}.`
          : `${String(posts)} ${posts === 1 ? 'post agendado' : 'posts agendados'} para ${laterDate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`;
      toast(
        result.workerRunning
          ? base
          : `${base} A postagem automática está desligada: rode cortes-eb service install.`,
      );
      onDone?.();
      onClose();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui publicar');
    } finally {
      setSending(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="lightbox__inner publish"
            initial={{ scale: 0.94, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 10 }}
            transition={{ duration: 0.4, ease: EASE }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="spread">
              <h2 className="title-md">
                Publicar {count} {count === 1 ? 'clipe' : 'clipes'}
              </h2>
              <button type="button" className="icon-button" aria-label="fechar" onClick={onClose}>
                <X size={18} />
              </button>
            </div>

            {status === null ? (
              <div className="row muted">
                <span className="spinner" /> carregando
              </div>
            ) : accountsOf(status).length === 0 ? (
              <div className="empty">
                Cadastre uma conta antes de publicar (cortes-eb account add).
              </div>
            ) : (
              <>
                <label className="field">
                  <span className="field__label">Conta</span>
                  <select
                    className="input"
                    value={account}
                    onChange={(event) => {
                      setAccount(event.target.value);
                    }}
                  >
                    {accountsOf(status).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="field">
                  <span className="field__label">Onde</span>
                  <div className="publish__platforms">
                    {(target?.platforms ?? []).map((platform) => (
                      <Choice
                        key={platform}
                        active={platforms.includes(platform)}
                        title={PLATFORM_LABEL[platform]}
                        {...(isPrivate(platform) ? { text: 'sai privado até a auditoria' } : {})}
                        onClick={() => {
                          setPlatforms((current) =>
                            current.includes(platform)
                              ? current.filter((item) => item !== platform)
                              : [...current, platform],
                          );
                        }}
                      />
                    ))}
                    {missing.map((platform) => (
                      <Choice
                        key={`connect-${platform}`}
                        active={false}
                        disabled={connecting !== null}
                        title={
                          connecting === platform
                            ? `Conectando ${SITE_NAME[platform]}`
                            : `Conectar ${SITE_NAME[platform]}`
                        }
                        text={
                          connecting !== platform
                            ? 'abre uma janela do Chrome para o login'
                            : loginPhase === 'checking'
                              ? 'conferindo a sessão'
                              : 'entre na janela do Chrome e feche ao terminar'
                        }
                        onClick={() => {
                          void connect(platform);
                        }}
                      />
                    ))}
                  </div>
                  {(target?.platforms.length ?? 0) === 0 && (
                    <span className="field__hint">Esta conta ainda não tem rede conectada.</span>
                  )}
                </div>

                <div className="field">
                  <span className="field__label">Quando</span>
                  <Segmented<When>
                    id="publish-when"
                    value={when}
                    onChange={setWhen}
                    options={[
                      { value: 'now', label: 'Postar agora' },
                      { value: 'later', label: 'Agendar' },
                    ]}
                  />
                  <AnimatePresence initial={false}>
                    {when === 'later' && (
                      <motion.input
                        key="at"
                        type="datetime-local"
                        className={`input ${validLater ? '' : 'input--error'}`}
                        value={at}
                        min={localInput(new Date())}
                        onChange={(event) => {
                          setAt(event.target.value);
                        }}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                      />
                    )}
                  </AnimatePresence>
                </div>

                <p className="muted small">
                  O texto e as hashtags que a IA escreveu para cada corte vão junto.
                  {count > 1
                    ? ' Vários clipes saem espaçados, respeitando o limite de posts por dia.'
                    : ''}
                </p>

                {!status.worker.running && (
                  <p className="publish__warning small">
                    A postagem automática está desligada. Rode uma vez no terminal:{' '}
                    <code>cortes-eb service install</code>
                  </p>
                )}

                <Button
                  disabled={!ready || sending}
                  lead={when === 'now' ? <Send /> : <CalendarClock />}
                  onClick={() => {
                    void submit();
                  }}
                >
                  {sending ? 'Enviando' : when === 'now' ? 'Postar agora' : 'Agendar'}
                </Button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function accountsOf(status: PublishStatus): string[] {
  return [...new Set([...status.accounts, ...status.targets.map((item) => item.account)])].sort();
}

function defaultLater(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return localInput(date);
}

function localInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
