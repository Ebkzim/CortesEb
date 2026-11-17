'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Preset } from '@/lib/types';
import { EASE } from './ui';

const WORDS = ['ISSO', 'MUDA', 'TUDO'];

export function PresetPreview({ preset }: { preset: Preset | null }) {
  return (
    <div className="preview">
      <AnimatePresence mode="wait">
        <motion.div
          key={`${preset?.id ?? 'vazio'}-${preset?.example ?? 'esquema'}`}
          className="preview__frame"
          initial={{ opacity: 0, scale: 0.96, filter: 'blur(6px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          {preset === null ? (
            <div className="preview__empty">Escolha um tipo para ver como fica</div>
          ) : preset.example !== null ? (
            <Example clipId={preset.example} />
          ) : (
            <Schema top={preset.top} below={preset.below} />
          )}
        </motion.div>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.p
          key={preset?.id ?? 'nada'}
          className="preview__caption"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {preset === null
            ? ''
            : preset.example !== null
              ? 'Um corte real seu neste formato'
              : `${preset.top} em cima, ${preset.below} embaixo`}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function Example({ clipId }: { clipId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    const start = (): void => {
      element.currentTime = Math.min(4, element.duration / 3);
      void element.play().catch(() => undefined);
    };
    element.addEventListener('loadedmetadata', start, { once: true });
    return () => {
      element.removeEventListener('loadedmetadata', start);
    };
  }, [clipId]);
  return (
    <video
      ref={video}
      className="preview__video"
      src={`/api/clips/${clipId}/video`}
      muted
      loop
      playsInline
      preload="metadata"
    />
  );
}

function Schema({ top, below }: { top: string; below: string }) {
  const [word, setWord] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setWord((current) => (current + 1) % WORDS.length);
    }, 600);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="schema">
      <div className="schema__half">
        <span className="schema__shape schema__shape--face" />
        <span className="schema__name">{top}</span>
      </div>
      <div className="schema__caption">
        {WORDS.map((text, index) => (
          <span key={text} className={index === word ? 'is-on' : ''}>
            {text}
          </span>
        ))}
      </div>
      <div className="schema__half schema__half--below">
        <span className="schema__shape schema__shape--scene" />
        <span className="schema__name">{below}</span>
      </div>
    </div>
  );
}
