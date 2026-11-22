import type { BrowserPlatform } from '../browser/browser-sessions.js';
import { SITES } from '../browser/sites.js';

export function warmingFailure(error: unknown, platform: BrowserPlatform, step: string): string {
  const detail =
    error instanceof Error
      ? (error.message.split('\n')[0] ?? 'Erro na navegação.')
      : 'Erro na navegação.';
  if (!/\bTimeout \d+ms exceeded\b/i.test(detail)) return detail;
  return `${SITES[platform].label}: a página não respondeu a tempo ao ${step}. Confira a captura e o histórico antes de retomar.`;
}
