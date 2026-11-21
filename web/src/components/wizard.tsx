'use client';

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Clapperboard,
  Cpu,
  Film,
  Gamepad2,
  KeyRound,
  Mic,
  Minus,
  Plus,
  Radio,
  ScanFace,
  Sparkles,
  Tv,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePanelRouter as useRouter } from '@/components/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PresetPreview } from '@/components/preset-preview';
import { useToast } from '@/components/toast';
import { Button, Choice, EASE, Progress, Segmented, fade } from '@/components/ui';
import { KeyForm } from '@/components/key-form';
import { Avatar } from '@/components/profiles';
import { api, post, upload } from '@/lib/api';
import { duration, parseClock } from '@/lib/format';
import { PLATFORM_LABEL, linkError } from '@/lib/links';
import type {
  AccountView,
  ApiKeyView,
  JobBottom,
  JobRequest,
  JobSelector,
  JobSource,
  JobTargets,
  JobView,
  PlatformId,
  Preset,
  PresetId,
} from '@/lib/types';

const STEPS = ['Tipo', 'Quantidade', 'Origem', 'Inteligência', 'Revisão'];
const QUEUE_STEPS = ['Tipo', 'Quantidade', 'Contas e vídeos', 'Inteligência', 'Revisão'];

interface QueueItem {
  key: string;
  source: JobSource;
  label: string;
  brain: 'default' | 'local' | 'api';
}

function mainVariant(variants: Preset[]): Preset | undefined {
  return variants.find((item) => item.variant === 'cena') ?? variants[0];
}

const PRESET_ICON: Partial<Record<PresetId, ReactNode>> = {
  'gameplay-camera': <Gamepad2 size={20} />,
  react: <Sparkles size={20} />,
  filmes: <Film size={20} />,
  series: <Tv size={20} />,
  podcast: <Mic size={20} />,
};

type SourceKind = 'file' | 'youtube' | 'vod' | 'live';

const SOURCE_OPTIONS: { kind: SourceKind; icon: ReactNode; title: string; text: string }[] = [
  { kind: 'file', icon: <Upload size={18} />, title: 'Arquivo', text: 'Um vídeo do computador.' },
  { kind: 'youtube', icon: <Video size={18} />, title: 'YouTube', text: 'Um vídeo publicado.' },
  {
    kind: 'vod',
    icon: <Clapperboard size={18} />,
    title: 'VOD de live',
    text: 'Twitch, Kick ou YouTube.',
  },
  {
    kind: 'live',
    icon: <Radio size={18} />,
    title: 'Live agora',
    text: 'Corta enquanto a live roda.',
  },
];
type SelectorKind = JobSelector['kind'];

interface OllamaState {
  reachable: boolean;
  models: string[];
}

