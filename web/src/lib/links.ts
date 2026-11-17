import type { PlatformId } from './types';

const HOSTS: Record<PlatformId, string[]> = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  twitch: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
  kick: ['kick.com', 'www.kick.com'],
};

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube',
};

export function linkError(text: string, platform: PlatformId): string | null {
  const value = text.trim();
  if (value === '') return 'cole o link';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'isso não parece um link';
  }
  if (url.protocol !== 'https:') return 'o link precisa começar com https://';
  if (!HOSTS[platform].includes(url.hostname.toLowerCase())) {
    return `esse link não é da ${PLATFORM_LABEL[platform]}`;
  }
  return null;
}
