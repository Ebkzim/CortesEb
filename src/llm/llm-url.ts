import { AppError } from '../common/app-error.js';
import { isBlockedAddress } from '../common/safe-url.js';
import { isIP } from 'node:net';

export function llmBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('INVALID_INPUT', 'endereço do modelo inválido');
  }
  if (url.username !== '' || url.password !== '') {
    throw new AppError('INVALID_INPUT', 'o endereço do modelo não pode ter usuário e senha');
  }
  if (url.protocol === 'https:') return trimmed(url);
  if (url.protocol !== 'http:') {
    throw new AppError('INVALID_INPUT', 'o endereço do modelo precisa ser http ou https');
  }
  if (!isLocalHost(url.hostname)) {
    throw new AppError('INVALID_INPUT', 'http só é aceito para a própria máquina ou a rede local');
  }
  return trimmed(url);
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return isIP(host) !== 0 && isBlockedAddress(host);
}

function trimmed(url: URL): string {
  return url.toString().replace(/\/+$/, '');
}
