import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { LANGUAGE_PATTERN, UserConfigStore, WHISPER_MODELS } from '../../config/user-config.js';
import { parseCamera } from '../../live/camera.js';
import { LiveService } from '../../live/live.service.js';
import { twitchChannel } from '../../live/twitch-chat.js';
import { NicheRegistry } from '../../niches/niche-registry.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const liveOptions = z.object({
  out: z.string().min(1).max(1024).optional(),
  account: z.string().min(1).max(700).optional(),
  bottom: z.string().min(1).max(2048).optional(),
  lang: z.string().regex(LANGUAGE_PATTERN).optional(),
  model: z.enum(WHISPER_MODELS).optional(),
  threshold: z.coerce.number().min(1).max(30).default(6),
  lead: z.coerce.number().min(2).max(40).default(15),
  tail: z.coerce.number().min(3).max(40).default(8),
  minSeconds: z.coerce.number().min(8).max(120).default(20),
  maxSeconds: z.coerce.number().min(15).max(180).default(60),
  maxPerHour: z.coerce.number().int().min(1).max(120).default(12),
  maxClips: z.coerce.number().int().min(0).max(1000).default(0),
  maxHeight: z.coerce.number().int().min(240).max(2160).default(1080),
  offlineWait: z.coerce.number().min(0).max(86_400).default(120),
  keepMinutes: z.coerce.number().min(3).max(240).default(10),
  minWords: z.coerce.number().int().min(0).max(200).default(12),
  queue: z.coerce.number().int().min(1).max(20).default(3),
  keepWork: z.boolean().default(false),
  chat: z.boolean().default(true),
  camera: z.string().min(1).max(100).optional(),
  credit: z.string().trim().min(1).max(80).optional(),
  cameraSize: z.coerce.number().min(10).max(100).default(40),
});

