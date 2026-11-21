'use client';

import { CalendarClock, Check, Download, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, post } from '@/lib/api';
import type { PublishOutcome, PublishPlatform, PublishStatus } from '@/lib/types';
import { useToast } from './toast';
import { Button, Choice, EASE, Segmented } from './ui';

const MAX_SELECTION = 50;

const PLATFORM_LABEL: Record<PublishPlatform, string> = {
  instagram: 'Instagram Reels',
  youtube: 'YouTube Shorts',
  tiktok: 'TikTok',
};

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

  useEffect(() => {
    if (!open) return;
    setWhen('now');
    setAt(defaultLater());
    void api<PublishStatus>('/publish/status')
      .then((data) => {
        setStatus(data);
        const first = data.targets[0];
        setAccount((current) =>
          data.targets.some((item) => item.account === current) ? current : (first?.account ?? ''),
        );
      })
      .catch((caught: unknown) => {
        toast(caught instanceof Error ? caught.message : 'não consegui ler as contas');
      });
  }, [open, toast]);

  const target = useMemo(
    () => status?.targets.find((item) => item.account === account) ?? null,
    [status, account],
  );

  useEffect(() => {
    setPlatforms(target?.platforms.filter((item) => item === 'instagram') ?? []);
  }, [target]);

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
            ) : status.targets.length === 0 ? (
              <div className="empty">
                Nenhuma conta tem credenciais de postagem. Cadastre com cortes-eb credentials set.
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
                    {status.targets.map((item) => (
                      <option key={item.account} value={item.account}>
                        {item.account}
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
                        {...(platform === 'youtube' ? { text: 'sai privado até a auditoria' } : {})}
                        onClick={() => {
                          setPlatforms((current) =>
                            current.includes(platform)
                              ? current.filter((item) => item !== platform)
                              : [...current, platform],
                          );
                        }}
                      />
                    ))}
                  </div>
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

function defaultLater(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return localInput(date);
}

function localInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
