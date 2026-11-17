'use client';

import { Download, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { bytes, duration } from '@/lib/format';
import type { ClipView } from '@/lib/types';
import { Button } from './ui';

export function ClipCard({
  clip,
  onDelete,
}: {
  clip: ClipView;
  onDelete?: (clip: ClipView) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.article
        className="clip"
        layout
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        onMouseEnter={() => {
          setHover(true);
          void video.current?.play().catch(() => undefined);
        }}
        onMouseLeave={() => {
          setHover(false);
          video.current?.pause();
        }}
      >
        <button
          type="button"
          className="clip__media"
          onClick={() => {
            setOpen(true);
          }}
          aria-label={`assistir ${clip.title}`}
        >
          {clip.hasThumb && (
            <img
              src={`/api/clips/${clip.id}/thumb`}
              alt=""
              loading="lazy"
              className="clip__thumb"
            />
          )}
          <video
            ref={video}
            className={`clip__video ${hover ? 'is-on' : ''}`}
            src={`/api/clips/${clip.id}/video`}
            muted
            loop
            playsInline
            preload="none"
          />
          <span className="clip__time">{duration(clip.seconds)}</span>
        </button>
        <div className="clip__body">
          <p className="clip__title" title={clip.title}>
            {clip.title}
          </p>
          <div className="spread">
            <span className="muted small">
              {clip.score !== null ? `nota ${String(clip.score)} · ` : ''}
              {bytes(clip.sizeBytes)}
              {clip.account !== null ? ` · ${clip.account}` : ''}
            </span>
            <span className="row" style={{ gap: 6 }}>
              {onDelete !== undefined && (
                <button
                  type="button"
                  className="clip__action"
                  onClick={() => {
                    onDelete(clip);
                  }}
                  aria-label="apagar"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <a
                className="clip__action clip__action--dark"
                href={`/api/clips/${clip.id}/download`}
                download
                aria-label="baixar"
              >
                <Download size={16} />
              </a>
            </span>
          </div>
        </div>
      </motion.article>
      <AnimatePresence>
        {open && (
          <motion.div
            className="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setOpen(false);
            }}
          >
            <motion.div
              className="lightbox__inner"
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <video
                src={`/api/clips/${clip.id}/video`}
                controls
                autoPlay
                playsInline
                className="lightbox__video"
              />
              <div className="spread">
                <p className="clip__title">{clip.title}</p>
                <span className="row">
                  <Button
                    href={`/api/clips/${clip.id}/download`}
                    download
                    size="small"
                    icon={<Download />}
                  >
                    Baixar
                  </Button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      setOpen(false);
                    }}
                    aria-label="fechar"
                  >
                    <X size={18} />
                  </button>
                </span>
              </div>
              {clip.hook !== null && <p className="muted small">“{clip.hook}”</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
