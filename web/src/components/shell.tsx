'use client';

import { Clapperboard, FolderOpen, Plus, Settings } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ensureSession } from '@/lib/api';
import { ToastProvider } from './toast';
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

  const active = (href: string): boolean =>
    href === '/' ? pathname === '/' : pathname.startsWith(href.replace(/\/$/, ''));

  return (
    <ToastProvider>
      <Splash done={ready} />
      <div className="app">
        <header className="topbar">
          <div className="topbar__inner">
            <Link href="/" className="brand" aria-label="Início">
              cortes
              <span className="brand__dot" />
            </Link>
            <nav className="nav" aria-label="Principal">
              {LINKS.map(({ href, label, icon: Icon }) => (
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
              ))}
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
