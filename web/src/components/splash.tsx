'use client';

import { AnimatePresence, motion } from 'motion/react';

export function Splash({ done }: { done: boolean }) {
  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          key="splash"
          className="app-splash"
          role="status"
          aria-live="polite"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <div className="app-splash__content">
            <span className="brand" style={{ fontSize: 42 }}>
              cortes
              <span className="brand__dot" style={{ background: '#fff', width: 10, height: 10 }} />
            </span>
            <span className="app-splash__label">
              <span className="spinner" aria-hidden="true" />
              Abrindo painel…
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
