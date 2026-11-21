'use client';

import { Download, Send, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { bytes, duration } from '@/lib/format';
import type { ClipView } from '@/lib/types';
import { ClipLightbox } from './clip-lightbox';
import { SelectBox } from './clip-picker';

export function ClipCard({
  clip,
  onDelete,
  selected,
  onSelect,
  onPublish,
}: {
  clip: ClipView;
  onDelete?: (clip: ClipView) => void;
  selected?: boolean;
  onSelect?: (clip: ClipView) => void;
  onPublish?: (clip: ClipView) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.article
        className={`clip ${selected === true ? 'clip--selected' : ''}`}
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
        {onSelect !== undefined && (
          <SelectBox
            checked={selected === true}
            onToggle={() => {
              onSelect(clip);
            }}
          />
        )}
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
              {onPublish !== undefined && (
                <button
                  type="button"
                  className="clip__action"
                  onClick={() => {
                    onPublish(clip);
                  }}
                  aria-label="publicar"
                  title="Postar agora ou agendar"
                >
                  <Send size={16} />
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
      <ClipLightbox
        clip={clip}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
