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
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PresetPreview } from '@/components/preset-preview';
import { useToast } from '@/components/toast';
import { Button, Choice, EASE, Progress, Segmented, fade } from '@/components/ui';
import { KeyForm } from '@/components/key-form';
import { api, post, upload } from '@/lib/api';
import { duration, parseClock } from '@/lib/format';
import { PLATFORM_LABEL, linkError } from '@/lib/links';
import type {
  AccountView,
  ApiKeyView,
  JobRequest,
  JobSelector,
  JobSource,
  JobTargets,
  JobView,
  PlatformId,
  Preset,
  PresetId,
} from '@/lib/types';

const STEPS = ['Tipo', 'Quantidade', 'Origem', 'Inteligência', 'Revisão'] as const;

const PRESET_ICON: Record<PresetId, ReactNode> = {
  'gameplay-camera': <ScanFace size={20} />,
  'gta6-gameplay': <Gamepad2 size={20} />,
  'gta6-react': <Sparkles size={20} />,
  filmes: <Film size={20} />,
  series: <Tv size={20} />,
  podcast: <Mic size={20} />,
};

type SourceKind = 'file' | 'youtube' | 'vod' | 'live';
type SelectorKind = JobSelector['kind'];

interface OllamaState {
  reachable: boolean;
  models: string[];
}

