const AD_MARKER = /stitched-ad|twitch-ad|X-TV-TWITCH-AD/i;
const POLL_MS = 4_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_PLAYLIST_BYTES = 1024 * 1024;

export type TextFetcher = (url: string) => Promise<string>;

export function playlistHasAd(text: string): boolean {
  return AD_MARKER.test(text);
}

export async function fetchPlaylist(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return '';
  const text = await response.text();
  return text.slice(0, MAX_PLAYLIST_BYTES);
}

export class AdWatcher {
  private active = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly onChange: (active: boolean) => void,
    private readonly fetchText: TextFetcher = fetchPlaylist,
    private readonly interval = POLL_MS,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.poll().catch(() => undefined);
    }, this.interval);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.active) this.set(false);
  }

  async poll(): Promise<void> {
    let text = '';
    try {
      text = await this.fetchText(this.url);
    } catch {
      return;
    }
    this.set(playlistHasAd(text));
  }

  private set(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.onChange(active);
  }
}
