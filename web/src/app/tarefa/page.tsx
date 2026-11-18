'use client';

import { ArrowLeft, Check, Copy, FolderOpen, RotateCcw, Square } from 'lucide-react';
import Link from 'next/link';
import { AnimatePresence, motion, useSpring, useTransform } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CameraPicker } from '@/components/camera-picker';
import { ClipCard } from '@/components/clip-card';
import { useToast } from '@/components/toast';
import { Button, EASE, Progress, fade } from '@/components/ui';
import { api, post } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { STATUS_LABEL, clock, duration, remaining } from '@/lib/format';
import type { ClipView, JobView, LogLine, StepState } from '@/lib/types';

interface Detail {
  job: JobView;
  clips: ClipView[];
  logs: LogLine[];
}

export default function JobPage() {
  return (
    <Suspense fallback={null}>
      <JobScreen />
    </Suspense>
  );
}

function JobScreen() {
  const id = useSearchParams().get('id');
  const router = useRouter();
  const toast = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [remainingSeconds, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const load = useCallback(() => {
    if (id === null) return;
    api<Detail>(`/jobs/${id}`)
      .then(setDetail)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'tarefa não encontrada');
      });
  }, [id]);

  useEffect(load, [load]);

  useJobEvents((event) => {
    if (event.jobId !== id) return;
    if (event.type === 'removed') {
      router.push('/');
      return;
    }
    setDetail((current) => {
      if (current === null) return current;
      if (event.type === 'job')
        return {
          ...current,
          job: {
            ...event.job,
            steps: current.job.steps.length > 0 ? current.job.steps : event.job.steps,
          },
        };
      if (event.type === 'steps')
        return { ...current, job: { ...current.job, steps: event.steps } };
      if (event.type === 'log')
        return {
          ...current,
          logs: [
            ...current.logs.slice(-199),
            { level: event.level, message: event.message, at: event.at },
          ],
        };
      return {
        ...current,
        clips: current.clips.some((clip) => clip.id === event.clip.id)
          ? current.clips
          : [...current.clips, event.clip],
      };
    });
    if (event.type === 'steps') setRemaining(event.remainingSeconds);
  });

  const overall = useMemo(() => overallFraction(detail?.job.steps ?? []), [detail?.job.steps]);

  if (id === null || error !== null) {
    return <div className="empty">{error ?? 'Nenhuma tarefa escolhida.'}</div>;
  }
  if (detail === null) {
    return (
      <div className="row muted">
        <span className="spinner" /> carregando
      </div>
    );
  }

  const { job, clips, logs } = detail;
  const active = job.status === 'running' || job.status === 'waiting' || job.status === 'queued';
  const isLive = job.kind === 'live';

  async function cancel(): Promise<void> {
    try {
      await post(`/jobs/${job.id}/cancel`);
      toast(isLive ? 'Parando a live. Os cortes prontos ficam salvos.' : 'Tarefa cancelada.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui cancelar');
    }
  }

  async function retry(): Promise<void> {
    try {
      const next = await post<JobView>(`/jobs/${job.id}/retry`);
      router.push(`/tarefa/?id=${next.id}`);
      setDetail(null);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui repetir');
    }
  }

  return (
    <div className="job">
      <div className="job__main">
        <header className="job__head">
          <div className="stack" style={{ gap: 10 }}>
            <span className={`status status--${job.status}`}>
              {active && <span className="dot dot--live" />}
              {STATUS_LABEL[job.status] ?? job.status} · {clock(job.createdAt)}
            </span>
            <h1 className="title-lg">{job.title}</h1>
            {job.batchId !== null && (
              <Link href={`/fila/?id=${job.batchId}`} className="link-arrow">
                <ArrowLeft size={15} /> voltar para a fila
              </Link>
            )}
          </div>
        </header>

        <AnimatePresence>
          {job.status === 'waiting' && job.waiting?.kind === 'camera' && (
            <motion.section key="camera" className="panel stack" {...fade}>
              <h2 className="title-md">Onde está o rosto?</h2>
              <CameraPicker
                key={job.waiting.frame}
                jobId={job.id}
                frame={job.waiting.frame}
                timeline={
                  job.waiting.duration === undefined
                    ? null
                    : {
                        duration: job.waiting.duration,
                        at: job.waiting.at ?? 0,
                        strip: job.waiting.strip ?? [],
                      }
                }
                suggestion={job.waiting.suggestion}
                onConfirm={(rect) => {
                  void post(`/jobs/${job.id}/camera`, rect).catch((caught: unknown) => {
                    toast(caught instanceof Error ? caught.message : 'não consegui enviar');
                  });
                }}
              />
            </motion.section>
          )}
          {job.status === 'waiting' && job.waiting?.kind === 'agent' && (
            <motion.section key="agent" className="panel stack" {...fade}>
              <AgentPanel waiting={job.waiting} />
            </motion.section>
          )}
        </AnimatePresence>

        {(clips.length > 0 || isLive) && (
          <section className="stack">
            <h2 className="title-md">Cortes prontos · {clips.length}</h2>
            {clips.length === 0 ? (
              <div className="empty">Os cortes aparecem aqui assim que ficam prontos.</div>
            ) : (
              <div className="clips">
                {clips.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} />
                ))}
              </div>
            )}
          </section>
        )}

        <section className="stack">
          <div>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setShowLogs((value) => !value);
              }}
            >
              {showLogs ? 'Esconder detalhes' : 'Ver detalhes técnicos'}
            </Button>
          </div>
          <AnimatePresence>
            {showLogs && (
              <motion.div
                className="logs"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                {logs.length === 0 ? (
                  <p className="muted small">Sem mensagens.</p>
                ) : (
                  logs.map((line, index) => (
                    <p
                      key={`${line.at}-${String(index)}`}
                      className={`logs__line logs__line--${line.level}`}
                    >
                      <span>{clock(line.at)}</span> {line.message}
                    </p>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <aside className="job__side">
        <div className="meter">
          <AnimatedPercent value={job.status === 'done' ? 1 : overall} />
          <Progress value={job.status === 'done' ? 1 : overall} active={job.status === 'running'} />
          <span className="muted small">
            {job.status === 'done'
              ? 'pronto'
              : job.status === 'waiting'
                ? 'esperando você'
                : active
                  ? isLive
                    ? 'acompanhando a live'
                    : remaining(remainingSeconds)
                  : (STATUS_LABEL[job.status] ?? '').toLowerCase()}
          </span>
          {job.error !== null && <p className="job__error">{job.error}</p>}
          <div className="row wrap">
            {active && (
              <Button
                variant="light"
                size="small"
                lead={<Square size={14} />}
                onClick={() => {
                  void cancel();
                }}
              >
                {isLive ? 'Parar a live' : 'Cancelar'}
              </Button>
            )}
            {['failed', 'canceled', 'interrupted'].includes(job.status) && (
              <Button
                size="small"
                icon={<RotateCcw />}
                onClick={() => {
                  void retry();
                }}
              >
                Tentar de novo
              </Button>
            )}
            {job.status === 'done' && (
              <Button href="/clipes/" size="small" icon={<FolderOpen />}>
                Meus clipes
              </Button>
            )}
          </div>
        </div>
        <ol className="timeline">
          {job.steps.map((step, index) => (
            <TimelineStep key={step.id} step={step} index={index} />
          ))}
        </ol>
      </aside>
    </div>
  );
}

function AnimatedPercent({ value }: { value: number }) {
  const spring = useSpring(value * 100, { stiffness: 80, damping: 20 });
  const text = useTransform(spring, (current) => `${String(Math.round(current))}%`);
  useEffect(() => {
    spring.set(value * 100);
  }, [spring, value]);
  return <motion.span className="meter__value">{text}</motion.span>;
}

function TimelineStep({ step, index }: { step: StepState; index: number }) {
  const running = step.status === 'running';
  const took =
    step.status === 'done' && step.startedAt !== null && step.finishedAt !== null
      ? (Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000
      : null;
  return (
    <motion.li
      className={`tl tl--${step.status}`}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.45, ease: EASE }}
    >
      <span className="tl__mark">
        {step.status === 'done' ? (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            style={{ display: 'grid' }}
          >
            <span className="tl__ring" />
          </motion.span>
        ) : (
          <span className="tl__ring" />
        )}
      </span>
      <div className="tl__body">
        <div className="tl__head">
          <span>{step.label}</span>
          <span className="tl__meta">
            {running
              ? step.fraction !== null && step.fraction > 0
                ? `${String(Math.round(step.fraction * 100))}%`
                : ''
              : took !== null && took >= 1
                ? duration(took)
                : step.status === 'pending' && step.estimateSeconds !== null
                  ? `~${duration(step.estimateSeconds)}`
                  : ''}
          </span>
        </div>
        <AnimatePresence initial={false}>
          {(running || step.status === 'waiting' || step.status === 'failed') &&
            step.message !== '' && (
              <motion.span
                className="tl__message"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {step.message}
                {running && step.remainingSeconds !== null
                  ? ` · ${remaining(step.remainingSeconds)}`
                  : ''}
              </motion.span>
            )}
        </AnimatePresence>
        {running && (
          <Progress
            value={step.fraction !== null && step.fraction > 0 ? step.fraction : null}
            active
          />
        )}
      </div>
    </motion.li>
  );
}

function AgentPanel({ waiting }: { waiting: Extract<JobView['waiting'], { kind: 'agent' }> }) {
  const [copied, setCopied] = useState(false);
  const name = waiting.agent === 'claude' ? 'Claude Code' : 'Codex';
  return (
    <>
      <h2 className="title-md">Cole este prompt no {name}</h2>
      <ol className="agent-steps">
        <li>
          Abra o terminal e inicie o {name} (
          <span className="kbd">{waiting.agent === 'claude' ? 'claude' : 'codex'}</span>).
        </li>
        <li>Copie o prompt abaixo e cole lá.</li>
        <li>Quando ele terminar, o painel percebe sozinho e continua.</li>
      </ol>
      <div className="code">{waiting.prompt}</div>
      <div className="row">
        <Button
          size="small"
          icon={copied ? <Check /> : <Copy />}
          onClick={() => {
            void navigator.clipboard.writeText(waiting.prompt).then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 2000);
            });
          }}
        >
          {copied ? 'Copiado' : 'Copiar prompt'}
        </Button>
        <span className="row muted small" style={{ gap: 8 }}>
          <span className="dot dot--live" /> esperando o {name} terminar
        </span>
      </div>
      {waiting.problems.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="field__label">O arquivo ainda tem problemas</span>
          {waiting.problems.map((problem) => (
            <span key={problem} className="small muted">
              • {problem}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function overallFraction(steps: StepState[]): number {
  const counted = steps.filter((step) => step.status !== 'skipped');
  if (counted.length === 0) return 0;
  const total = counted.reduce((sum, step) => {
    if (step.status === 'done') return sum + 1;
    if (step.status === 'running' || step.status === 'waiting') return sum + (step.fraction ?? 0);
    return sum;
  }, 0);
  return Math.min(1, total / counted.length);
}
