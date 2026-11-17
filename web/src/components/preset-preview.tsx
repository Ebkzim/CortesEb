'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { Preset } from '@/lib/types';
import { EASE } from './ui';

const SAMPLE: Record<string, string> = {
  'gameplay-camera': 'gameplay',
  'gta6-gameplay': 'gameplay',
};

function sampleOf(preset: Preset): string {
  return preset.frame === 'fit' ? 'cena' : (SAMPLE[preset.id] ?? 'react');
}

export function PresetPreview({ preset }: { preset: Preset | null }) {
  return (
    <div className="preview">
      <AnimatePresence mode="wait">
        <motion.div
          key={preset === null ? 'vazio' : (preset.example ?? sampleOf(preset))}
          className="preview__frame"
          initial={{ opacity: 0, scale: 0.96, filter: 'blur(6px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          {preset === null ? (
            <div className="preview__empty">Escolha um tipo para ver como fica</div>
          ) : (
            <Example
              src={
                preset.example !== null
                  ? `/api/clips/${preset.example}/video`
                  : `/examples/${sampleOf(preset)}.mp4`
              }
            />
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
              : preset.frame === 'fit'
                ? 'A cena inteira, título em cima e legenda embaixo'
                : `${preset.top} em cima, ${preset.below} embaixo`}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function Example({ src }: { src: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    const start = (): void => {
      void element.play().catch(() => undefined);
    };
    element.addEventListener('loadeddata', start, { once: true });
    return () => {
      element.removeEventListener('loadeddata', start);
    };
  }, [src]);
  return (
    <video
      ref={video}
      className="preview__video"
      src={src}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
    />
  );
}
