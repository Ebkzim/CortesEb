'use client';

import { ArrowLeft, Folder } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ClipCard } from '@/components/clip-card';
import { useToast } from '@/components/toast';
import { api, remove } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { bytes, dayLabel } from '@/lib/format';
import type { ClipView, DaySummary } from '@/lib/types';

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
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
  useJobEvents((event) => {
    if (event.type !== 'clip') return;
    void api<DaySummary[]>('/library/days').then(setDays);
  });
  return (
    <div className="stack" style={{ gap: 32 }}>
      <header className="stack" style={{ gap: 10 }}>
        <span className="eyebrow">Biblioteca</span>
        <h1 className="title-lg">Meus clipes</h1>
        <p className="lead">Uma pasta por dia, com todos os cortes prontos para baixar.</p>
      </header>
      {days === null ? (
        <div className="row muted">
          <span className="spinner" /> carregando
        </div>
      ) : days.length === 0 ? (
        <div className="empty">Ainda não há clipes. Os cortes prontos aparecem aqui sozinhos.</div>
      ) : (
        <div className="grid grid--4">
          {days.map((item, index) => (
            <motion.div
              key={item.day}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link href={`/clipes/?dia=${item.day}`} className="folder">
                <span className="folder__tab" />
                <Folder size={22} />
                <span className="folder__name">{dayLabel(item.day)}</span>
                <span className="muted small">
                  {item.clips} {item.clips === 1 ? 'clipe' : 'clipes'} · {bytes(item.bytes)}
                </span>
                <span className="folder__date">{item.day.split('-').reverse().join('/')}</span>
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
  useEffect(() => {
    void api<ClipView[]>(`/library/days/${day}`).then(setClips);
  }, [day]);
  useJobEvents((event) => {
    if (event.type === 'clip' && event.clip.day === day) {
      setClips((current) =>
        current === null
          ? current
          : [event.clip, ...current.filter((clip) => clip.id !== event.clip.id)],
      );
    }
  });
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
      <Link
        href="/clipes/"
        className="button button--ghost button--small"
        style={{ alignSelf: 'flex-start' }}
      >
        <ArrowLeft size={16} /> Todas as pastas
      </Link>
      <header className="spread">
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">{day.split('-').reverse().join('/')}</span>
          <h1 className="title-lg" style={{ textTransform: 'capitalize' }}>
            {dayLabel(day)}
          </h1>
        </div>
        {clips !== null && (
          <span className="chip">
            {clips.length} {clips.length === 1 ? 'clipe' : 'clipes'}
          </span>
        )}
      </header>
      {clips === null ? (
        <div className="row muted">
          <span className="spinner" /> carregando
        </div>
      ) : clips.length === 0 ? (
        <div className="empty">Nenhum clipe neste dia.</div>
      ) : (
        <div className="clips">
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              onDelete={(item) => {
                void drop(item);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
