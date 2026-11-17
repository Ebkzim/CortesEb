'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

export function Splash({ done }: { done: boolean }) {
  const [minimum, setMinimum] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinimum(true);
    }, 650);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const visible = !(done && minimum);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5, ease: [0.76, 0, 0.24, 1] } }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--ink)',
            color: '#fff',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="brand"
            style={{ fontSize: 46 }}
          >
            cortes
            <motion.span
              className="brand__dot"
              style={{ background: '#fff', width: 11, height: 11 }}
              animate={{ scale: [1, 1.5, 1] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
