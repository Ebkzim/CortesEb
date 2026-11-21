'use client';

import NextLink, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from 'react';

const NavigationContext = createContext<(id: symbol, pending: boolean, label: string) => void>(
  () => undefined,
);
const LABELS: Record<string, string> = {
  '/': 'Início',
  '/novo': 'Novo corte',
  '/fila': 'Fila de cortes',
  '/tarefa': 'Tarefa',
  '/clipes': 'Meus clipes',
  '/contas': 'Contas',
  '/config': 'Configurações',
};

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState(new Map<symbol, string>());
  const [visible, setVisible] = useState(false);
  const report = useCallback((id: symbol, pending: boolean, label: string) => {
    setRequests((current) => {
      if (pending ? current.get(id) === label : !current.has(id)) return current;
      const next = new Map(current);
      if (pending) next.set(id, label);
      else next.delete(id);
      return next;
    });
  }, []);
  const pending = requests.size > 0;
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, [pending]);
  return (
    <NavigationContext.Provider value={report}>
      {children}
      {pending && visible && (
        <div className="navigation-loading" role="status" aria-live="polite">
          <div className="navigation-loading__track" aria-hidden="true">
            <div className="navigation-loading__bar" />
          </div>
          <span className="navigation-loading__message">
            <span className="spinner" aria-hidden="true" />
            Abrindo {Array.from(requests.values()).at(-1) ?? 'a tela'}…
          </span>
        </div>
      )}
    </NavigationContext.Provider>
  );
}

function usePendingReport(pending: boolean, label: string): void {
  const report = useContext(NavigationContext);
  const id = useRef(Symbol('navigation'));
  useEffect(() => {
    const requestId = id.current;
    report(requestId, pending, label);
    return () => report(requestId, false, label);
  }, [pending, label, report]);
}

function LinkStatus({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  usePendingReport(pending, label);
  return null;
}

export function AppLink({ children, ...props }: ComponentProps<typeof NextLink>) {
  const path =
    typeof props.href === 'string' ? (props.href.split('?')[0] ?? '') : (props.href.pathname ?? '');
  const label = LABELS[path.replace(/\/$/, '') || '/'] ?? 'a tela';
  return (
    <NextLink {...props}>
      {children}
      <LinkStatus label={label} />
    </NextLink>
  );
}

export function usePanelRouter() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  usePendingReport(pending, 'a tela');
  return {
    ...router,
    push: (...args: Parameters<typeof router.push>) => startTransition(() => router.push(...args)),
    replace: (...args: Parameters<typeof router.replace>) =>
      startTransition(() => router.replace(...args)),
    back: () => startTransition(() => router.back()),
    forward: () => startTransition(() => router.forward()),
    refresh: () => startTransition(() => router.refresh()),
  };
}
