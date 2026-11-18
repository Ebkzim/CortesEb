'use client';

import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { timecode } from '@/lib/format';
import { Button } from './ui';
import type { CameraTimeline, PercentRect } from '@/lib/types';

const STEP_SECONDS = 5;
const SEEK_DELAY_MS = 220;

const TOP_RATIO = 1080 / 960;
const CORNERS: { label: string; rect: (w: number, h: number) => PercentRect }[] = [
  { label: 'Canto superior esquerdo', rect: (w, h) => ({ x: 0, y: 0, w, h }) },
  { label: 'Canto superior direito', rect: (w, h) => ({ x: 100 - w, y: 0, w, h }) },
  { label: 'Canto inferior esquerdo', rect: (w, h) => ({ x: 0, y: 100 - h, w, h }) },
  { label: 'Canto inferior direito', rect: (w, h) => ({ x: 100 - w, y: 100 - h, w, h }) },
];

export function CameraPicker({
  jobId,
  frame: firstFrame,
  timeline,
  suggestion,
  onConfirm,
}: {
  jobId: string;
  frame: string;
  timeline: CameraTimeline | null;
  suggestion: PercentRect;
  onConfirm: (rect: PercentRect) => void;
}) {
  const [shown, setShown] = useState(firstFrame);
  const [at, setAt] = useState(timeline?.at ?? 0);
  const [seeking, setSeeking] = useState(false);
  const seekTimer = useRef<number | null>(null);
  const seekTicket = useRef(0);
  const src = `/api/jobs/${jobId}/frame/${shown}`;

  function seek(moment: number, delay = 0): void {
    if (timeline === null) return;
    const bounded = Math.min(timeline.duration, Math.max(0, moment));
    setAt(bounded);
    if (seekTimer.current !== null) window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => {
      const ticket = ++seekTicket.current;
      setSeeking(true);
      void post<{ frame: string; at: number }>(`/jobs/${jobId}/frame-at`, { at: bounded })
        .then((result) => {
          if (ticket === seekTicket.current) setShown(result.frame);
        })
        .catch(() => undefined)
        .finally(() => {
          if (ticket === seekTicket.current) setSeeking(false);
        });
    }, delay);
  }

  function pick(name: string, moment: number): void {
    seekTicket.current += 1;
    if (seekTimer.current !== null) window.clearTimeout(seekTimer.current);
    setSeeking(false);
    setAt(moment);
    setShown(name);
  }

  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<PercentRect>(suggestion);
  const drag = useRef<{
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    start: PercentRect;
  } | null>(null);

  const heightFor = useCallback(
    (width: number): number => (frame === null ? width : (width * frame.w) / (frame.h * TOP_RATIO)),
    [frame],
  );

  useEffect(() => {
    if (frame === null) return;
    setRect((current) => fit({ ...current, h: heightFor(current.w) }));
  }, [frame, heightFor]);

  function onPointerDown(mode: 'move' | 'resize', event: React.PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { mode, startX: event.clientX, startY: event.clientY, start: rect };
  }

  function onPointerMove(event: React.PointerEvent): void {
    const state = drag.current;
    const area = box.current?.getBoundingClientRect();
    if (state === null || area === undefined) return;
    const dx = ((event.clientX - state.startX) / area.width) * 100;
    const dy = ((event.clientY - state.startY) / area.height) * 100;
    if (state.mode === 'move') {
      setRect(fit({ ...state.start, x: state.start.x + dx, y: state.start.y + dy }));
      return;
    }
    const width = Math.max(6, Math.min(100, state.start.w + dx));
    setRect(fit({ ...state.start, w: width, h: heightFor(width) }));
  }

  function onPointerUp(): void {
    drag.current = null;
  }

  const zoom = 100 / rect.w;
  return (
    <div className="camera">
      <div className="camera__stage">
        <div
          ref={box}
          className={seeking ? 'camera__frame camera__frame--seeking' : 'camera__frame'}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <img
            src={src}
            alt="quadro do vídeo"
            draggable={false}
            onLoad={(event) => {
              setFrame({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              });
            }}
          />
          <div
            className="camera__rect"
            style={{
              left: `${String(rect.x)}%`,
              top: `${String(rect.y)}%`,
              width: `${String(rect.w)}%`,
              height: `${String(rect.h)}%`,
            }}
            onPointerDown={(event) => {
              onPointerDown('move', event);
            }}
          >
            <span className="camera__label">rosto</span>
            <span
              className="camera__handle"
              onPointerDown={(event) => {
                onPointerDown('resize', event);
              }}
            />
          </div>
        </div>
        <div className="camera__result">
          <span className="label">Como fica no topo</span>
          <div
            className="camera__crop"
            style={{
              backgroundImage: `url(${src})`,
              backgroundSize: `${String(zoom * 100)}% auto`,
              backgroundPosition: `${String(rect.w >= 100 ? 0 : (rect.x / (100 - rect.w)) * 100)}% ${String(rect.h >= 100 ? 0 : (rect.y / (100 - rect.h)) * 100)}%`,
            }}
          />
        </div>
      </div>
      {timeline !== null && (
        <div className="camera__time">
          <div className="camera__strip">
            {timeline.strip.map((item) => (
              <motion.button
                key={item.name}
                type="button"
                className={
                  shown === item.name || Math.abs(item.at - at) < 0.5
                    ? 'camera__thumb camera__thumb--on'
                    : 'camera__thumb'
                }
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  pick(item.name, item.at);
                }}
                title={`Usar o quadro de ${timecode(item.at)}`}
              >
                <img src={`/api/jobs/${jobId}/frame/${item.name}`} alt="" draggable={false} />
                <span>{timecode(item.at)}</span>
              </motion.button>
            ))}
          </div>
          <div className="camera__seek">
            <button
              type="button"
              className="icon-button"
              aria-label="Voltar 5 segundos"
              onClick={() => {
                seek(at - STEP_SECONDS);
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="range"
              className="camera__range"
              min={0}
              max={Math.max(1, Math.floor(timeline.duration))}
              step={1}
              value={Math.round(at)}
              aria-label="Momento do vídeo"
              onChange={(event) => {
                seek(Number(event.target.value), SEEK_DELAY_MS);
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Avançar 5 segundos"
              onClick={() => {
                seek(at + STEP_SECONDS);
              }}
            >
              <ChevronRight size={16} />
            </button>
            <span className="camera__clock">
              {timecode(at)} / {timecode(timeline.duration)}
            </span>
          </div>
        </div>
      )}
      <div className="row wrap">
        {CORNERS.map((corner) => (
          <button
            key={corner.label}
            type="button"
            className="chip"
            onClick={() => {
              const width = Math.min(rect.w, 40);
              setRect(fit(corner.rect(width, heightFor(width))));
            }}
          >
            {corner.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {timeline === null
          ? 'Arraste o retângulo até o rosto e puxe o canto para ajustar o tamanho.'
          : 'Se o rosto não aparece, escolha outro quadro acima ou arraste a linha do tempo. Depois arraste o retângulo até o rosto e puxe o canto para ajustar o tamanho.'}
      </p>
      <div>
        <Button
          icon={<Check />}
          onClick={() => {
            onConfirm(round(rect));
          }}
        >
          Confirmar enquadramento
        </Button>
      </div>
    </div>
  );
}

function fit(rect: PercentRect): PercentRect {
  const w = Math.min(100, Math.max(6, rect.w));
  const h = Math.min(100, Math.max(4, rect.h));
  return {
    w,
    h,
    x: Math.min(100 - w, Math.max(0, rect.x)),
    y: Math.min(100 - h, Math.max(0, rect.y)),
  };
}

function round(rect: PercentRect): PercentRect {
  const value = (number: number): number => Math.round(number * 100) / 100;
  return { x: value(rect.x), y: value(rect.y), w: value(rect.w), h: value(rect.h) };
}
