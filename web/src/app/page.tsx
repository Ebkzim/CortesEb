'use client';

import { ArrowRight, ArrowUpRight, Film } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipTile } from '@/components/clip-tile';
import { Button, EASE, Progress } from '@/components/ui';
import { api } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { PRESET_LABEL, STATUS_LABEL, ago } from '@/lib/format';
import type { ClipView, DaySummary, JobView, StepState } from '@/lib/types';

const ACTIVE = ['queued', 'running', 'waiting'];

type Covers = Record<string, { clipId: string; count: number }>;

export default function HomePage() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [covers, setCovers] = useState<Covers>({});
  const [clips, setClips] = useState<ClipView[] | null>(null);
  const [days, setDays] = useState<DaySummary[]>([]);

  const loadClips = (): void => {
    void api<ClipView[]>('/clips/recent?limit=6')
      .then(setClips)
      .catch(() => {
        setClips([]);
      });
    void api<DaySummary[]>('/library/days')
      .then(setDays)
      .catch(() => undefined);
  };

  useEffect(() => {
    void api<{ jobs: JobView[]; covers: Covers }>('/jobs?limit=8').then((data) => {
      setJobs(data.jobs);
      setCovers(data.covers);
    });
    loadClips();
  }, []);

  useJobEvents((event) => {
    if (event.type === 'clip') {
      loadClips();
      setCovers((current) => {
        const known = current[event.jobId];
        return {
          ...current,
          [event.jobId]:
            known === undefined
              ? { clipId: event.clip.id, count: 1 }
              : { ...known, count: known.count + 1 },
        };
      });
      return;
    }
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

  const today = localToday();
  const todayCount = days.find((item) => item.day === today)?.clips ?? 0;
  const total = days.reduce((sum, item) => sum + item.clips, 0);

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
        {total > 0 && (
          <motion.div
            className="home__stats"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <Stat value={todayCount} label={todayCount === 1 ? 'corte hoje' : 'cortes hoje'} />
            <Stat value={total} label="no total" />
            <Stat
              value={days.length}
              label={days.length === 1 ? 'dia de cortes' : 'dias de cortes'}
            />
          </motion.div>
        )}
      </section>

      <section className="home__side">
        <div className="stack" style={{ gap: 14 }}>
          <div className="spread">
            <h2 className="title-md">Últimos cortes</h2>
            {(clips?.length ?? 0) > 0 && (
              <Link href="/clipes/" className="link-arrow">
                ver todos <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
          {clips === null ? (
            <div className="tiles">
              {[0, 1, 2].map((index) => (
                <span key={index} className="tile tile--ghost" />
              ))}
            </div>
          ) : clips.length === 0 ? (
            <div className="empty">Os cortes que você fizer aparecem aqui.</div>
          ) : (
            <div className="tiles">
              {clips.map((clip, index) => (
                <ClipTile key={clip.id} clip={clip} index={index} />
              ))}
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <h2 className="title-md">Atividade</h2>
          {jobs === null ? (
            <div className="row muted">
              <span className="spinner" /> carregando
            </div>
          ) : jobs.length === 0 ? (
            <div className="empty">Nenhuma tarefa ainda.</div>
          ) : (
            <div className="activity">
              {jobs.map((job, index) => (
                <ActivityCard key={job.id} job={job} cover={covers[job.id]} index={index} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function ActivityCard({
  job,
  cover,
  index,
}: {
  job: JobView;
  cover: { clipId: string; count: number } | undefined;
  index: number;
}) {
  const running = ACTIVE.includes(job.status);
  const current = job.steps.find((step) => step.status === 'running' || step.status === 'waiting');
  return (
    <motion.div
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15 + index * 0.05, duration: 0.5, ease: EASE }}
      whileHover={{ x: 4 }}
      whileTap={{ scale: 0.985 }}
    >
      <Link
        href={`/tarefa/?id=${job.id}`}
        className={`activity__item ${running ? 'activity__item--live' : ''}`}
      >
        <span className="activity__cover">
          {cover !== undefined ? (
            <img src={`/api/clips/${cover.clipId}/thumb`} alt="" loading="lazy" />
          ) : (
            <Film size={16} />
          )}
        </span>
        <span className="activity__body">
          <span className="activity__title">{job.title}</span>
          <span className="activity__meta">
            {PRESET_LABEL[job.preset] ?? job.preset}
            {cover !== undefined
              ? ` · ${String(cover.count)} ${cover.count === 1 ? 'corte' : 'cortes'}`
              : ''}
            {` · ${ago(job.createdAt)}`}
          </span>
          {running && <Progress value={fraction(job.steps)} active={job.status === 'running'} />}
        </span>
        <span className={`activity__status activity__status--${job.status}`}>
          <span className={`dot ${running ? 'dot--live' : ''}`} />
          {running ? (current?.label ?? 'Na fila') : (STATUS_LABEL[job.status] ?? job.status)}
        </span>
      </Link>
    </motion.div>
  );
}

function localToday(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
