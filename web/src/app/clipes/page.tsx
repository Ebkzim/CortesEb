'use client';

import { PageLoading } from '@/components/page-loading';

import { ArrowLeft, Folder } from 'lucide-react';
import { motion } from 'motion/react';
import { AppLink as Link } from '@/components/navigation';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ClipCard } from '@/components/clip-card';
import { PublishDialog, SelectionBar, useClipSelection } from '@/components/clip-picker';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui';
import { api, remove } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { bytes, dayLabel } from '@/lib/format';
import type { ClipView, DaySummary } from '@/lib/types';

export default function LibraryPage() {
  return (
    <Suspense fallback={<PageLoading label="Carregando seus clipes…" />}>
      <Library />
    </Suspense>
  );
}

function Library() {
  const day = useSearchParams().get('dia');
  return day === null ? <Days /> : <Day day={day} />;
}

function Days() {
  const [days, setDays] = useState<DaySummary[] | null>(null);
  useEffect(() => {
    void api<DaySummary[]>('/library/days').then(setDays);
  }, []);
  useJobEvents(
    (event) => {
      if (event.type !== 'clip') return;
      void api<DaySummary[]>('/library/days')
        .then(setDays)
        .catch(() => undefined);
    },
    () => {
      void api<DaySummary[]>('/library/days')
        .then(setDays)
        .catch(() => undefined);
    },
  );
  return (
    <div className="stack" style={{ gap: 32 }}>
      <header className="stack" style={{ gap: 8 }}>
        <h1 className="title-lg">Meus clipes</h1>
        <p className="lead">Uma pasta por dia, com todos os cortes prontos para baixar.</p>
      </header>
      {days === null ? (
        <PageLoading label="Carregando seus clipes…" />
      ) : days.length === 0 ? (
        <div className="empty">Ainda não há clipes. Os cortes prontos aparecem aqui sozinhos.</div>
      ) : (
        <div className="folders">
          {days.map((item, index) => (
            <motion.div
              key={item.day}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: Math.min(index, 3) * 0.025,
                duration: 0.18,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <Link href={`/clipes/?dia=${item.day}`} className="folder">
                <span className="folder__tab" />
                <Folder size={22} />
                <span className="folder__name">{dayLabel(item.day)}</span>
                <span className="muted small">
                  {item.day.split('-').reverse().join('/')} · {item.clips}{' '}
                  {item.clips === 1 ? 'clipe' : 'clipes'} · {bytes(item.bytes)}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function Day({ day }: { day: string }) {
  const toast = useToast();
  const [clips, setClips] = useState<ClipView[] | null>(null);
  const selection = useClipSelection();
  const [publishing, setPublishing] = useState<string[] | null>(null);
  useEffect(() => {
    void api<ClipView[]>(`/library/days/${day}`).then(setClips);
  }, [day]);
  useJobEvents(
    (event) => {
      if (event.type === 'clip' && event.clip.day === day) {
        setClips((current) =>
          current === null
            ? current
            : [event.clip, ...current.filter((clip) => clip.id !== event.clip.id)],
        );
      }
    },
    () => {
      void api<ClipView[]>(`/library/days/${day}`)
        .then(setClips)
        .catch(() => undefined);
    },
  );
  async function drop(clip: ClipView): Promise<void> {
    if (!window.confirm(`Apagar “${clip.title}”? O arquivo sai do computador.`)) return;
    try {
      await remove(`/clips/${clip.id}`);
      setClips((current) => current?.filter((item) => item.id !== clip.id) ?? null);
      toast('Clipe apagado.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui apagar');
    }
  }
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div>
        <Button href="/clipes/" variant="ghost" size="small" lead={<ArrowLeft />}>
          Todas as pastas
        </Button>
      </div>
      <header className="spread">
        <div className="stack" style={{ gap: 8 }}>
          <h1 className="title-lg" style={{ textTransform: 'capitalize' }}>
            {dayLabel(day)}
          </h1>
          <span className="muted small">{day.split('-').reverse().join('/')}</span>
        </div>
        {clips !== null && (
          <span className="chip">
            {clips.length} {clips.length === 1 ? 'clipe' : 'clipes'}
          </span>
        )}
      </header>
      {clips === null ? (
        <PageLoading label="Carregando seus clipes…" />
      ) : clips.length === 0 ? (
        <div className="empty">Nenhum clipe neste dia.</div>
      ) : (
        <div className="clips">
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              selected={selection.has(clip.id)}
              onSelect={(item) => {
                selection.toggle(item.id);
              }}
              onPublish={(item) => {
                setPublishing([item.id]);
              }}
              onDelete={(item) => {
                void drop(item);
              }}
            />
          ))}
        </div>
      )}
      <SelectionBar
        all={clips?.map((clip) => clip.id) ?? []}
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
