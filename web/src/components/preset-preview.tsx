'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Preset } from '@/lib/types';

const WORDS = ['ISSO', 'MUDA', 'TUDO', 'NO', 'JOGO'];

function Scene({
  kind,
  label,
}: {
  kind: 'face' | 'game' | 'trailer' | 'scene' | 'person';
  label: string;
}) {
  return (
    <div className={`scene scene--${kind}`}>
      {kind === 'face' || kind === 'person' ? (
        <div className="scene__face">
          <span className="scene__head" />
          <span className="scene__body" />
        </div>
      ) : (
        <div className="scene__lines">
          <span />
          <span />
          <span />
        </div>
      )}
      <span className="scene__label">{label}</span>
    </div>
  );
}

function sceneFor(text: string, top: boolean): 'face' | 'game' | 'trailer' | 'scene' | 'person' {
  if (text.includes('câmera')) return 'face';
  if (text.includes('lado')) return 'person';
  if (text.includes('trailer')) return 'trailer';
  if (text.includes('cena')) return 'scene';
  return top ? 'game' : 'game';
}

export function PresetPreview({ preset }: { preset: Preset | null }) {
  const [word, setWord] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setWord((current) => (current + 1) % WORDS.length);
    }, 520);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="phone">
      <div className="phone__notch" />
      <AnimatePresence mode="wait">
        <motion.div
          key={preset?.id ?? 'vazio'}
          className="phone__screen"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          {preset === null ? (
            <div className="phone__empty">Passe o mouse sobre um tipo para ver como fica</div>
          ) : (
            <>
              <Scene kind={sceneFor(preset.top, true)} label={preset.top} />
              <div className="phone__caption">
                {WORDS.slice(Math.max(0, word - 1), word + 2).map((text, index) => (
                  <span
                    key={`${text}-${String(index)}`}
                    className={text === WORDS[word] ? 'is-on' : ''}
                  >
                    {text}
                  </span>
                ))}
              </div>
              <Scene kind={sceneFor(preset.below, false)} label={preset.below} />
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
