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
import { useToast } from './toast';
import { Button, EASE } from './ui';

const POLL_MS = 3000;
const FRAME_MS = 450;
const MOVE_MS = 40;
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

const TITLE: Record<DeskState['reason'], string> = {
  captcha: 'O TikTok pediu uma verificação',
  login: 'Entre na sua conta do TikTok',
  verify: 'O TikTok pediu uma confirmação',
};

export function DeskWatcher() {
  const toast = useToast();
  const [state, setState] = useState<DeskState | null>(null);
  const seen = useRef<string | null>(null);

  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    void api<DeskSnapshot>('/desk/state')
      .then((snapshot) => {
        setState((current) => {
          if (current !== null && snapshot.state === null) {
            toast(
              current.reason === 'login'
                ? 'Conta conectada.'
                : 'Verificação resolvida. A postagem continua.',
            );
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
  }, [toast]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <AnimatePresence>
      {state !== null && (
        <DeskDialog
          key={state.id}
          state={state}
          onCancel={() => {
            void post('/desk/cancel').catch(() => undefined);
          }}
        />
      )}
    </AnimatePresence>
  );
}

function DeskDialog({ state, onCancel }: { state: DeskState; onCancel: () => void }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const lastMove = useRef(0);

  useEffect(() => {
    let alive = true;
    let current: string | null = null;
    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/desk/frame', { credentials: 'same-origin' });
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
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, FRAME_MS);
    screen.current?.focus();
    return () => {
      alive = false;
      window.clearInterval(timer);
      if (current !== null) URL.revokeObjectURL(current);
    };
  }, []);

  function send(body: Record<string, unknown>): void {
    void post('/desk/input', body).catch(() => undefined);
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
              <strong>{TITLE[state.reason]}</strong>
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
          aria-label="tela do navegador do TikTok"
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
              ? 'A imagem parou de chegar. Confira se o serviço de postagem está ligado.'
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