export function Wizard({ queue }: { queue: boolean }) {
  const steps = queue ? QUEUE_STEPS : STEPS;
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [hovered, setHovered] = useState<PresetId | null>(null);
  const [openGroup, setOpenGroup] = useState<'filmes' | 'series' | null>(null);
  const [mode, setMode] = useState<'count' | 'duration'>('count');
  const [count, setCount] = useState(3);
  const [minSeconds, setMinSeconds] = useState(30);
  const [maxSeconds, setMaxSeconds] = useState(60);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [platform, setPlatform] = useState<PlatformId>('twitch');
  const [link, setLink] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [uploadState, setUploadState] = useState<{ id: string; name: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [bottomMode, setBottomMode] = useState<'default' | 'source' | 'other'>('default');
  const [bottomKind, setBottomKind] = useState<'url' | 'file'>('url');
  const [bottomLink, setBottomLink] = useState('');
  const [bottomUpload, setBottomUpload] = useState<{ id: string; name: string } | null>(null);
  const [bottomProgress, setBottomProgress] = useState<number | null>(null);
  const [selectorKind, setSelectorKind] = useState<SelectorKind | null>(null);
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [keyId, setKeyId] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState(false);
  const [ollama, setOllama] = useState<OllamaState | null>(null);
  const [ollamaModel, setOllamaModel] = useState('');
  const [agent, setAgent] = useState<'claude' | 'codex'>('claude');
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [chosenAccounts, setChosenAccounts] = useState<string[]>([]);
  const [watermark, setWatermark] = useState<'on' | 'off'>('off');
  const [title, setTitle] = useState('');
  const [sending, setSending] = useState(false);
  const [queueItems, setQueueItems] = useState<Record<string, QueueItem[]>>({});
  const [runMode, setRunMode] = useState<'queue' | 'together'>('queue');

  useEffect(() => {
    void api<Preset[]>('/presets').then(setPresets);
    void api<ApiKeyView[]>('/keys')
      .then(setKeys)
      .catch(() => undefined);
    void api<AccountView[]>('/accounts')
      .then((list) => {
        setAccounts(list);
        setChosenAccounts(list.filter((item) => item.isDefault).map((item) => item.id));
        setWatermark(list.length > 0 ? 'on' : 'off');
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if ((!queue && selectorKind !== 'ollama') || ollama !== null) return;
    void api<OllamaState>('/ollama')
      .then((state) => {
        setOllama(state);
        if (state.models[0] !== undefined)
          setOllamaModel((current) => current || (state.models[0] ?? ''));
      })
      .catch(() => {
        setOllama({ reachable: false, models: [] });
      });
  }, [selectorKind, ollama, queue]);

  const isLive = !queue && sourceKind === 'live';
  const queueGroups = useMemo(
    () => (accounts.length > 0 ? accounts.map((item) => item.id) : ['']),
    [accounts],
  );
  const queueTotal = queueGroups.reduce((sum, ref) => sum + (queueItems[ref]?.length ?? 0), 0);
  const queueAccounts = queueGroups.filter((ref) => (queueItems[ref]?.length ?? 0) > 0).length;
  const entries = useMemo(() => {
    const list: (
      | { kind: 'preset'; preset: Preset }
      | { kind: 'group'; group: 'filmes' | 'series'; variants: Preset[] }
    )[] = [];
    for (const item of presets) {
      if (item.group === null) {
        list.push({ kind: 'preset', preset: item });
        continue;
      }
      const existing = list.find((entry) => entry.kind === 'group' && entry.group === item.group);
      if (existing?.kind === 'group') existing.variants.push(item);
      else list.push({ kind: 'group', group: item.group, variants: [item] });
    }
    return list;
  }, [presets]);
  const chosenPreset = presets.find((item) => item.id === preset) ?? null;
  const previewPreset =
    presets.find((item) => item.id === (step === 0 ? (hovered ?? preset) : preset)) ?? null;

  const targets: JobTargets | null = useMemo(() => {
    if (mode === 'count') return count >= 1 && count <= 20 ? { mode, count } : null;
    if (minSeconds < 10 || maxSeconds > 180 || maxSeconds < minSeconds) return null;
    return { mode, minSeconds, maxSeconds };
  }, [mode, count, minSeconds, maxSeconds]);

  const sourceProblem = useMemo((): string | null => {
    if (sourceKind === null) return 'escolha de onde vem o vídeo';
    if (sourceKind === 'file') return uploadState === null ? 'envie o arquivo' : null;
    const target = sourceKind === 'youtube' ? 'youtube' : platform;
    const error = linkError(link, target);
    if (error !== null) return error;
    if (sourceKind === 'vod' && (from !== '' || to !== '')) {
      const start = parseClock(from) ?? 0;
      const end = parseClock(to);
      if (end === null) return 'informe o fim do trecho';
      if (end <= start) return 'o fim do trecho vem antes do início';
    }
    return null;
  }, [sourceKind, uploadState, platform, link, from, to]);

  const source: JobSource | null = useMemo(() => {
    if (sourceProblem !== null || sourceKind === null) return null;
    if (sourceKind === 'file' && uploadState !== null)
      return { type: 'file', uploadId: uploadState.id };
    if (sourceKind === 'youtube') return { type: 'youtube', url: link.trim() };
    if (sourceKind === 'live') return { type: 'live', platform, url: link.trim() };
    const start = parseClock(from);
    const end = parseClock(to);
    return {
      type: 'vod',
      platform,
      url: link.trim(),
      ...(start === null || end === null ? {} : { from: start, to: end }),
    };
  }, [sourceProblem, sourceKind, uploadState, link, platform, from, to]);

  const selector: JobSelector | null = useMemo(() => {
    if (selectorKind === 'api') return keyId === null ? null : { kind: 'api', keyId };
    if (selectorKind === 'ollama')
      return ollamaModel === '' ? null : { kind: 'ollama', model: ollamaModel };
    if (selectorKind === 'agent') return isLive || queue ? null : { kind: 'agent', agent };
    if (selectorKind === 'rules') return isLive ? { kind: 'rules' } : null;
    return null;
  }, [selectorKind, keyId, ollamaModel, agent, isLive, queue]);

  const allowedSources: SourceKind[] = chosenPreset?.sources ?? ['file', 'youtube', 'vod', 'live'];

  useEffect(() => {
    if (sourceKind !== null && !allowedSources.includes(sourceKind)) setSourceKind(null);
    setQueueItems((current) =>
      Object.fromEntries(
        Object.entries(current).map(([ref, items]) => [
          ref,
          items.filter((item) => allowedSources.includes(item.source.type)),
        ]),
      ),
    );
    setBottomMode(chosenPreset?.bottom === 'niche' ? 'default' : 'source');
  }, [preset]);

  const bottomProblem = useMemo((): string | null => {
    if (bottomMode !== 'other') return null;
    if (bottomKind === 'file') return bottomUpload === null ? 'envie o vídeo de baixo' : null;
    return linkError(bottomLink, 'youtube');
  }, [bottomMode, bottomKind, bottomUpload, bottomLink]);

  const bottomChoice: JobBottom | undefined = useMemo(() => {
    if (bottomMode === 'default') return undefined;
    if (bottomMode === 'source') return { type: 'source' };
    if (bottomKind === 'file')
      return bottomUpload === null ? undefined : { type: 'file', uploadId: bottomUpload.id };
    return { type: 'url', url: bottomLink.trim() };
  }, [bottomMode, bottomKind, bottomUpload, bottomLink]);

  async function sendBottom(file: File): Promise<void> {
    setBottomProgress(0);
    setBottomUpload(null);
    try {
      const result = await upload<{ uploadId: string; name: string }>(
        '/uploads',
        file,
        setBottomProgress,
      );
      setBottomUpload({ id: result.uploadId, name: result.name });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'falha no envio');
    } finally {
      setBottomProgress(null);
    }
  }

  const canAdvance = [
    preset !== null,
    targets !== null,
    (queue ? queueTotal > 0 : source !== null) && bottomProblem === null,
    selector !== null,
    true,
  ][step];

  const localSelector: JobSelector | null = useMemo(() => {
    const model = ollamaModel || ollama?.models[0];
    return ollama?.reachable === true && model !== undefined && model !== ''
      ? { kind: 'ollama', model }
      : null;
  }, [ollama, ollamaModel]);
  const apiSelector: JobSelector | null = useMemo(() => {
    const id = keyId ?? keys[0]?.id;
    return id === undefined ? null : { kind: 'api', keyId: id };
  }, [keyId, keys]);

  const brainOptions = [
    ...(localSelector === null || selector?.kind === 'ollama'
      ? []
      : [{ value: 'local' as const, label: 'IA local' }]),
    ...(apiSelector === null || selector?.kind === 'api'
      ? []
      : [{ value: 'api' as const, label: 'API' }]),
  ];

  function selectorOf(item: QueueItem): JobSelector | null {
    if (item.brain === 'local') return localSelector;
    if (item.brain === 'api') return apiSelector;
    return null;
  }

  function setBrain(ref: string, key: string, brain: QueueItem['brain']): void {
    setQueueItems((current) => ({
      ...current,
      [ref]: (current[ref] ?? []).map((item) => (item.key === key ? { ...item, brain } : item)),
    }));
  }

  async function startQueue(): Promise<void> {
    if (preset === null || targets === null || selector === null || queueTotal === 0) return;
    setSending(true);
    try {
      const result = await post<{ batch: { id: string } }>('/batches', {
        preset,
        targets,
        selector,
        mode: runMode,
        ...(bottomChoice === undefined ? {} : { bottom: bottomChoice }),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        items: queueGroups
          .filter((ref) => (queueItems[ref]?.length ?? 0) > 0)
          .map((ref) => ({
            account: ref === '' ? null : ref,
            videos: (queueItems[ref] ?? []).map((item) => {
              const chosen = item.source.type === 'live' ? null : selectorOf(item);
              return chosen === null
                ? { source: item.source }
                : { source: item.source, selector: chosen };
            }),
          })),
      });
      router.push(`/fila/?id=${result.batch.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'não consegui começar a fila');
      setSending(false);
    }
  }

  async function start(): Promise<void> {
    if (queue) {
      await startQueue();
      return;
    }
    if (preset === null || targets === null || source === null || selector === null) return;
    setSending(true);
    const request: JobRequest = {
      preset,
      source,
      targets,
      selector,
      ...(bottomChoice === undefined ? {} : { bottom: bottomChoice }),
      ...(title.trim() === '' ? {} : { title: title.trim() }),
      ...(watermark === 'on' && chosenAccounts.length > 0 ? { accounts: chosenAccounts } : {}),
    };
    try {
      const job = await post<JobView>('/jobs', request);
      router.push(`/tarefa/?id=${job.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'não consegui começar');
      setSending(false);
    }
  }

  async function sendFile(file: File): Promise<void> {
    setUploadProgress(0);
    setUploadState(null);
    try {
      const result = await upload<{ uploadId: string; name: string }>(
        '/uploads',
        file,
        setUploadProgress,
      );
      setUploadState({ id: result.uploadId, name: result.name });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'falha no envio');
    } finally {
      setUploadProgress(null);
    }
  }

  const summary: { label: string; value: string }[] = [];
  if (chosenPreset !== null) summary.push({ label: 'Tipo', value: chosenPreset.label });
  if (step > 0 && targets !== null) {
    summary.push({
      label: 'Quantidade',
      value:
        targets.mode === 'count'
          ? `${String(targets.count)} ${targets.count === 1 ? 'corte' : 'cortes'}`
          : `de ${duration(targets.minSeconds)} a ${duration(targets.maxSeconds)}`,
    });
  }
  if (step > 1 && queue && queueTotal > 0) {
    summary.push({
      label: 'Origem',
      value: `${String(queueTotal)} ${queueTotal === 1 ? 'vídeo' : 'vídeos'} · ${String(queueAccounts)} ${queueAccounts === 1 ? 'conta' : 'contas'}`,
    });
  }
  if (step > 1 && !queue && source !== null) {
    summary.push({ label: 'Origem', value: sourceLabel(source, uploadState?.name) });
  }
  if (step > 2 && selector !== null) {
    summary.push({ label: 'Inteligência', value: selectorLabel(selector, keys) });
  }

  const goNext = (): void => {
    setStep((value) => Math.min(steps.length - 1, value + 1));
  };

  const bottomSection = (queue ? queueTotal > 0 : sourceKind !== null) &&
    chosenPreset !== null &&
    chosenPreset.frame !== 'fit' && (
      <motion.div className="panel stack" {...fade}>
        <span className="field__label">O que vai embaixo?</span>
        <Segmented
          id="bottom"
          value={bottomMode}
          options={[
            ...(chosenPreset.bottom === 'niche'
              ? [
                  {
                    value: 'default' as const,
                    label: chosenPreset.below.charAt(0).toUpperCase() + chosenPreset.below.slice(1),
                  },
                ]
              : []),
            { value: 'source' as const, label: 'O próprio vídeo' },
            { value: 'other' as const, label: 'Outro vídeo' },
          ]}
          onChange={setBottomMode}
        />
        <AnimatePresence mode="wait">
          {bottomMode === 'other' ? (
            <motion.div key="other" className="stack" {...fade}>
              <Segmented
                id="bottom-kind"
                value={bottomKind}
                options={[
                  { value: 'url', label: 'Link do YouTube' },
                  { value: 'file', label: 'Arquivo' },
                ]}
                onChange={setBottomKind}
              />
              {bottomKind === 'url' ? (
                <label className="field">
                  <input
                    className={`input ${bottomLink !== '' && bottomProblem !== null ? 'input--error' : ''}`}
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={bottomLink}
                    onChange={(event) => {
                      setBottomLink(event.target.value);
                    }}
                  />
                  {bottomLink !== '' && bottomProblem !== null && (
                    <span className="field__hint">{bottomProblem}</span>
                  )}
                </label>
              ) : (
                <Dropzone
                  name={bottomUpload?.name ?? null}
                  progress={bottomProgress}
                  onFile={(file) => {
                    void sendBottom(file);
                  }}
                />
              )}
              <span className="field__hint">
                Ex.: gameplay sem som, um trailer ou um vídeo satisfatório. Ele toca sem áudio
                embaixo do corte.
              </span>
            </motion.div>
          ) : (
            <motion.p key={bottomMode} className="field__hint" {...fade}>
              {bottomMode === 'default'
                ? `Embaixo entra o ${chosenPreset.below}, baixado uma vez e reaproveitado.`
                : chosenPreset.id === 'podcast'
                  ? 'Um lado da conversa em cima e o outro embaixo.'
                  : 'A metade de baixo mostra o próprio vídeo (o jogo ou a cena).'}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    );

  return (
    <div className="wizard">
      <div className="wizard__main">
        <Phases
          labels={steps}
          step={step}
          onJump={(index) => {
            if (index < step) setStep(index);
          }}
        />
        <Summary
          items={summary}
          onJump={(index) => {
            setStep(index);
          }}
        />
        <section key={step} className="wizard__step page--enter">
          {step === 0 && (
            <>
              <Heading
                title="Que tipo de corte?"
                text="Passe o mouse para ver como fica cada um."
              />
              <div className="grid grid--3">
                {entries.map((entry) =>
                  entry.kind === 'preset' ? (
                    <Choice
                      key={entry.preset.id}
                      active={preset === entry.preset.id}
                      icon={PRESET_ICON[entry.preset.id]}
                      title={entry.preset.label}
                      text={entry.preset.description}
                      onClick={() => {
                        setPreset(entry.preset.id);
                        setOpenGroup(null);
                      }}
                      onHover={(inside) => {
                        setHovered(inside ? entry.preset.id : null);
                      }}
                    />
                  ) : (
                    <Choice
                      key={entry.group}
                      active={chosenPreset?.group === entry.group || openGroup === entry.group}
                      icon={entry.group === 'filmes' ? <Film size={20} /> : <Tv size={20} />}
                      title={entry.group === 'filmes' ? 'Filmes' : 'Séries'}
                      text="React ou só a cena. Clique para escolher."
                      onClick={() => {
                        setOpenGroup(entry.group);
                        if (chosenPreset?.group !== entry.group)
                          setPreset(mainVariant(entry.variants)?.id ?? null);
                      }}
                      onHover={(inside) => {
                        setHovered(inside ? (mainVariant(entry.variants)?.id ?? null) : null);
                      }}
                    />
                  ),
                )}
              </div>
              <AnimatePresence>
                {openGroup !== null && (
                  <motion.div
                    key={openGroup}
                    className="variants"
                    initial={{ opacity: 0, height: 0, y: -8 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -8 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    <span className="field__label">
                      {openGroup === 'filmes'
                        ? 'Que tipo de corte de filme?'
                        : 'Que tipo de corte de série?'}
                    </span>
                    <div className="grid grid--2">
                      {presets
                        .filter((item) => item.group === openGroup)
                        .map((item, index) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.08 + index * 0.06, duration: 0.4, ease: EASE }}
                          >
                            <Choice
                              active={preset === item.id}
                              icon={
                                item.variant === 'cena' ? (
                                  <Clapperboard size={18} />
                                ) : (
                                  <ScanFace size={18} />
                                )
                              }
                              title={item.variant === 'cena' ? 'Só a cena' : 'React'}
                              text={item.description}
                              onClick={() => {
                                setPreset(item.id);
                              }}
                              onHover={(inside) => {
                                setHovered(inside ? item.id : null);
                              }}
                            />
                          </motion.div>
                        ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {step === 1 && (
            <>
              <Heading
                title="Quantos cortes?"
                text="Pela quantidade ou pela duração de cada corte."
              />
              <Segmented
                id="targets"
                value={mode}
                options={[
                  { value: 'count', label: 'Quantidade' },
                  { value: 'duration', label: 'Duração' },
                ]}
                onChange={setMode}
              />
              <AnimatePresence mode="wait">
                {mode === 'count' ? (
                  <motion.div key="count" className="panel counter" {...fade}>
                    <div className="counter__row">
                      <motion.button
                        whileTap={{ scale: 0.88 }}
                        type="button"
                        className="counter__button"
                        onClick={() => {
                          setCount((value) => Math.max(1, value - 1));
                        }}
                        aria-label="menos"
                      >
                        <Minus size={20} />
                      </motion.button>
                      <div className="counter__value">
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={count}
                            className="counter__number"
                            initial={{ y: 24, opacity: 0, filter: 'blur(4px)' }}
                            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                            exit={{ y: -24, opacity: 0, filter: 'blur(4px)' }}
                            transition={{ duration: 0.35, ease: EASE }}
                          >
                            {count}
                          </motion.span>
                        </AnimatePresence>
                        <span className="counter__unit">{count === 1 ? 'corte' : 'cortes'}</span>
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.88 }}
                        type="button"
                        className="counter__button"
                        onClick={() => {
                          setCount((value) => Math.min(20, value + 1));
                        }}
                        aria-label="mais"
                      >
                        <Plus size={20} />
                      </motion.button>
                    </div>
                    <input
                      className="counter__range"
                      type="range"
                      min={1}
                      max={20}
                      value={count}
                      style={{ ['--fill' as string]: `${String(((count - 1) / 19) * 100)}%` }}
                      onChange={(event) => {
                        setCount(Number(event.target.value));
                      }}
                      aria-label="quantidade de cortes"
                    />
                    <p className="muted small">
                      A duração de cada corte se ajusta ao tamanho do vídeo.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div key="duration" className="panel stack" {...fade}>
                    <div className="grid grid--2">
                      <DurationInput label="Mínimo" value={minSeconds} onChange={setMinSeconds} />
                      <DurationInput label="Máximo" value={maxSeconds} onChange={setMaxSeconds} />
                    </div>
                    <p className="small muted">
                      {targets === null
                        ? 'Cada corte vai de 10 s a 3 min, e o máximo não pode ser menor que o mínimo.'
                        : `Cada corte terá entre ${duration(minSeconds)} e ${duration(maxSeconds)}. A quantidade sai do tamanho do vídeo.`}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {step === 2 && queue && (
            <>
              <Heading
                title="Que vídeos vão para cada conta?"
                text="Adicione quantos quiser em cada conta. Tudo roda sozinho, e cada corte aparece assim que fica pronto."
              />
              <div className="queue">
                {queueGroups.map((ref, index) => (
                  <QueueAccount
                    key={ref || 'sem-conta'}
                    index={index}
                    account={accounts.find((item) => item.id === ref) ?? null}
                    items={queueItems[ref] ?? []}
                    allowed={allowedSources}
                    onAdd={(item) => {
                      setQueueItems((current) => ({
                        ...current,
                        [ref]: [...(current[ref] ?? []), item],
                      }));
                    }}
                    onRemove={(key) => {
                      setQueueItems((current) => ({
                        ...current,
                        [ref]: (current[ref] ?? []).filter((item) => item.key !== key),
                      }));
                    }}
                  />
                ))}
              </div>
              {bottomSection}
            </>
          )}

          {step === 2 && !queue && (
            <>
              <Heading
                title="De onde vem o vídeo?"
                text={
                  allowedSources.includes('live')
                    ? 'Um arquivo, um link ou uma live no ar agora.'
                    : 'Um arquivo ou um link.'
                }
              />
              <div className={`grid grid--${String(Math.max(2, allowedSources.length))}`}>
                {SOURCE_OPTIONS.filter((option) => allowedSources.includes(option.kind)).map(
                  (option) => (
                    <Choice
                      key={option.kind}
                      active={sourceKind === option.kind}
                      icon={option.icon}
                      title={option.title}
                      text={option.text}
                      onClick={() => {
                        setSourceKind(option.kind);
                        if (option.kind === 'live' && selectorKind === 'agent')
                          setSelectorKind(null);
                        if (option.kind !== 'live' && selectorKind === 'rules')
                          setSelectorKind(null);
                      }}
                    />
                  ),
                )}
              </div>
              <AnimatePresence mode="wait">
                {sourceKind !== null && (
                  <motion.div key={sourceKind} className="panel stack" {...fade}>
                    {sourceKind === 'file' && (
                      <Dropzone
                        name={uploadState?.name ?? null}
                        progress={uploadProgress}
                        onFile={(file) => {
                          void sendFile(file);
                        }}
                      />
                    )}
                    {(sourceKind === 'vod' || sourceKind === 'live') && (
                      <Segmented
                        id="platform"
                        value={platform}
                        options={(['twitch', 'kick', 'youtube'] as const).map((value) => ({
                          value,
                          label: PLATFORM_LABEL[value],
                        }))}
                        onChange={setPlatform}
                      />
                    )}
                    {sourceKind !== 'file' && (
                      <label className="field">
                        <span className="field__label">
                          {sourceKind === 'live'
                            ? `Link da live na ${PLATFORM_LABEL[platform]}`
                            : sourceKind === 'vod'
                              ? `Link do VOD na ${PLATFORM_LABEL[platform]}`
                              : 'Link do vídeo'}
                        </span>
                        <input
                          className={`input ${link !== '' && sourceProblem !== null ? 'input--error' : ''}`}
                          placeholder="https://"
                          value={link}
                          onChange={(event) => {
                            setLink(event.target.value);
                          }}
                          autoFocus
                        />
                        <AnimatePresence>
                          {link !== '' && sourceProblem !== null && (
                            <motion.span
                              className="field__hint"
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                            >
                              {sourceProblem}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </label>
                    )}
                    {sourceKind === 'vod' && (
                      <div className="grid grid--2">
                        <label className="field">
                          <span className="field__label">Começar em (opcional)</span>
                          <input
                            className="input"
                            placeholder="1:20:00"
                            value={from}
                            onChange={(event) => {
                              setFrom(event.target.value);
                            }}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">Terminar em (opcional)</span>
                          <input
                            className="input"
                            placeholder="1:45:00"
                            value={to}
                            onChange={(event) => {
                              setTo(event.target.value);
                            }}
                          />
                        </label>
                        <p className="field__hint" style={{ gridColumn: '1 / -1' }}>
                          Em lives longas, baixar só um trecho é bem mais rápido.
                        </p>
                      </div>
                    )}
                    {sourceKind === 'live' && (
                      <p className="field__hint">
                        O painel acompanha a live e salva cada momento forte, até ela acabar ou você
                        parar.
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              {bottomSection}
            </>
          )}

          {step === 3 && (
            <>
              <Heading
                title="Quem escolhe os cortes?"
                text={
                  queue
                    ? 'A fila roda sozinha, então quem escolhe é uma chave de API ou a IA local.'
                    : isLive
                      ? 'Na live os momentos são detectados sozinhos. Uma IA pode avaliar cada um.'
                      : 'Uma IA lê a transcrição e escolhe os melhores ganchos.'
                }
              />
              <div className={`grid grid--${queue ? '2' : '3'}`}>
                <Choice
                  active={selectorKind === 'api'}
                  icon={<KeyRound size={18} />}
                  title="Chave de API"
                  text="Claude, OpenAI ou compatível."
                  onClick={() => {
                    setSelectorKind('api');
                  }}
                />
                <Choice
                  active={selectorKind === 'ollama'}
                  icon={<Cpu size={18} />}
                  title="IA local"
                  text="Ollama no seu computador."
                  onClick={() => {
                    setSelectorKind('ollama');
                  }}
                />
                {queue ? null : isLive ? (
                  <Choice
                    active={selectorKind === 'rules'}
                    icon={<Wand2 size={18} />}
                    title="Só regras"
                    text="Volume e chat, sem IA."
                    onClick={() => {
                      setSelectorKind('rules');
                    }}
                  />
                ) : (
                  <Choice
                    active={selectorKind === 'agent'}
                    icon={<Bot size={18} />}
                    title="Claude ou Codex"
                    text="Um prompt pronto no terminal."
                    onClick={() => {
                      setSelectorKind('agent');
                    }}
                  />
                )}
              </div>
              <AnimatePresence mode="wait">
                {selectorKind === 'api' && (
                  <motion.div key="api" className="panel stack" {...fade}>
                    {keys.length > 0 && !addingKey && (
                      <div className="stack" style={{ gap: 8 }}>
                        {keys.map((key) => (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            key={key.id}
                            type="button"
                            className={`key-row ${keyId === key.id ? 'key-row--active' : ''}`}
                            onClick={() => {
                              setKeyId(key.id);
                            }}
                          >
                            <KeyRound size={16} />
                            <span className="key-row__name">{key.label}</span>
                            <span className="muted small">
                              {providerLabel(key.provider)} · {key.model ?? 'modelo padrão'} ·{' '}
                              {key.hint}
                            </span>
                          </motion.button>
                        ))}
                      </div>
                    )}
                    {addingKey ? (
                      <KeyForm
                        onCancel={() => {
                          setAddingKey(false);
                        }}
                        onSaved={(key) => {
                          setKeys((current) => [key, ...current]);
                          setKeyId(key.id);
                          setAddingKey(false);
                          toast('Chave guardada com criptografia.');
                        }}
                      />
                    ) : (
                      <Button
                        variant="light"
                        size="small"
                        lead={<Plus />}
                        onClick={() => {
                          setAddingKey(true);
                        }}
                      >
                        Adicionar uma chave
                      </Button>
                    )}
                  </motion.div>
                )}
                {selectorKind === 'ollama' && (
                  <motion.div key="ollama" className="panel stack" {...fade}>
                    {ollama === null ? (
                      <div className="row muted">
                        <span className="spinner" /> procurando o Ollama
                      </div>
                    ) : !ollama.reachable ? (
                      <div className="stack">
                        <p>O Ollama não respondeu.</p>
                        <p className="muted small">
                          Abra o Ollama ou rode <span className="kbd">ollama serve</span> num
                          terminal.
                        </p>
                        <Button
                          variant="light"
                          size="small"
                          onClick={() => {
                            setOllama(null);
                          }}
                        >
                          Procurar de novo
                        </Button>
                      </div>
                    ) : ollama.models.length === 0 ? (
                      <p className="muted">
                        Sem modelos. Rode <span className="kbd">ollama pull qwen2.5:7b</span> e
                        procure de novo.
                      </p>
                    ) : (
                      <label className="field">
                        <span className="field__label">Modelo</span>
                        <select
                          className="input"
                          value={ollamaModel}
                          onChange={(event) => {
                            setOllamaModel(event.target.value);
                          }}
                        >
                          {ollama.models.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                        <span className="field__hint">
                          Modelos maiores escolhem melhor e demoram mais sem placa de vídeo.
                        </span>
                      </label>
                    )}
                  </motion.div>
                )}
                {selectorKind === 'agent' && (
                  <motion.div key="agent" className="panel stack" {...fade}>
                    <Segmented
                      id="agent"
                      value={agent}
                      options={[
                        { value: 'claude', label: 'Claude Code' },
                        { value: 'codex', label: 'Codex' },
                      ]}
                      onChange={setAgent}
                    />
                    <p className="muted small" style={{ lineHeight: 1.6 }}>
                      O painel baixa e transcreve o vídeo e mostra um prompt pronto. Você cola no{' '}
                      {agent === 'claude' ? 'Claude Code' : 'Codex'}, ele escolhe os cortes e o
                      painel termina sozinho. Usa a sua assinatura, sem chave de API.
                    </p>
                  </motion.div>
                )}
                {selectorKind === 'rules' && (
                  <motion.div key="rules" className="panel" {...fade}>
                    <p className="muted small" style={{ lineHeight: 1.6 }}>
                      Os momentos saem do pico de volume e, na Twitch, da explosão do chat. É o mais
                      rápido, mas não avalia o gancho.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {step === 4 && (
            <>
              <Heading
                title="Tudo certo?"
                text={
                  queue
                    ? 'A fila roda sozinha. Pode deixar o computador trabalhando.'
                    : 'Confira e comece. Você acompanha cada etapa ao vivo.'
                }
              />
              <div className="panel stack">
                <label className="field">
                  <span className="field__label">Nome (opcional)</span>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Ex.: Live do sábado"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                  />
                </label>
                {queue ? (
                  <div className="queue-review">
                    <div className="field">
                      <span className="field__label">Como rodar</span>
                      <Segmented
                        id="run-mode"
                        value={runMode}
                        options={[
                          { value: 'queue', label: 'Em fila' },
                          { value: 'together', label: 'Simultâneo' },
                        ]}
                        onChange={setRunMode}
                      />
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={runMode}
                          className="field__hint"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.25, ease: EASE }}
                        >
                          {runMode === 'queue'
                            ? 'Um vídeo por vez: termina um e começa o próximo. Mais leve para o computador.'
                            : 'Todos começam juntos: baixam, transcrevem e escolhem lado a lado, e cada corte sai assim que fica pronto. As partes pesadas se revezam para não travar o computador.'}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                    {queueGroups
                      .filter((ref) => (queueItems[ref]?.length ?? 0) > 0)
                      .map((ref) => {
                        const account = accounts.find((item) => item.id === ref) ?? null;
                        const items = queueItems[ref] ?? [];
                        return (
                          <div key={ref || 'sem-conta'} className="queue-review__group">
                            <div className="queue-review__row">
                              {account !== null ? (
                                <Avatar account={account} size={30} />
                              ) : (
                                <span className="queue__blank">
                                  <Film size={14} />
                                </span>
                              )}
                              <span className="queue-review__name">
                                {account?.name ?? account?.id ?? 'Sem conta'}
                              </span>
                              <span className="muted small">
                                {items.length} {items.length === 1 ? 'vídeo' : 'vídeos'}
                              </span>
                            </div>
                            {items.map((item) => (
                              <div key={item.key} className="queue-review__video">
                                <span className="queue__kind">{queueKindLabel(item.source)}</span>
                                <span className="queue__label">{item.label}</span>
                                {item.source.type === 'live' || brainOptions.length === 0 ? (
                                  <span className="muted small">IA padrão</span>
                                ) : (
                                  <Segmented
                                    id={`brain-${item.key}`}
                                    value={item.brain}
                                    options={[
                                      { value: 'default' as const, label: 'Padrão' },
                                      ...brainOptions,
                                    ]}
                                    onChange={(next) => {
                                      setBrain(ref, item.key, next);
                                    }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    <span className="field__hint">
                      Padrão usa{' '}
                      {selector === null ? 'a IA escolhida' : selectorLabel(selector, keys)}.{' '}
                      {brainOptions.length > 0
                        ? 'Troque em cada vídeo se quiser.'
                        : 'Com uma chave de API ou o Ollama aberto, dá para escolher a IA de cada vídeo.'}{' '}
                      Cada conta recebe a própria marca d’água, e os vídeos alternam entre as contas
                      para todas receberem cortes desde o começo.
                    </span>
                  </div>
                ) : accounts.length > 0 ? (
                  <div className="watermark">
                    <span className="field__label">Colocar marca d’água?</span>
                    <Segmented
                      id="watermark"
                      value={watermark}
                      options={[
                        { value: 'on', label: 'Com marca d’água' },
                        { value: 'off', label: 'Sem marca d’água' },
                      ]}
                      onChange={(next) => {
                        setWatermark(next);
                        if (next === 'on' && chosenAccounts.length === 0) {
                          const fallback = accounts.find((item) => item.isDefault) ?? accounts[0];
                          if (fallback !== undefined) setChosenAccounts([fallback.id]);
                        }
                      }}
                    />
                    <AnimatePresence initial={false}>
                      {watermark === 'on' && (
                        <motion.div
                          className="watermark__accounts"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.35, ease: EASE }}
                        >
                          {accounts.map((account) => {
                            const on = chosenAccounts.includes(account.id);
                            return (
                              <motion.button
                                whileTap={{ scale: 0.94 }}
                                key={account.id}
                                type="button"
                                className={`watermark__account ${on ? 'watermark__account--on' : ''}`}
                                onClick={() => {
                                  setChosenAccounts((current) =>
                                    on
                                      ? current.filter((value) => value !== account.id)
                                      : [...current, account.id],
                                  );
                                }}
                              >
                                <Avatar account={account} size={32} />
                                {account.name ?? account.id}
                              </motion.button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <span className="field__hint">
                      {watermark === 'off'
                        ? 'O corte sai limpo, sem nome nem logo.'
                        : chosenAccounts.length === 0
                          ? 'Escolha pelo menos um perfil, ou marque sem marca d’água.'
                          : chosenAccounts.length > 1
                            ? 'Sai uma versão do corte para cada perfil.'
                            : 'O nome e a logo do perfil vão no canto do corte.'}
                    </span>
                  </div>
                ) : (
                  <p className="muted small">
                    Os cortes saem sem marca d’água. Crie um perfil na página inicial se quiser
                    usar.
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        <div className="wizard__nav">
          <Button
            variant="ghost"
            lead={<ArrowLeft />}
            onClick={() => {
              setStep((value) => Math.max(0, value - 1));
            }}
            disabled={step === 0}
          >
            Voltar
          </Button>
          {step < steps.length - 1 ? (
            <Button icon={<ArrowRight />} disabled={canAdvance !== true} onClick={goNext}>
              Próximo
            </Button>
          ) : (
            <Button
              icon={<ArrowRight />}
              disabled={
                sending ||
                (!queue && watermark === 'on' && accounts.length > 0 && chosenAccounts.length === 0)
              }
              onClick={() => {
                void start();
              }}
            >
              {sending ? 'Começando…' : queue ? 'Começar a fila' : 'Começar os cortes'}
            </Button>
          )}
        </div>
      </div>

      <aside className="wizard__side">
        <PresetPreview preset={previewPreset} />
      </aside>
    </div>
  );
}

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <header className="stack" style={{ gap: 8 }}>
      <h1 className="title-lg">{title}</h1>
      <p className="lead">{text}</p>
    </header>
  );
}

function Phases({
  labels,
  step,
  onJump,
}: {
  labels: string[];
  step: number;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="phases">
      {labels.map((label, index) => (
        <li key={label}>
          <button
            type="button"
            className={`phase ${index === step ? 'is-current' : ''} ${index < step ? 'is-done' : ''}`}
            onClick={() => {
              onJump(index);
            }}
            disabled={index >= step}
          >
            <span className="phase__bar">
              <motion.span
                className="phase__fill"
                initial={false}
                animate={{ scaleX: index < step ? 1 : index === step ? 0.35 : 0 }}
                transition={{ duration: 0.7, ease: EASE }}
              />
            </span>
            <span className="phase__label">{label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Summary({
  items,
  onJump,
}: {
  items: { label: string; value: string }[];
  onJump: (index: number) => void;
}) {
  return (
    <motion.div className="summary" layout>
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <motion.button
            key={item.label}
            type="button"
            layout
            className="summary__token"
            title={`Alterar ${item.label.toLowerCase()}`}
            onClick={() => {
              onJump(index);
            }}
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: EASE }}
            whileTap={{ scale: 0.95 }}
          >
            {item.value}
          </motion.button>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function DurationInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (seconds: number) => void;
}) {
  const [unit, setUnit] = useState<'s' | 'min'>(value >= 60 ? 'min' : 's');
  const [text, setText] = useState(String(value >= 60 ? Number((value / 60).toFixed(2)) : value));
  function update(raw: string, nextUnit: 's' | 'min'): void {
    setText(raw);
    const number = Number(raw.replace(',', '.'));
    if (!Number.isFinite(number) || raw.trim() === '') return;
    const seconds = Math.round(nextUnit === 'min' ? number * 60 : number);
    onChange(seconds);
    if (nextUnit === 's' && seconds > 60) {
      setUnit('min');
      setText(String(Number((seconds / 60).toFixed(2))));
    }
  }
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <div className="duration-input">
        <input
          className="input"
          inputMode="decimal"
          value={text}
          onChange={(event) => {
            update(event.target.value, unit);
          }}
        />
        <Segmented
          id={`unit-${label}`}
          value={unit}
          options={[
            { value: 's', label: 's' },
            { value: 'min', label: 'min' },
          ]}
          onChange={(next) => {
            setUnit(next);
            setText(String(next === 'min' ? Number((value / 60).toFixed(2)) : value));
          }}
        />
      </div>
      <span className="field__hint">{duration(value)}</span>
    </label>
  );
}

function Dropzone({
  name,
  progress,
  onFile,
  multiple,
}: {
  name: string | null;
  progress: number | null;
  onFile: (file: File) => void;
  multiple?: boolean;
}) {
  const take = (list: FileList | null | undefined): void => {
    const files = [...(list ?? [])];
    for (const file of multiple === true ? files : files.slice(0, 1)) onFile(file);
  };
  const [over, setOver] = useState(false);
  return (
    <motion.label
      className={`dropzone ${over ? 'dropzone--over' : ''}`}
      whileTap={{ scale: 0.99 }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files);
      }}
    >
      <input
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v,.avi"
        hidden
        multiple={multiple}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
      <Upload size={22} />
      {progress !== null ? (
        <div className="stack" style={{ width: '100%', maxWidth: 360, gap: 8 }}>
          <span>Enviando {Math.round(progress * 100)}%</span>
          <Progress value={progress} active />
        </div>
      ) : name !== null ? (
        <span>
          <strong>{name}</strong> enviado. Clique para trocar.
        </span>
      ) : (
        <span>
          {multiple === true ? 'Arraste os vídeos aqui ou ' : 'Arraste o vídeo aqui ou '}
          <u>{multiple === true ? 'escolha arquivos' : 'escolha um arquivo'}</u>
        </span>
      )}
      <span className="muted small">MP4, MOV, MKV ou WEBM, até 8 GB</span>
    </motion.label>
  );
}

function QueueAccount({
  index,
  account,
  items,
  allowed,
  onAdd,
  onRemove,
}: {
  index: number;
  account: AccountView | null;
  items: QueueItem[];
  allowed: SourceKind[];
  onAdd: (item: QueueItem) => void;
  onRemove: (key: string) => void;
}) {
  const toast = useToast();
  const kinds = SOURCE_OPTIONS.filter((option) => allowed.includes(option.kind));
  const [chosen, setChosen] = useState<SourceKind>('youtube');
  const kind = allowed.includes(chosen) ? chosen : (kinds[0]?.kind ?? 'youtube');
  const [platform, setPlatform] = useState<PlatformId>('twitch');
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  function addLink(): void {
    const target = kind === 'youtube' ? 'youtube' : platform;
    const error = linkError(link, target);
    if (error !== null) {
      setProblem(error);
      return;
    }
    const url = link.trim();
    const source: JobSource =
      kind === 'youtube'
        ? { type: 'youtube', url }
        : kind === 'live'
          ? { type: 'live', platform, url }
          : { type: 'vod', platform, url };
    onAdd({ key: crypto.randomUUID(), source, label: shortLink(url), brain: 'default' });
    setLink('');
    setProblem(null);
  }

  async function addFile(file: File): Promise<void> {
    setProgress(0);
    try {
      const result = await upload<{ uploadId: string; name: string }>(
        '/uploads',
        file,
        setProgress,
      );
      onAdd({
        key: crypto.randomUUID(),
        source: { type: 'file', uploadId: result.uploadId },
        label: result.name,
        brain: 'default',
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'falha no envio');
    } finally {
      setProgress(null);
    }
  }

  return (
    <motion.section
      className="queue__account"
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: EASE }}
    >
      <header className="queue__head">
        {account !== null ? (
          <Avatar account={account} size={38} />
        ) : (
          <span className="queue__blank">
            <Film size={16} />
          </span>
        )}
        <span className="queue__who">
          <strong>{account?.name ?? account?.id ?? 'Sem conta'}</strong>
          <span className="muted small">
            {items.length === 0
              ? 'nenhum vídeo ainda'
              : `${String(items.length)} ${items.length === 1 ? 'vídeo' : 'vídeos'} na fila`}
          </span>
        </span>
      </header>
      <AnimatePresence initial={false}>
        {items.map((item, position) => (
          <motion.div
            key={item.key}
            layout
            className="queue__item"
            initial={{ opacity: 0, height: 0, x: -8 }}
            animate={{ opacity: 1, height: 'auto', x: 0 }}
            exit={{ opacity: 0, height: 0, x: 8 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <span className="queue__index">{position + 1}</span>
            <span className="queue__kind">{queueKindLabel(item.source)}</span>
            <span className="queue__label">{item.label}</span>
            <motion.button
              type="button"
              className="queue__remove"
              aria-label="tirar da fila"
              whileTap={{ scale: 0.85 }}
              onClick={() => {
                onRemove(item.key);
              }}
            >
              <X size={14} />
            </motion.button>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="queue__add">
        <div className="row wrap" style={{ gap: 8 }}>
          <Segmented
            id={`queue-kind-${String(index)}`}
            value={kind}
            options={kinds.map((option) => ({ value: option.kind, label: option.title }))}
            onChange={(next) => {
              setChosen(next);
              setProblem(null);
            }}
          />
          {(kind === 'vod' || kind === 'live') && (
            <Segmented
              id={`queue-platform-${String(index)}`}
              value={platform}
              options={(['twitch', 'kick', 'youtube'] as const).map((value) => ({
                value,
                label: PLATFORM_LABEL[value],
              }))}
              onChange={setPlatform}
            />
          )}
        </div>
        {kind === 'file' ? (
          <Dropzone
            multiple
            name={null}
            progress={progress}
            onFile={(file) => {
              chain.current = chain.current.then(() => addFile(file));
            }}
          />
        ) : (
          <div className="queue__link">
            <input
              className={`input ${problem !== null ? 'input--error' : ''}`}
              placeholder={
                kind === 'live'
                  ? `Link da live na ${PLATFORM_LABEL[platform]}`
                  : kind === 'vod'
                    ? `Link do VOD na ${PLATFORM_LABEL[platform]}`
                    : 'Link do vídeo no YouTube'
              }
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addLink();
                }
              }}
            />
            <Button
              variant="light"
              size="small"
              lead={<Plus />}
              disabled={link.trim() === ''}
              onClick={addLink}
            >
              Adicionar
            </Button>
          </div>
        )}
        {problem !== null && <span className="field__hint">{problem}</span>}
      </div>
    </motion.section>
  );
}

function queueKindLabel(source: JobSource): string {
  if (source.type === 'file') return 'Arquivo';
  if (source.type === 'youtube') return 'YouTube';
  if (source.type === 'vod') return `VOD ${PLATFORM_LABEL[source.platform]}`;
  return `Live ${PLATFORM_LABEL[source.platform]}`;
}

function shortLink(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    const text = `${parsed.hostname.replace(/^www\./, '')}${tail}`;
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  } catch {
    return url;
  }
}

function providerLabel(provider: ApiKeyView['provider']): string {
  return provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'Compatível';
}

function sourceLabel(source: JobSource, fileName: string | undefined): string {
  if (source.type === 'file') return fileName ?? 'arquivo';
  if (source.type === 'youtube') return 'YouTube';
  if (source.type === 'live') return `Live na ${PLATFORM_LABEL[source.platform]}`;
  const section =
    source.from !== undefined && source.to !== undefined
      ? ` · ${duration(source.from)} a ${duration(source.to)}`
      : '';
  return `VOD ${PLATFORM_LABEL[source.platform]}${section}`;
}

function selectorLabel(selector: JobSelector, keys: ApiKeyView[]): string {
  if (selector.kind === 'api')
    return keys.find((key) => key.id === selector.keyId)?.label ?? 'chave de API';
  if (selector.kind === 'ollama') return `IA local · ${selector.model}`;
  if (selector.kind === 'agent') return selector.agent === 'claude' ? 'Claude Code' : 'Codex';
  return 'Só regras';
}