@Command({
  name: 'live',
  arguments: '<link>',
  description: 'acompanha uma live ao vivo e vai gerando cortes enquanto ela acontece',
})
export class LiveCommand extends GuardedCommand {
  constructor(
    private readonly live: LiveService,
    private readonly config: UserConfigStore,
    private readonly niches: NicheRegistry,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-o, --out <pasta>', description: 'pasta de saída dos cortes' })
  parseOut(value: string): string {
    return value;
  }

  @Option({ flags: '-a, --account <ids>', description: 'contas separadas por vírgula, ou all' })
  parseAccount(value: string): string {
    return value;
  }

  @Option({ flags: '-b, --bottom <origem>', description: 'vídeo da metade de baixo, ou none' })
  parseBottom(value: string): string {
    return value;
  }

  @Option({ flags: '--lang <idioma>', description: 'idioma da live, ex.: pt, ou auto' })
  parseLang(value: string): string {
    return value;
  }

  @Option({ flags: '--model <modelo>', description: 'modelo do whisper (base é mais rápido)' })
  parseModel(value: string): string {
    return value;
  }

  @Option({ flags: '--threshold <db>', description: 'quanto acima do volume normal (padrão 6)' })
  parseThreshold(value: string): string {
    return value;
  }

  @Option({ flags: '--lead <s>', description: 'segundos antes do pico (padrão 15)' })
  parseLead(value: string): string {
    return value;
  }

  @Option({ flags: '--tail <s>', description: 'segundos depois do pico (padrão 8)' })
  parseTail(value: string): string {
    return value;
  }

  @Option({ flags: '--min-seconds <s>', description: 'duração mínima do corte (padrão 20)' })
  parseMinSeconds(value: string): string {
    return value;
  }

  @Option({ flags: '--max-seconds <s>', description: 'duração máxima do corte (padrão 60)' })
  parseMaxSeconds(value: string): string {
    return value;
  }

  @Option({ flags: '--max-per-hour <n>', description: 'limite de cortes por hora (padrão 12)' })
  parseMaxPerHour(value: string): string {
    return value;
  }

  @Option({ flags: '--max-clips <n>', description: 'para depois de n cortes (0 = sem limite)' })
  parseMaxClips(value: string): string {
    return value;
  }

  @Option({ flags: '--max-height <px>', description: 'altura máxima gravada (padrão 1080)' })
  parseMaxHeight(value: string): string {
    return value;
  }

  @Option({ flags: '--offline-wait <s>', description: 'quanto esperar a live voltar (padrão 120)' })
  parseOfflineWait(value: string): string {
    return value;
  }

  @Option({ flags: '--keep-minutes <n>', description: 'minutos de live guardados (padrão 10)' })
  parseKeepMinutes(value: string): string {
    return value;
  }

  @Option({ flags: '--min-words <n>', description: 'palavras mínimas por corte (padrão 12)' })
  parseMinWords(value: string): string {
    return value;
  }

  @Option({ flags: '--queue <n>', description: 'cortes esperando render (padrão 3)' })
  parseQueue(value: string): string {
    return value;
  }

  @Option({
    flags: '--camera <posicao>',
    description: 'rosto no topo: top-left, top-right, bottom-left, bottom-right ou x,y,w,h em %',
  })
  parseCamera(value: string): string {
    return value;
  }

  @Option({ flags: '--camera-size <%>', description: 'altura da câmera nos cantos (padrão 40)' })
  parseCameraSize(value: string): string {
    return value;
  }

  @Option({ flags: '--credit <texto>', description: 'crédito no rodapé, ou auto (Live de @canal)' })
  parseCredit(value: string): string {
    return value;
  }

  @Option({ flags: '--no-chat', description: 'não usa o chat da Twitch como sinal' })
  parseNoChat(): boolean {
    return false;
  }

  @Option({ flags: '--keep-work', description: 'mantém as pastas de trabalho dos cortes' })
  parseKeepWork(): boolean {
    return true;
  }

  protected async execute(params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(liveOptions, raw);
    const [link] = params;
    if (link === undefined) throw new Error('informe o link da live');
    const settings = await this.config.load();
    const niche = this.niches.get(settings.niche);
    const bottom =
      options.bottom === 'none' ? null : (options.bottom ?? niche.defaultBottomUrl ?? null);
    const controller = new AbortController();
    const stop = (): void => {
      if (controller.signal.aborted) process.exit(130);
      this.output.info('> encerrando e terminando os cortes pendentes (Ctrl+C de novo força)');
      controller.abort();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    await this.live.run(
      {
        link,
        outDir: options.out ?? `cortes/live-${stamp}`,
        accounts: options.account?.split(','),
        bottom,
        language: options.lang,
        model: options.model,
        detector: {
          threshold: options.threshold,
          lead: options.lead,
          tail: options.tail,
          minSeconds: options.minSeconds,
          maxSeconds: options.maxSeconds,
        },
        maxHeight: options.maxHeight,
        maxPerHour: options.maxPerHour,
        maxClips: options.maxClips,
        offlineWait: options.offlineWait,
        keepSeconds: options.keepMinutes * 60,
        minWords: options.minWords,
        maxQueue: options.queue,
        keepWork: options.keepWork,
        chat: options.chat,
        credit: creditText(options.credit, link),
        camera:
          options.camera === undefined ? null : parseCamera(options.camera, options.cameraSize),
      },
      controller.signal,
    );
  }
}

const frameOptions = z.object({
  out: z.string().min(1).max(1024).default('live-frame.jpg'),
  maxHeight: z.coerce.number().int().min(240).max(2160).default(1080),
});

@Command({
  name: 'live-frame',
  arguments: '<link>',
  description: 'tira uma foto da live ao vivo para escolher o recorte da câmera',
})
export class LiveFrameCommand extends GuardedCommand {
  constructor(
    private readonly live: LiveService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-o, --out <arquivo>', description: 'arquivo .jpg de saída' })
  parseOut(value: string): string {
    return value;
  }

  @Option({ flags: '--max-height <px>', description: 'altura máxima (padrão 1080)' })
  parseMaxHeight(value: string): string {
    return value;
  }

  protected async execute(params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(frameOptions, raw);
    const [link] = params;
    if (link === undefined) throw new Error('informe o link da live');
    this.output.json({ file: await this.live.snapshot(link, options.out, options.maxHeight) });
  }
}

function creditText(option: string | undefined, link: string): string | null {
  if (option === undefined) return null;
  if (option !== 'auto') return option;
  const channel = twitchChannel(link);
  if (channel === null) {
    throw new AppError('INVALID_INPUT', '--credit auto só funciona com link da Twitch');
  }
  return `Live de @${channel}`;
}
