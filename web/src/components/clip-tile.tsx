'use client';

import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { duration } from '@/lib/format';
import type { ClipView } from '@/lib/types';
import { ClipLightbox } from './clip-lightbox';
import { SelectBox } from './clip-picker';
import { EASE } from './ui';

export function ClipTile({
  clip,
  index,
  selected,
  onSelect,
}: {
  clip: ClipView;
  index: number;
  selected?: boolean;
  onSelect?: (clip: ClipView) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button
        type="button"
        className={`tile ${selected === true ? 'tile--selected' : ''}`}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.1 + index * 0.05, duration: 0.55, ease: EASE }}
        whileHover={{ y: -4 }}
        whileTap={{ scale: 0.97 }}
        onMouseEnter={() => {
          setHover(true);
          void video.current?.play().catch(() => undefined);
        }}
        onMouseLeave={() => {
          setHover(false);
          video.current?.pause();
        }}
        onClick={() => {
          setOpen(true);
        }}
        aria-label={`assistir ${clip.title}`}
      >
        {clip.hasThumb && (
          <img className="tile__media" src={`/api/clips/${clip.id}/thumb`} alt="" loading="lazy" />
        )}
        <video
          ref={video}
          className={`tile__media tile__video ${hover ? 'is-on' : ''}`}
          src={`/api/clips/${clip.id}/video`}
          muted
          loop
          playsInline
          preload="none"
        />
        <span className="tile__shade" />
        <span className="tile__info">
          <span className="tile__title">{clip.title}</span>
          <span className="tile__meta">{duration(clip.seconds)}</span>
        </span>
      </motion.button>
      {onSelect !== undefined && (
        <SelectBox
          checked={selected === true}
          onToggle={() => {
            onSelect(clip);
          }}
        />
      )}
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
