'use client';

import { motion } from 'motion/react';
import { useState, type DragEvent, type ReactNode } from 'react';
import { useToast } from './toast';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export function ImageDrop({
  className,
  title,
  onFile,
  children,
}: {
  className: string;
  title: string;
  onFile: (file: File) => void;
  children: ReactNode;
}) {
  const toast = useToast();
  const [over, setOver] = useState(false);

  function take(file: File | undefined): void {
    if (file === undefined) return;
    if (!ACCEPTED.includes(file.type)) {
      toast('Use uma imagem PNG, JPG ou WebP.');
      return;
    }
    onFile(file);
  }

  function enter(event: DragEvent): void {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  }

  return (
    <motion.label
      className={`${className} image-drop ${over ? 'image-drop--over' : ''}`}
      title={title}
      animate={{ scale: over ? 1.12 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      onDragEnter={enter}
      onDragOver={enter}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files[0]);
      }}
    >
      {children}
      <input
        type="file"
        accept={ACCEPTED.join(',')}
        hidden
        onChange={(event) => {
          take(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </motion.label>
  );
}
