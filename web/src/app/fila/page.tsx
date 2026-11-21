'use client';

import { PageLoading } from '@/components/page-loading';

import { Download, FolderOpen, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AppLink as Link } from '@/components/navigation';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  PublishDialog,
  SelectionBar,
  useClipSelection,
  type ClipSelection,
} from '@/components/clip-picker';
import { ClipTile } from '@/components/clip-tile';
import { Avatar } from '@/components/profiles';
import { useToast } from '@/components/toast';
import { Button, EASE, Progress } from '@/components/ui';
import { Wizard } from '@/components/wizard';
import { api, post } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { PRESET_LABEL, STATUS_LABEL } from '@/lib/format';
import type { AccountView, BatchView, ClipView, JobView, StepState } from '@/lib/types';

interface Detail {
  batch: BatchView;
  jobs: JobView[];
  clips: ClipView[];
}

const ACTIVE = ['queued', 'running', 'waiting'];

export default function QueuePage() {
  return (
    <Suspense fallback={<PageLoading label="Carregando a fila…" />}>
      <QueueScreen />
    </Suspense>
  );
}

function QueueScreen() {
  const id = useSearchParams().get('id');
  return id === null ? <Wizard queue /> : <BatchScreen id={id} />;
}

function BatchScreen({ id }: { id: string }) {
  const toast = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const selection = useClipSelection();
  const [publishing, setPublishing] = useState<string[] | null>(null);

  const load = useCallback(() => {
    api<Detail>(`/batches/${id}`)
      .then(setDetail)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'fila não encontrada');
      });
  }, [id]);

  useEffect(load, [load]);
  useEffect(() => {
    void api<AccountView[]>('/accounts')
      .then(setAccounts)
      .catch(() => undefined);
  }, []);

  useJobEvents((event) => {
    setDetail((current) => {
      if (current === null) return current;
      const known = current.jobs.some((job) => job.id === event.jobId);
      if (event.type === 'job') {
        if (event.job.batchId !== id) return current;
        return {
          ...current,
          jobs: known
            ? current.jobs.map((job) =>
                job.id === event.jobId
                  ? { ...event.job, steps: job.steps.length > 0 ? job.steps : event.job.steps }
                  : job,
              )
            : [...current.jobs, event.job],
        };
      }
      if (!known) return current;
      if (event.type === 'steps') {
        return {
          ...current,
          jobs: current.jobs.map((job) =>
            job.id === event.jobId ? { ...job, steps: event.steps } : job,
          ),
        };
      }
      if (event.type === 'clip') {
        if (current.clips.some((clip) => clip.id === event.clip.id)) return current;
        return { ...current, clips: [...current.clips, event.clip] };
      }
      if (event.type === 'removed') {
        return { ...current, jobs: current.jobs.filter((job) => job.id !== event.jobId) };
      }
      return current;
    });
  }, load);

  const groups = useMemo(() => {
    const list: { ref: string | null; jobs: JobView[] }[] = [];
    for (const job of detail?.jobs ?? []) {
      const ref = accountOf(job);
      const group = list.find((item) => item.ref === ref);
      if (group === undefined) list.push({ ref, jobs: [job] });
      else group.jobs.push(job);
    }
    return list;
  }, [detail]);

  if (error !== null) return <div className="empty">{error}</div>;
  if (detail === null) {
    return <PageLoading label="Carregando a fila…" />;
  }

  const jobs = detail.jobs;
  const finished = jobs.filter((job) => !ACTIVE.includes(job.status)).length;
  const running = jobs.some((job) => ACTIVE.includes(job.status));
  const overall =
    jobs.length === 0
      ? 0
      : jobs.reduce(
          (sum, job) => sum + (ACTIVE.includes(job.status) ? fraction(job.steps) : 1),
          0,
        ) / jobs.length;

  async function stop(): Promise<void> {
    if (!window.confirm('Parar todos os vídeos que ainda não terminaram? Os cortes prontos ficam.'))
      return;
    setStopping(true);
    try {
      const result = await post<{ canceled: number }>(`/batches/${id}/cancel`);
      toast(
        `${String(result.canceled)} ${result.canceled === 1 ? 'vídeo parado' : 'vídeos parados'}.`,
      );
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui parar');
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="batch">
      <header className="batch__head">
        <motion.div
          className="stack"
          style={{ gap: 10 }}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <h1 className="title-lg">{detail.batch.title}</h1>
          <p className="lead">
            {PRESET_LABEL[detail.batch.preset] ?? detail.batch.preset} · {finished} de {jobs.length}{' '}
            {jobs.length === 1 ? 'vídeo pronto' : 'vídeos prontos'} ·{' '}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={detail.clips.length}
                className="batch__count"
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {detail.clips.length}
              </motion.span>
            </AnimatePresence>{' '}
            {detail.clips.length === 1 ? 'corte' : 'cortes'}
          </p>
          <Progress value={overall} active={running} />
        </motion.div>
        <div className="row wrap">
          {running && (
            <Button
              variant="light"
              lead={<Square />}
              disabled={stopping}
              onClick={() => {
                void stop();
              }}
            >
              Parar a fila
            </Button>
          )}
          <Button href="/clipes/" variant="ghost" lead={<FolderOpen />}>
            Meus clipes
          </Button>
        </div>
      </header>

      <div className="batch__accounts">
        {groups.map((group, groupIndex) => {
          const account = accounts.find((item) => item.id === group.ref) ?? null;
          const clips = detail.clips.filter((clip) =>
            group.jobs.some((job) => job.id === clip.jobId),
          );
          return (
            <motion.section
              key={group.ref ?? 'sem-conta'}
              className="batch__account"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + groupIndex * 0.08, duration: 0.55, ease: EASE }}
            >
              <header className="batch__who">
                {account !== null ? (
                  <Avatar account={account} size={42} />
                ) : (
                  <span className="queue__blank">{(group.ref ?? 'S').charAt(0).toUpperCase()}</span>
                )}
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{account?.name ?? group.ref ?? 'Sem conta'}</strong>
                  <span className="muted small">
                    {group.jobs.length} {group.jobs.length === 1 ? 'vídeo' : 'vídeos'} ·{' '}
                    {clips.length} {clips.length === 1 ? 'corte' : 'cortes'}
                  </span>
                </span>
              </header>
              <div className="batch__jobs">
                {group.jobs.map((job, index) => (
                  <BatchJob
                    key={job.id}
                    job={job}
                    index={index}
                    clips={detail.clips.filter((clip) => clip.jobId === job.id)}
                    selection={selection}
                  />
                ))}
              </div>
            </motion.section>
          );
        })}
      </div>
      <SelectionBar
        all={detail.clips.map((clip) => clip.id)}
        selection={selection}
        onPublish={setPublishing}
      />
      <PublishDialog
        clipIds={publishing}
        onClose={() => {
          setPublishing(null);
        }}
        onDone={selection.clear}
      />
    </div>
  );
}

