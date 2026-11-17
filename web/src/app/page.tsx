'use client';

import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, EASE, Progress } from '@/components/ui';
import { api } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { STATUS_LABEL, clock, dayLabel } from '@/lib/format';
import type { JobView, StepState } from '@/lib/types';

const ACTIVE = ['queued', 'running', 'waiting'];

export default function HomePage() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);

  useEffect(() => {
    void api<{ jobs: JobView[] }>('/jobs?limit=14').then((data) => {
      setJobs(data.jobs);
    });
  }, []);

  useJobEvents((event) => {
    setJobs((current) => {
      if (current === null) return current;
      if (event.type === 'job') {
        const exists = current.some((job) => job.id === event.jobId);
        return exists
          ? current.map((job) =>
              job.id === event.jobId
                ? { ...event.job, steps: job.steps.length > 0 ? job.steps : event.job.steps }
                : job,
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

  const active = (jobs ?? []).filter((job) => ACTIVE.includes(job.status));
  const recent = (jobs ?? []).filter((job) => !ACTIVE.includes(job.status));

  return (
    <div className="home">
      <section className="home__hero">
        <motion.h1
          className="title-xl"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          Vídeo longo entra.
          <br />
          <span className="muted">Corte pronto sai.</span>
        </motion.h1>
        <motion.p
          className="lead"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.6 }}
        >
          Escolha o tipo, a quantidade e a origem. O painel baixa, transcreve, escolhe os melhores
          ganchos e entrega tudo organizado por dia.
        </motion.p>
        <motion.div
          className="row wrap"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6, ease: EASE }}
        >
          <Button href="/novo/" icon={<ArrowRight />}>
            Novo corte
          </Button>
          <Button href="/clipes/" variant="light">
            Meus clipes
          </Button>
        </motion.div>
      </section>

      <section className="home__side">
        {active.length > 0 && (
          <div className="stack">
            <h2 className="title-md">Em andamento</h2>
            {active.map((job) => (
              <LiveCard key={job.id} job={job} />
            ))}
          </div>
        )}
        <div className="stack">
          <h2 className="title-md">Recentes</h2>
          {jobs === null ? (
            <div className="row muted">
              <span className="spinner" /> carregando
            </div>
          ) : recent.length === 0 ? (
            <div className="empty">Nenhum corte ainda.</div>
          ) : (
            <div className="list">
              {recent.map((job, index) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + index * 0.04, duration: 0.5, ease: EASE }}
                >
                  <Link href={`/tarefa/?id=${job.id}`} className="list__row">
                    <span className="list__main">
                      <span className="list__title">{job.title}</span>
                      <span className={`status status--${job.status}`}>
                        {STATUS_LABEL[job.status] ?? job.status}
                      </span>
                    </span>
                    <span className="muted small">
                      {dayLabel(job.createdAt.slice(0, 10))} · {clock(job.createdAt)}
                    </span>
                    <ArrowUpRight size={17} className="list__arrow" />
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function LiveCard({ job }: { job: JobView }) {
  const current = job.steps.find((step) => step.status === 'running' || step.status === 'waiting');
  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <Link href={`/tarefa/?id=${job.id}`} className="live-card">
        <span className="spread">
          <span className="list__title">{job.title}</span>
          <ArrowUpRight size={17} />
        </span>
        <span className="status status--running">
          <span className="dot dot--live" />
          {current?.label ?? 'Na fila'}
        </span>
        <Progress value={fraction(job.steps)} active={job.status === 'running'} />
      </Link>
    </motion.div>
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
