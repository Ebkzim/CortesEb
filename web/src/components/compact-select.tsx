'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

interface Option {
  value: string;
  label: string;
  detail?: string;
}

export function CompactSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Selecione',
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 250 });
  const filtered = options.filter((option) =>
    `${option.label} ${option.detail ?? ''}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const selected = options.find((option) => option.value === value);

  function show(): void {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    const below = innerHeight - box.bottom - 16;
    const height = Math.min(290, Math.max(below, box.top - 16));
    setPosition({
      left: Math.max(12, Math.min(box.left, innerWidth - box.width - 12)),
      top: below >= 220 || below >= box.top ? box.bottom + 6 : box.top - height - 6,
      width: box.width,
      maxHeight: height,
    });
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  }
  function choose(next: string): void {
    onChange(next);
    setOpen(false);
    anchor.current?.focus();
  }
  useLayoutEffect(() => {
    const popup = menu.current;
    const trigger = anchor.current;
    if (!open || !popup || !trigger) return;
    if (!popup.matches(':popover-open')) popup.showPopover();
    const box = trigger.getBoundingClientRect();
    const below = innerHeight - box.bottom - 16;
    const above = box.top - 16;
    const maxHeight = Math.min(290, Math.max(below, above));
    const height = Math.min(popup.getBoundingClientRect().height, maxHeight);
    setPosition({
      left: Math.max(12, Math.min(box.left, innerWidth - box.width - 12)),
      top: below >= height || below >= above ? box.bottom + 6 : box.top - height - 6,
      width: box.width,
      maxHeight,
    });
  }, [open, filtered.length]);
  useEffect(() => {
    if (!open) return;
    const popup = menu.current;
    search.current?.focus();
    function outside(event: Event): void {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !anchor.current?.contains(event.target)
      )
        setOpen(false);
    }
    function resize(): void {
      setOpen(false);
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    function scroll(event: Event): void {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
      if (popup?.isConnected && popup.matches(':popover-open')) popup.hidePopover();
    };
  }, [open]);
  useEffect(() => {
    const option = menu.current?.querySelector('[data-active="true"]');
    const list = option?.parentElement;
    if (!option || !list) return;
    const item = option.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, [active, open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  function keyboard(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      anchor.current?.focus();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) =>
        Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))),
      );
    }
    if (event.key === 'Enter' && filtered[active]) {
      event.preventDefault();
      choose(filtered[active].value);
    }
    if (event.key === 'Tab') setOpen(false);
  }
  const portalRoot =
    anchor.current?.closest('dialog') ?? (typeof document !== 'undefined' ? document.body : null);
  return (
    <div className="compact-select">
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={anchor}
        className="compact-select__trigger"
        type="button"
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        <span id={`${id}-value`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {open &&
        portalRoot &&
        createPortal(
          <div
            ref={menu}
            popover="manual"
            className="compact-select__menu"
            style={position}
            onKeyDown={keyboard}
          >
            <div className="compact-select__search">
              <Search size={14} />
              <input
                ref={search}
                aria-label={`Buscar em ${label}`}
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={`${id}-list`}
                aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined}
                placeholder="Buscar opção…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />
            </div>
            <div
              role="listbox"
              id={`${id}-list`}
              aria-labelledby={`${id}-label`}
              className="compact-select__options"
            >
              {filtered.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  key={option.value}
                  aria-selected={option.value === value}
                  data-active={index === active}
                  tabIndex={-1}
                  onPointerMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.value)}
                >
                  <span>
                    <strong>{option.label}</strong>
                    {option.detail && <small>{option.detail}</small>}
                  </span>
                  {option.value === value && <Check size={15} />}
                </button>
              ))}
              {!filtered.length && <p>Nenhuma opção encontrada.</p>}
            </div>
          </div>,
          portalRoot,
        )}
    </div>
  );
}
