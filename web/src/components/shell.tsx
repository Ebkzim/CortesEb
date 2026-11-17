'use client';

import { Clapperboard, FolderOpen, Plus, Settings } from 'lucide-react';
import { motion } from 'motion/react';
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
                  className={`nav__link row ${active(href) ? 'nav__link--active' : ''}`}
                  style={{ gap: 8 }}
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
            <Link href="/config/" className="icon-button" aria-label="Configurações">
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
          ready && <main className="page">{children}</main>
        )}
      </div>
    </ToastProvider>
  );
}