export default function NewCutPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [hovered, setHovered] = useState<PresetId | null>(null);
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
  const [selectorKind, setSelectorKind] = useState<SelectorKind | null>(null);
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [keyId, setKeyId] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState(false);
  const [ollama, setOllama] = useState<OllamaState | null>(null);
  const [ollamaModel, setOllamaModel] = useState('');
  const [agent, setAgent] = useState<'claude' | 'codex'>('claude');
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [chosenAccounts, setChosenAccounts] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void api<Preset[]>('/presets').then(setPresets);
    void api<ApiKeyView[]>('/keys')
      .then(setKeys)
      .catch(() => undefined);
    void api<AccountView[]>('/accounts')
      .then((list) => {
        setAccounts(list);
        setChosenAccounts(list.filter((item) => item.isDefault).map((item) => item.id));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (selectorKind !== 'ollama' || ollama !== null) return;
    void api<OllamaState>('/ollama')
      .then((state) => {
        setOllama(state);
        if (state.models[0] !== undefined)
          setOllamaModel((current) => current || (state.models[0] ?? ''));
      })
      .catch(() => {
        setOllama({ reachable: false, models: [] });
      });
  }, [selectorKind, ollama]);

  const isLive = sourceKind === 'live';
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
    if (selectorKind === 'agent') return isLive ? null : { kind: 'agent', agent };
    if (selectorKind === 'rules') return isLive ? { kind: 'rules' } : null;
    return null;
  }, [selectorKind, keyId, ollamaModel, agent, isLive]);

  const canAdvance = [preset !== null, targets !== null, source !== null, selector !== null, true][
    step
  ];

  async function start(): Promise<void> {
    if (preset === null || targets === null || source === null || selector === null) return;
    setSending(true);
    const request: JobRequest = {
      preset,
      source,
      targets,
      selector,
      ...(title.trim() === '' ? {} : { title: title.trim() }),
      ...(chosenAccounts.length > 0 ? { accounts: chosenAccounts } : {}),
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
  if (step > 1 && source !== null)
    summary.push({ label: 'Origem', value: sourceLabel(source, uploadState?.name) });
  if (step > 2 && selector !== null) {
    summary.push({ label: 'Inteligência', value: selectorLabel(selector, keys) });
  }

  const goNext = (): void => {
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
  };

  return (
    <div className="wizard">
      <div className="wizard__main">
        <Phases
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
        <AnimatePresence mode="wait">
          <motion.section key={step} className="wizard__step" {...fade}>
            {step === 0 && (
              <>
                <Heading
                  title="Que tipo de corte?"
                  text="Passe o mouse para ver como fica cada um."
                />
                <div className="grid grid--3">
                  {presets.map((item) => (
                    <Choice
                      key={item.id}
                      active={preset === item.id}
                      icon={PRESET_ICON[item.id]}
                      title={item.label}
                      text={item.description}
                      onClick={() => {
                        setPreset(item.id);
                      }}
                      onHover={(inside) => {
                        setHovered(inside ? item.id : null);
                      }}
                    />
                  ))}
                </div>
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

            {step === 2 && (
              <>
                <Heading
                  title="De onde vem o vídeo?"
                  text="Um arquivo, um link ou uma live no ar agora."
                />
                <div className="grid grid--4">
                  <Choice
                    active={sourceKind === 'file'}
                    icon={<Upload size={18} />}
                    title="Arquivo"
                    text="Um vídeo do computador."
                    onClick={() => {
                      setSourceKind('file');
                    }}
                  />
                  <Choice
                    active={sourceKind === 'youtube'}
                    icon={<Video size={18} />}
                    title="YouTube"
                    text="Um vídeo publicado."
                    onClick={() => {
                      setSourceKind('youtube');
                    }}
                  />
                  <Choice
                    active={sourceKind === 'vod'}
                    icon={<Clapperboard size={18} />}
                    title="VOD de live"
                    text="Twitch, Kick ou YouTube."
                    onClick={() => {
                      setSourceKind('vod');
                    }}
                  />
                  <Choice
                    active={sourceKind === 'live'}
                    icon={<Radio size={18} />}
                    title="Live agora"
                    text="Corta enquanto a live roda."
                    onClick={() => {
                      setSourceKind('live');
                      if (selectorKind === 'agent') setSelectorKind(null);
                    }}
                  />
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
                          O painel acompanha a live e salva cada momento forte, até ela acabar ou
                          você parar.
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {step === 3 && (
              <>
                <Heading
                  title="Quem escolhe os cortes?"
                  text={
                    isLive
                      ? 'Na live os momentos são detectados sozinhos. Uma IA pode avaliar cada um.'
                      : 'Uma IA lê a transcrição e escolhe os melhores ganchos.'
                  }
                />
                <div className="grid grid--3">
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
                  {isLive ? (
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
                        Os momentos saem do pico de volume e, na Twitch, da explosão do chat. É o
                        mais rápido, mas não avalia o gancho.
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
                  text="Confira e comece. Você acompanha cada etapa ao vivo."
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
                  {accounts.length > 0 && (
                    <div className="field">
                      <span className="field__label">Marca d’água</span>
                      <div className="row wrap">
                        {accounts.map((account) => {
                          const on = chosenAccounts.includes(account.id);
                          return (
                            <motion.button
                              whileTap={{ scale: 0.94 }}
                              key={account.id}
                              type="button"
                              className={`chip ${on ? 'chip--dark' : ''}`}
                              onClick={() => {
                                setChosenAccounts((current) =>
                                  on
                                    ? current.filter((id) => id !== account.id)
                                    : [...current, account.id],
                                );
                              }}
                            >
                              {account.name ?? account.id}
                            </motion.button>
                          );
                        })}
                      </div>
                      <span className="field__hint">
                        Sem conta marcada, o corte sai sem marca d’água.
                      </span>
                    </div>
                  )}
                  {accounts.length === 0 && (
                    <p className="muted small">
                      Os cortes saem sem marca d’água. Cadastre contas na engrenagem se quiser.
                    </p>
                  )}
                </div>
              </>
            )}
          </motion.section>
        </AnimatePresence>

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
          {step < STEPS.length - 1 ? (
            <Button icon={<ArrowRight />} disabled={canAdvance !== true} onClick={goNext}>
              Próximo
            </Button>
          ) : (
            <Button
              icon={<ArrowRight />}
              disabled={sending}
              onClick={() => {
                void start();
              }}
            >
              {sending ? 'Começando…' : 'Começar os cortes'}
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

function Phases({ step, onJump }: { step: number; onJump: (index: number) => void }) {
  return (
    <ol className="phases">
      {STEPS.map((label, index) => (
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
}: {
  name: string | null;
  progress: number | null;
  onFile: (file: File) => void;
}) {
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
        const file = event.dataTransfer.files[0];
        if (file !== undefined) onFile(file);
      }}
    >
      <input
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v,.avi"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onFile(file);
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
          Arraste o vídeo aqui ou <u>escolha um arquivo</u>
        </span>
      )}
      <span className="muted small">MP4, MOV, MKV ou WEBM, até 8 GB</span>
    </motion.label>
  );
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
