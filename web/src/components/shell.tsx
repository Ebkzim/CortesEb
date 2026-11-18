'use client';

import { Clapperboard, FolderOpen, Layers, Plus, Settings, SquarePlus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ensureSession } from '@/lib/api';
import { useJobEvents } from '@/lib/events';
import { ToastProvider, useToast } from './toast';
import { Splash } from './splash';

const LINKS = [
  { href: '/', label: 'Início', icon: Clapperboard },
  { href: '/novo/', label: 'Novo corte', icon: Plus },
  { href: '/clipes/', label: 'Meus clipes', icon: FolderOpen },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureSession()
      .then(() => {
        setReady(true);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'não consegui abrir a sessão');
        setReady(true);
      });
  }, []);

  const [menu, setMenu] = useState(false);
  const active = (href: string): boolean =>
    href === '/'
      ? pathname === '/'
      : href === '/novo/'
        ? pathname.startsWith('/novo') || pathname.startsWith('/fila')
        : pathname.startsWith(href.replace(/\/$/, ''));

  useEffect(() => {
    setMenu(false);
  }, [pathname]);

  return (
    <ToastProvider>
      {ready && error === null && <ClipNotifier pathname={pathname} />}
      <Splash done={ready} />
      <div className="app">
        <header className="topbar">
          <div className="topbar__inner">
            <Link href="/" className="brand" aria-label="Início">
              cortes
              <span className="brand__dot" />
            </Link>
            <nav className="nav" aria-label="Principal">
              {LINKS.map(({ href, label, icon: Icon }) => {
                const link = (
                  <Link
                    key={href}
                    href={href}
                    className={`nav__link ${active(href) ? 'nav__link--active' : ''}`}
                  >
                    {active(href) && (
                      <motion.span
                        layoutId="nav-pill"
                        className="nav__pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                      />
                    )}
                    <Icon size={16} />
                    <span className="nav__label">{label}</span>
                  </Link>
                );
                if (href !== '/novo/') return link;
                return (
                  <div
                    key={href}
                    className="nav__group"
                    onMouseEnter={() => {
                      setMenu(true);
                    }}
                    onMouseLeave={() => {
                      setMenu(false);
                    }}
                    onFocus={() => {
                      setMenu(true);
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false);
                    }}
                  >
                    {link}
                    <AnimatePresence>
                      {menu && (
                        <motion.div
                          className="nav__menu"
                          initial={{ opacity: 0, y: -6, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.98 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <Link href="/novo/" className="nav__option">
                            <span className="nav__option-icon">
                              <SquarePlus size={16} />
                            </span>
                            <span className="nav__option-text">
                              <strong>Corte único</strong>
                              <span>Um vídeo, passo a passo.</span>
                            </span>
                          </Link>
                          <Link href="/fila/" className="nav__option">
                            <span className="nav__option-icon">
                              <Layers size={16} />
                            </span>
                            <span className="nav__option-text">
                              <strong>Cortes em fila</strong>
                              <span>Vários vídeos para cada conta, rodando sozinho.</span>
                            </span>
                          </Link>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </nav>
            <Link href="/config/" className="icon-button topbar__end" aria-label="Configurações">
              <Settings size={18} />
            </Link>
          </div>
        </header>
        {error !== null ? (
          <main className="page">
            <div className="empty">
              <p className="title-md" style={{ color: 'var(--ink)' }}>
                Sessão fechada
              </p>
              <p style={{ marginTop: 10 }}>{error}</p>
            </div>
          </main>
        ) : (
          ready && (
            <AnimatePresence mode="wait">
              <motion.main
                key={pathname}
                className="page"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.main>
            </AnimatePresence>
          )
        )}
      </div>
    </ToastProvider>
  );
}

function ClipNotifier({ pathname }: { pathname: string }) {
  const toast = useToast();
  useJobEvents((event) => {
    if (event.type !== 'clip') return;
    if (pathname.startsWith('/tarefa') || pathname.startsWith('/fila')) return;
    toast(`Corte pronto: ${event.clip.title}`);
  });
  return null;
}
