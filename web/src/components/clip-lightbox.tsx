'use client';

import { Download, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ClipView } from '@/lib/types';
import { Button } from './ui';

export function ClipLightbox({
  clip,
  open,
  onClose,
}: {
  clip: ClipView;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            onClose();
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
                    onClose();
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
  );
}
