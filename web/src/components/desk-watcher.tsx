'use client';

import { ShieldAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { api, post } from '@/lib/api';
import type { DeskSnapshot, DeskState } from '@/lib/types';
import { SITE_NAME } from './clip-picker';
import { useToast } from './toast';
import { Button, EASE } from './ui';

const POLL_MS = 3000;
export const DESK_REQUIRED_EVENT = 'cortes:desk-required';
const FRAME_MS = 1200;
const DRAG_FRAME_MS = 600;
const MOVE_MS = 50;
const SPECIAL = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

const TITLE: Record<DeskState['reason'], (site: string) => string> = {
  captcha: (site) => `O ${site} pediu uma verificação`,
  login: (site) => `Entre na sua conta do ${site}`,
  verify: (site) => `O ${site} pediu uma confirmação`,
};

export function DeskWatcher({ base = '/desk' }: { base?: string }) {
  const toast = useToast();
  const [state, setState] = useState<DeskState | null>(null);
  const seen = useRef<string | null>(null);

  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    void api<DeskSnapshot>(`${base}/state`)
      .then((snapshot) => {
        if (snapshot.state !== null && snapshot.state.mode !== 'browser') {
          window.dispatchEvent(new Event(DESK_REQUIRED_EVENT));
        }
        setState((current) => {
          if (current !== null && snapshot.state === null) {
            toast('A janela de verificação foi encerrada. Confira o status da tarefa.');
          }
          return snapshot.state;
        });
        const next = snapshot.state;
        if (next !== null && seen.current !== next.id) {
          seen.current = next.id;
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('CortesEb precisa de você', { body: next.message });
          }
        }
      })
      .catch(() => undefined);
  }, [toast, base]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <AnimatePresence>
      {state !== null &&
        (state.mode === 'browser' ? (
          <motion.div
            key={state.id}
            className="desk-local"
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <strong>
              <ShieldAlert size={16} /> Verificação no Chrome
            </strong>
            <p>{state.message}</p>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                void post(`${base}/cancel`).catch(() => undefined);
              }}
            >
              Cancelar espera
            </Button>
          </motion.div>
        ) : (
          <DeskDialog
            key={state.id}
            state={state}
            base={base}
            onCancel={() => {
              void post(`${base}/cancel`).catch(() => undefined);
            }}
          />
        ))}
    </AnimatePresence>
  );
}

function DeskDialog({
  state,
  onCancel,
  base,
}: {
  state: DeskState;
  onCancel: () => void;
  base: string;
}) {
  const [frame, setFrame] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const lastMove = useRef(0);
  const commands = useRef<Record<string, unknown>[]>([]);
  const sending = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    let alive = true;
    active.current = true;
    let current: string | null = null;
    let fetching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    async function load(): Promise<void> {
      if (fetching || !alive) return;
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(() => {
          void load();
        }, FRAME_MS);
        return;
      }
      fetching = true;
      try {
        const response = await fetch(`/api${base}/frame`, {
          credentials: 'same-origin',
          signal: abort.signal,
        });
        if (!response.ok) throw new Error('sem imagem');
        const url = URL.createObjectURL(await response.blob());
        if (!alive) {
          URL.revokeObjectURL(url);
          return;
        }
        if (current !== null) URL.revokeObjectURL(current);
        current = url;
        setFrame(url);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      } finally {
        fetching = false;
        if (alive)
          timer = setTimeout(
            () => {
              void load();
            },
            pressed.current ? DRAG_FRAME_MS : FRAME_MS,
          );
      }
    }
    void load();
    screen.current?.focus();
    return () => {
      alive = false;
      active.current = false;
      clearTimeout(timer);
      abort.abort();
      commands.current = [];
      if (current !== null) URL.revokeObjectURL(current);
    };
  }, [base]);

  function send(body: Record<string, unknown>): void {
    if (!active.current) return;
    const last = commands.current.at(-1);
    // Keep only the newest pending human mouse movement. Down/up are never discarded.
    if (body.type === 'move' && last?.type === 'move')
      commands.current[commands.current.length - 1] = body;
    else commands.current.push(body);
    void flush();
  }

  async function flush(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    try {
      while (active.current && commands.current.length > 0) {
        const body = commands.current.shift();
        await post(`${base}/input`, body).catch(() => undefined);
      }
    } finally {
      sending.current = false;
    }
  }

  function point(event: PointerEvent<HTMLElement>): { x: number; y: number } {
    const image = screen.current?.querySelector('img');
    const box = (image ?? event.currentTarget).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function down(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    pressed.current = true;
    send({ type: 'down', ...point(event), button: event.button === 2 ? 'right' : 'left' });
  }

  function move(event: PointerEvent<HTMLDivElement>): void {
    const now = Date.now();
    if (now - lastMove.current < MOVE_MS) return;
    lastMove.current = now;
    if (!pressed.current && event.pointerType !== 'mouse') return;
    send({ type: 'move', ...point(event) });
  }

  function up(event: PointerEvent<HTMLDivElement>): void {
    if (!pressed.current) return;
    pressed.current = false;
    send({ type: 'up', ...point(event), button: event.button === 2 ? 'right' : 'left' });
  }

  function wheel(event: WheelEvent<HTMLDivElement>): void {
    send({
      type: 'wheel',
      dx: Math.max(-2000, Math.min(2000, event.deltaX)),
      dy: Math.max(-2000, Math.min(2000, event.deltaY)),
    });
  }

  function key(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (SPECIAL.has(event.key)) {
      event.preventDefault();
      send({ type: 'key', key: event.key });
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      send({ type: 'text', text: event.key });
    }
  }

  return (
    <motion.div
      className="lightbox desk"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="lightbox__inner desk__inner"
        initial={{ scale: 0.94, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 10 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        <div className="spread">
          <span className="row" style={{ gap: 10 }}>
            <ShieldAlert size={20} />
            <span className="stack" style={{ gap: 2 }}>
              <strong>{TITLE[state.reason](SITE_NAME[state.platform])}</strong>
              <span className="muted small">{state.message}</span>
            </span>
          </span>
          <button type="button" className="icon-button" aria-label="cancelar" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div
          ref={screen}
          className="desk__screen"
          style={{ aspectRatio: `${String(state.width)} / ${String(state.height)}` }}
          tabIndex={0}
          role="application"
          aria-label={`tela do navegador do ${SITE_NAME[state.platform]}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={wheel}
          onKeyDown={key}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text').slice(0, 500);
            if (text !== '') send({ type: 'text', text });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          {frame !== null && <img src={frame} alt="" draggable={false} />}
          {frame === null && (
            <span className="row muted">
              <span className="spinner" /> abrindo a tela
            </span>
          )}
        </div>
        <div className="spread">
          <span className="muted small">
            {failed
              ? 'A imagem parou de chegar. Confira se o serviço está ligado.'
              : 'Clique, arraste e digite aqui como se fosse o navegador. Quando terminar, a janela fecha sozinha.'}
          </span>
          <Button variant="ghost" size="small" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
