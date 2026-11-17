'use client';

import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui';
import { api } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { STATUS_LABEL, clock, dayLabel } from '@/lib/format';
import type { JobView, StepState } from '@/lib/types';

interface Health {
  database: boolean;
  ffmpeg: boolean;
  ytdlp: boolean;
  whisper: boolean;
  ollama: boolean;
}

export default function HomePage() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    void api<{ jobs: JobView[] }>('/jobs?limit=12').then((data) => {
      setJobs(data.jobs);
    });
    void api<Health>('/health')
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  useJobEvents((event) => {
    setJobs((current) => {
      if (current === null) return current;
      if (event.type === 'job') {
        const exists = current.some((job) => job.id === event.jobId);
        return exists
          ? current.map((job) =>
              job.id === event.jobId ? { ...event.job, steps: job.steps } : job,
            )
          : [event.job, ...current];
      }
      if (event.type === 'steps') {
        return current.map((job) =>
          job.id === event.jobId ? { ...job, steps: event.steps } : job,
        );
      }
      return current;
    });
  });

  const active = (jobs ?? []).filter((job) =>
    ['queued', 'running', 'waiting'].includes(job.status),
  );
  const recent = (jobs ?? []).filter(
    (job) => !['queued', 'running', 'waiting'].includes(job.status),
  );

  return (
    <div className="stack" style={{ gap: 56 }}>
      <section className="hero">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="stack"
          style={{ gap: 22 }}
        >
          <span className="eyebrow">Cortes verticais</span>
          <h1 className="title-xl">
            Vídeo longo entra.
            <br />
            <span className="muted">Corte pronto sai.</span>
          </h1>
          <p className="lead">
            Escolha o tipo, a quantidade e a origem. O painel baixa, transcreve, escolhe os melhores
            ganchos e entrega tudo organizado por dia.
          </p>
          <div className="row wrap">
            <Link href="/novo/" className="button button--dark">
              Novo corte <ArrowRight />
            </Link>
            <Link href="/clipes/" className="button button--light">
              Meus clipes
            </Link>
          </div>
        </motion.div>
        {health !== null && (
          <motion.div
            className="health"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {(
              [
                ['Banco', health.database],
                ['FFmpeg', health.ffmpeg],
                ['yt-dlp', health.ytdlp],
                ['Transcrição', health.whisper],
                ['IA local', health.ollama],
              ] as const
            ).map(([label, ok]) => (
              <span key={label} className={`chip ${ok ? '' : 'chip--off'}`}>
                <span className={`health__dot ${ok ? 'is-ok' : ''}`} />
                {label}
              </span>
            ))}
          </motion.div>
        )}
      </section>

      {active.length > 0 && (
        <section className="stack">
          <h2 className="title-md">Em andamento</h2>
          <div className="grid grid--2">
            {active.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <h2 className="title-md">Recentes</h2>
        {jobs === null ? (
          <div className="row muted">
            <span className="spinner" /> carregando
          </div>
        ) : recent.length === 0 ? (
          <div className="empty">Nenhum corte ainda. Comece pelo botão Novo corte.</div>
        ) : (
          <div className="list">
            {recent.map((job, index) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
              >
                <Link href={`/tarefa/?id=${job.id}`} className="list__row">
                  <span className={`status status--${job.status}`}>
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                  <span className="list__title">{job.title}</span>
                  <span className="muted small">
                    {dayLabel(job.createdAt.slice(0, 10))} · {clock(job.createdAt)}
                  </span>
                  <ArrowUpRight size={18} className="list__arrow" />
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({ job }: { job: JobView }) {
  const current = job.steps.find((step) => step.status === 'running' || step.status === 'waiting');
  return (
    <Link href={`/tarefa/?id=${job.id}`} className="choice">
      <span className="spread">
        <span className={`status status--${job.status}`}>
          <span className="status__dot" />
          {STATUS_LABEL[job.status] ?? job.status}
        </span>
        <ArrowUpRight size={18} />
      </span>
      <span className="choice__title">{job.title}</span>
      <span className="choice__text">{current?.label ?? 'na fila'}</span>
      <Progress value={fraction(job.steps)} active={job.status === 'running'} />
    </Link>
  );
}

function fraction(steps: StepState[]): number {
  const counted = steps.filter((step) => step.status !== 'skipped');
  if (counted.length === 0) return 0;
  return (
    counted.reduce(
      (sum, step) =>
        sum + (step.status === 'done' ? 1 : step.status === 'running' ? (step.fraction ?? 0) : 0),
      0,
    ) / counted.length
  );
}
