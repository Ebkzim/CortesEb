'use client';

import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export function Choice({
  active,
  disabled,
  icon,
  title,
  text,
  onClick,
  onHover,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  title: string;
  text?: string;
  onClick: () => void;
  onHover?: (inside: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`choice ${active ? 'choice--active' : ''} ${disabled === true ? 'choice--disabled' : ''}`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      aria-pressed={active}
      disabled={disabled}
    >
      {active && (
        <motion.span
          className="choice__check"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        >
          <Check size={14} strokeWidth={3} />
        </motion.span>
      )}
      {icon !== undefined && <span className="choice__icon">{icon}</span>}
      <span className="choice__title">{title}</span>
      {text !== undefined && <span className="choice__text">{text}</span>}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  id: string;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`segmented__item ${option.value === value ? 'segmented__item--active' : ''}`}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.value === value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="segmented__pill"
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            />
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, active }: { value: number | null; active?: boolean }) {
  const indeterminate = value === null;
  return (
    <div className={`bar ${indeterminate ? 'bar--indeterminate' : ''}`}>
      <div className="bar__fill" style={{ width: `${String(Math.round((value ?? 0) * 100))}%` }}>
        {active === true && <span className="bar__shine" />}
      </div>
    </div>
  );
}

export const fade = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
};