function BatchJob({
  job,
  index,
  clips,
  selection,
}: {
  job: JobView;
  index: number;
  clips: ClipView[];
  selection: ClipSelection;
}) {
  const active = ACTIVE.includes(job.status);
  const current = job.steps.find((step) => step.status === 'running' || step.status === 'waiting');
  const counted = job.steps.filter((step) => step.status !== 'skipped');
  return (
    <motion.div
      className={`batch__job batch__job--${job.status}`}
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.45, ease: EASE }}
    >
      <Link href={`/tarefa/?id=${job.id}`} className="batch__line">
        <span className="queue__index">{index + 1}</span>
        <span className="batch__name">
          {job.title.split(' · ').slice(1).join(' · ') || job.title}
        </span>
        <span className="batch__steps" aria-hidden="true">
          {counted.map((step) => (
            <span key={step.id} className={`batch__step batch__step--${step.status}`}>
              {step.status === 'running' && (
                <motion.span
                  className="batch__step-fill"
                  initial={false}
                  animate={{ scaleX: step.fraction ?? 0.15 }}
                  transition={{ duration: 0.5, ease: EASE }}
                />
              )}
            </span>
          ))}
        </span>
        <span className={`activity__status activity__status--${job.status}`}>
          <span className={`dot ${active ? 'dot--live' : ''}`} />
          {job.status === 'waiting' && job.waiting !== null
            ? 'Esperando você'
            : active
              ? (current?.label ?? STATUS_LABEL[job.status] ?? job.status)
              : (STATUS_LABEL[job.status] ?? job.status)}
        </span>
      </Link>
      {job.status === 'failed' && job.error !== null && (
        <p className="batch__error small">{job.error}</p>
      )}
      <AnimatePresence initial={false}>
        {clips.length > 0 && (
          <motion.div
            className="batch__clips"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {clips.map((clip, position) => (
              <div key={clip.id} className="batch__clip">
                <ClipTile
                  clip={clip}
                  index={position}
                  selected={selection.has(clip.id)}
                  onSelect={(item) => {
                    selection.toggle(item.id);
                  }}
                />
                <a
                  className="batch__download"
                  href={`/api/clips/${clip.id}/download`}
                  download
                  aria-label={`baixar ${clip.title}`}
                >
                  <Download size={14} />
                </a>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function accountOf(job: JobView): string | null {
  const request = job.request as { accounts?: string[] } | null;
  return request?.accounts?.[0] ?? null;
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
