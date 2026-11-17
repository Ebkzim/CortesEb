'use client';

import { Check, Copy, FolderOpen, Minus, RotateCcw, Square, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CameraPicker } from '@/components/camera-picker';
import { ClipCard } from '@/components/clip-card';
import { useToast } from '@/components/toast';
import { Progress, fade } from '@/components/ui';
import { api, post } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { STATUS_LABEL, clock, remaining } from '@/lib/format';
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
      <header className="job__head">
        <div className="stack" style={{ gap: 12 }}>
          <span className="row" style={{ gap: 10 }}>
            <span className={`status status--${job.status}`}>
              {active && <span className="status__dot" />}
              {STATUS_LABEL[job.status] ?? job.status}
            </span>
            <span className="muted small">criada às {clock(job.createdAt)}</span>
          </span>
          <h1 className="title-lg">{job.title}</h1>
        </div>
        <div className="row">
          {active && (
            <button
              type="button"
              className="button button--light"
              onClick={() => {
                void cancel();
              }}
            >
              {isLive ? 'Parar a live' : 'Cancelar'} <Square size={16} />
            </button>
          )}
          {['failed', 'canceled', 'interrupted'].includes(job.status) && (
            <button
              type="button"
              className="button button--dark"
              onClick={() => {
                void retry();
              }}
            >
              Tentar de novo <RotateCcw />
            </button>
          )}
          {job.status === 'done' && (
            <Link href="/clipes/" className="button button--dark">
              Abrir Meus clipes <FolderOpen />
            </Link>
          )}
        </div>
      </header>

      <section className="panel stack job__overall">
        <div className="spread">
          <span className="title-md">{Math.round(overall * 100)}%</span>
          <span className="muted small">
            {job.status === 'done'
              ? 'pronto'
              : job.status === 'waiting'
                ? 'esperando você'
                : active
                  ? isLive
                    ? 'acompanhando a live'
                    : remaining(remainingSeconds)
                  : ''}
          </span>
        </div>
        <Progress value={job.status === 'done' ? 1 : overall} active={job.status === 'running'} />
        {job.error !== null && <p className="job__error">{job.error}</p>}
      </section>

      <AnimatePresence>
        {job.status === 'waiting' && job.waiting?.kind === 'camera' && (
          <motion.section key="camera" className="panel stack" {...fade}>
            <span className="eyebrow">Sua vez</span>
            <h2 className="title-md">Onde está o rosto?</h2>
            <CameraPicker
              src={`/api/jobs/${job.id}/frame/${job.waiting.frame}`}
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

      <section className="steps">
        {job.steps.map((step, index) => (
          <StepRow key={step.id} step={step} index={index} />
        ))}
      </section>

      {(clips.length > 0 || isLive) && (
        <section className="stack">
          <div className="spread">
            <h2 className="title-md">Cortes prontos</h2>
            <span className="chip">{clips.length}</span>
          </div>
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
        <button
          type="button"
          className="button button--ghost button--small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setShowLogs((value) => !value);
          }}
        >
          {showLogs ? 'Esconder detalhes' : 'Ver detalhes técnicos'}
        </button>
        <AnimatePresence>
          {showLogs && (
            <motion.div
              className="logs"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
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
  );
}

function StepRow({ step, index }: { step: StepState; index: number }) {
  const running = step.status === 'running';
  return (
    <motion.div
      className={`step step--${step.status}`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="step__icon">
        {step.status === 'done' ? (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
          >
            <Check size={16} strokeWidth={3} />
          </motion.span>
        ) : step.status === 'running' ? (
          <span className="spinner" />
        ) : step.status === 'waiting' ? (
          <span className="step__wait pulse" />
        ) : step.status === 'failed' ? (
          <X size={16} strokeWidth={3} />
        ) : step.status === 'skipped' ? (
          <Minus size={16} />
        ) : (
          <span className="step__number">{index + 1}</span>
        )}
      </span>
      <div className="step__body">
        <div className="spread">
          <span className="step__label">{step.label}</span>
          {running && step.remainingSeconds !== null && (
            <span className="muted small">{remaining(step.remainingSeconds)}</span>
          )}
        </div>
        {(running || step.status === 'waiting' || step.status === 'failed') &&
          step.message !== '' && <span className="muted small">{step.message}</span>}
        {running && (
          <Progress
            value={step.fraction !== null && step.fraction > 0 ? step.fraction : null}
            active
          />
        )}
      </div>
    </motion.div>
  );
}

function AgentPanel({ waiting }: { waiting: Extract<JobView['waiting'], { kind: 'agent' }> }) {
  const [copied, setCopied] = useState(false);
  const name = waiting.agent === 'claude' ? 'Claude Code' : 'Codex';
  return (
    <>
      <span className="eyebrow">Sua vez</span>
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
        <button
          type="button"
          className="button button--dark button--small"
          onClick={() => {
            void navigator.clipboard.writeText(waiting.prompt).then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 2000);
            });
          }}
        >
          {copied ? 'Copiado' : 'Copiar prompt'} {copied ? <Check /> : <Copy />}
        </button>
        <span className="row muted small" style={{ gap: 8 }}>
          <span className="step__wait pulse" /> esperando o cuts.json
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
