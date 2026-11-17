import tls from 'node:tls';

export const TWITCH_CHAT_HOST = 'irc.chat.twitch.tv';
export const TWITCH_CHAT_PORT = 6697;
export const TWITCH_EDGE_SUFFIX = '.twitchircedge.twitch.a2z.com';

const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
const CHANNEL_PATTERN = /^[a-z0-9_]{3,25}$/;
const RESERVED_PATHS = new Set(['videos', 'directory', 'downloads', 'jobs', 'settings']);
const RECONNECT_MS = 3_000;
const MAX_PENDING = 64 * 1024;

export interface ChatSource {
  start(onMessage: () => void, onProblem: (message: string) => void): void;
  stop(): void;
}

export type IrcEvent = { kind: 'ping'; payload: string } | { kind: 'message' };

export function twitchChannel(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!TWITCH_HOSTS.has(url.hostname.toLowerCase())) return null;
  const name = (url.pathname.split('/')[1] ?? '').toLowerCase();
  if (!CHANNEL_PATTERN.test(name) || RESERVED_PATHS.has(name)) return null;
  return name;
}

export function certNamesAreTwitchEdge(altNames: string | undefined): boolean {
  const names = (altNames ?? '')
    .split(',')
    .map((name) => name.trim().replace(/^DNS:/, ''))
    .filter((name) => name !== '');
  return names.length > 0 && names.every((name) => name.endsWith(TWITCH_EDGE_SUFFIX));
}

function verifyIdentity(host: string, cert: tls.PeerCertificate): Error | undefined {
  const failure = tls.checkServerIdentity(host, cert);
  if (failure === undefined) return undefined;
  return certNamesAreTwitchEdge(cert.subjectaltname) ? undefined : failure;
}

export function parseIrcLine(line: string): IrcEvent | null {
  if (line.startsWith('PING')) return { kind: 'ping', payload: line.slice(4).trim() };
  if (line.includes(' PRIVMSG #')) return { kind: 'message' };
  return null;
}

export class TwitchChat implements ChatSource {
  private socket: tls.TLSSocket | null = null;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly channel: string) {}

  start(onMessage: () => void, onProblem: (message: string) => void): void {
    this.stopped = false;
    this.connect(onMessage, onProblem);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.socket?.destroy();
    this.socket = null;
  }

  private connect(onMessage: () => void, onProblem: (message: string) => void): void {
    const socket = tls.connect({
      host: TWITCH_CHAT_HOST,
      port: TWITCH_CHAT_PORT,
      checkServerIdentity: verifyIdentity,
    });
    this.socket = socket;
    socket.setEncoding('utf8');
    let pending = '';
    socket.on('secureConnect', () => {
      const nick = `justinfan${String(10_000 + Math.floor(Math.random() * 80_000))}`;
      socket.write(`NICK ${nick}\r\nJOIN #${this.channel}\r\n`);
    });
    socket.on('data', (chunk: string) => {
      const lines = (pending + chunk).split('\r\n');
      pending = (lines.pop() ?? '').slice(-MAX_PENDING);
      for (const line of lines) {
        const event = parseIrcLine(line);
        if (event?.kind === 'ping') socket.write(`PONG ${event.payload}\r\n`);
        else if (event?.kind === 'message') onMessage();
      }
    });
    socket.on('error', (error) => {
      onProblem(error.message.split('\n')[0] ?? 'erro de conexão');
    });
    socket.on('close', () => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.connect(onMessage, onProblem);
      }, RECONNECT_MS);
    });
  }
}
