'use client';

import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AppLink as Link } from '@/components/navigation';
import { useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';

export const EASE = [0.22, 1, 0.36, 1] as const;

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface ButtonProps {
  children: ReactNode;
  variant?: 'dark' | 'light' | 'ghost';
  size?: 'small';
  icon?: ReactNode;
  lead?: ReactNode;
  href?: string;
  download?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  onClick?: (event: MouseEvent) => void;
}

export function Button({
  children,
  variant = 'dark',
  size,
  icon,
  lead,
  href,
  download,
  disabled,
  type = 'button',
  className,
  onClick,
}: ButtonProps) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const classes = ['btn', `btn--${variant}`, size === 'small' ? 'btn--small' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  function press(event: PointerEvent<HTMLElement>): void {
    const box = event.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setRipples((current) => [
      ...current,
      { id, x: event.clientX - box.left, y: event.clientY - box.top },
    ]);
    setTimeout(() => {
      setRipples((current) => current.filter((ripple) => ripple.id !== id));
    }, 650);
  }
  const content = (
    <>
      <span className="btn__fill" />
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.span
            key={ripple.id}
            className="btn__ripple"
            style={{ left: ripple.x, top: ripple.y }}
            initial={{ scale: 0, opacity: 0.9 }}
            animate={{ scale: 28, opacity: 0 }}
            transition={{ duration: 0.65, ease: EASE }}
          />
        ))}
      </AnimatePresence>
      {lead !== undefined && <span className="btn__icon">{lead}</span>}
      <span className="btn__roll">
        <span>{children}</span>
        <span aria-hidden="true">{children}</span>
      </span>
      {icon !== undefined && <span className="btn__icon">{icon}</span>}
    </>
  );
  const tap = disabled === true ? undefined : { scale: 0.96 };
  if (href !== undefined) {
    return (
      <motion.span
        whileTap={tap}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{ display: 'inline-flex' }}
      >
        {download === true ? (
          <a href={href} download className={classes} onPointerDown={press}>
            {content}
          </a>
        ) : (
          <Link href={href} className={classes} onPointerDown={press}>
            {content}
          </Link>
        )}
      </motion.span>
    );
  }
  return (
    <motion.button
      type={type}
      className={classes}
      disabled={disabled}
      onPointerDown={press}
      onClick={onClick}
      whileTap={tap}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      {content}
    </motion.button>
  );
}

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
    <motion.button
      type="button"
      className={`choice ${active ? 'choice--active' : ''} ${disabled === true ? 'choice--disabled' : ''}`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      aria-pressed={active}
      disabled={disabled}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
    >
      <AnimatePresence>
        {active && (
          <motion.span
            className="choice__check"
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
          >
            <Check size={13} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
      {icon !== undefined && <span className="choice__icon">{icon}</span>}
      <span className="choice__title">{title}</span>
      {text !== undefined && <span className="choice__text">{text}</span>}
      {children}
    </motion.button>
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
        <motion.button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`segmented__item ${option.value === value ? 'segmented__item--active' : ''}`}
          whileTap={{ scale: 0.95 }}
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
        </motion.button>
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
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.16, ease: EASE },
};
