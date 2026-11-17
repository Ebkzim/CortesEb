import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import './globals.css';
import './screens.css';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  title: 'Cortes',
  description: 'Painel de cortes verticais',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={manrope.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
