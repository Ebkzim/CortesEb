import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { exists } from '../../common/json-file.js';
import { Output } from '../../common/output.js';
import { PeaksService } from '../../analysis/peaks.service.js';
import { VideoFetcher } from '../../download/video-fetcher.js';
import { MediaTools } from '../../media/media-tools.js';
import { TargetsService } from '../../planning/targets.service.js';
import { ENGINE_NAMES } from '../../render/render-engine.js';
import { RenderService } from '../../render/render.service.js';
import { SfxGenerator } from '../../sfx/sfx-generator.js';
import { TranscriptionService } from '../../transcription/transcription.service.js';
import { Workspace } from '../../workspace/workspace.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const workDir = z.string().min(1).max(1024);
const role = z.enum(['source', 'bottom']);

abstract class WorkspaceCommand extends GuardedCommand {
  @Option({ flags: '-w, --work <pasta>', description: 'pasta de trabalho', required: true })
  parseWork(value: string): string {
    return value;
  }
}

const fetchOptions = z.object({
  work: workDir,
  role: role.default('source'),
  from: z.coerce.number().min(0).max(864_000).optional(),
  to: z.coerce.number().positive().max(864_000).optional(),
});

@Command({
  name: 'fetch',
  arguments: '<origem>',
  description: 'baixa um link ou importa um arquivo de vídeo para a pasta de trabalho',
})
export class FetchCommand extends WorkspaceCommand {
  constructor(
    private readonly fetcher: VideoFetcher,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-r, --role <papel>', description: 'source (padrão) ou bottom' })
  parseRole(value: string): string {
    return value;
  }

  @Option({ flags: '--from <segundos>', description: 'baixa só a partir deste ponto' })
  parseFrom(value: string): string {
    return value;
  }

  @Option({ flags: '--to <segundos>', description: 'baixa só até este ponto' })
  parseTo(value: string): string {
    return value;
  }

  protected async execute(params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(fetchOptions, raw);
    const section =
      options.from === undefined && options.to === undefined
        ? undefined
        : { from: options.from ?? 0, to: options.to ?? Number.POSITIVE_INFINITY };
    if (section !== undefined && !Number.isFinite(section.to)) {
      throw new AppError('INVALID_INPUT', 'informe --to junto com --from');
    }
    const [input] = params;
    if (input === undefined) throw new AppError('INVALID_INPUT', 'informe o link ou o arquivo');
    const file = await this.fetcher.fetch(
      input,
      options.role,
      new Workspace(options.work),
      section,
    );
    this.output.json({ role: options.role, file });
  }
}

const transcribeOptions = z.object({
  work: workDir,
  lang: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .optional(),
  maxSeconds: z.coerce.number().positive().max(86_400).optional(),
  from: z.coerce.number().min(0).max(86_400).optional(),
  to: z.coerce.number().positive().max(86_400).optional(),
});

@Command({ name: 'transcribe', description: 'transcreve o source.mp4 e mede os silêncios' })
export class TranscribeCommand extends WorkspaceCommand {
  constructor(
    private readonly transcription: TranscriptionService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--lang <idioma>', description: 'idioma do vídeo, ex.: pt' })
  parseLang(value: string): string {
    return value;
  }

  @Option({ flags: '--from <segundos>', description: 'retranscreve só a partir deste ponto' })
  parseFrom(value: string): string {
    return value;
  }

  @Option({ flags: '--to <segundos>', description: 'retranscreve só até este ponto' })
  parseTo(value: string): string {
    return value;
  }

  @Option({ flags: '--max-seconds <n>', description: 'transcreve só os primeiros n segundos' })
  parseMaxSeconds(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(transcribeOptions, raw);
    const summary = await this.transcription.run(new Workspace(options.work), {
      ...(options.lang === undefined ? {} : { language: options.lang }),
      ...(options.maxSeconds === undefined ? {} : { maxSeconds: options.maxSeconds }),
      ...(options.from === undefined ? {} : { from: options.from }),
      ...(options.to === undefined ? {} : { to: options.to }),
    });
    this.output.json(summary);
  }
}

@Command({ name: 'transcript', description: 'imprime a transcrição em linhas [mm:ss]' })
export class TranscriptCommand extends WorkspaceCommand {
  constructor(
    private readonly transcription: TranscriptionService,
    private readonly output: Output,
  ) {
    super();
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(z.object({ work: workDir }), raw);
    for (const line of await this.transcription.lines(new Workspace(options.work))) {
      this.output.line(line);
    }
  }
}

const planOptions = z.object({
  work: workDir,
  minSeconds: z.coerce.number().positive().optional(),
  maxSeconds: z.coerce.number().positive().optional(),
  count: z.coerce.number().int().positive().optional(),
});

@Command({
  name: 'plan',
  description: 'define quantos cortes e de que duração, a partir do vídeo de origem',
})
export class PlanCommand extends WorkspaceCommand {
  constructor(
    private readonly targets: TargetsService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--min-seconds <n>', description: 'duração mínima de cada corte' })
  parseMinSeconds(value: string): string {
    return value;
  }

  @Option({ flags: '--max-seconds <n>', description: 'duração máxima de cada corte' })
  parseMaxSeconds(value: string): string {
    return value;
  }

  @Option({ flags: '-c, --count <n>', description: 'quantidade de cortes' })
  parseCount(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(planOptions, raw);
    const targets = await this.targets.define(new Workspace(options.work), {
      ...(options.minSeconds === undefined ? {} : { minSeconds: options.minSeconds }),
      ...(options.maxSeconds === undefined ? {} : { maxSeconds: options.maxSeconds }),
      ...(options.count === undefined ? {} : { count: options.count }),
    });
    this.output.json(targets);
  }
}

@Command({ name: 'check', description: 'confere o cuts.json contra o plano, sem renderizar' })
export class CheckCommand extends WorkspaceCommand {
  constructor(
    private readonly targets: TargetsService,
    private readonly output: Output,
  ) {
    super();
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(z.object({ work: workDir }), raw);
    const check = await this.targets.check(new Workspace(options.work));
    this.output.json(check);
    if (!check.ok) process.exitCode = 1;
  }
}

const peaksOptions = z.object({
  work: workDir,
  top: z.coerce.number().int().min(1).max(50).default(10),
  threshold: z.coerce.number().min(1).max(30).optional(),
  minSeconds: z.coerce.number().min(5).max(180).optional(),
  maxSeconds: z.coerce.number().min(10).max(300).optional(),
});

@Command({
  name: 'peaks',
  description: 'acha momentos de pico de volume (gritos, risadas) sem transcrever nada',
})
export class PeaksCommand extends WorkspaceCommand {
  constructor(
    private readonly peaks: PeaksService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--top <n>', description: 'quantos momentos listar (padrão 10)' })
  parseTop(value: string): string {
    return value;
  }

  @Option({ flags: '--threshold <db>', description: 'quanto acima do volume normal (padrão 6 dB)' })
  parseThreshold(value: string): string {
    return value;
  }

  @Option({ flags: '--min-seconds <n>', description: 'duração mínima de cada momento' })
  parseMinSeconds(value: string): string {
    return value;
  }

  @Option({ flags: '--max-seconds <n>', description: 'duração máxima de cada momento' })
  parseMaxSeconds(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(peaksOptions, raw);
    this.output.json(
      await this.peaks.scan(new Workspace(options.work), {
        top: options.top,
        ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
        ...(options.minSeconds === undefined ? {} : { minSeconds: options.minSeconds }),
        ...(options.maxSeconds === undefined ? {} : { maxSeconds: options.maxSeconds }),
      }),
    );
  }
}

const captionsOptions = z.object({
  work: workDir,
  lang: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .optional(),
  url: z.string().min(1).max(2048).optional(),
});

@Command({
  name: 'captions',
  description: 'usa a legenda automática do YouTube como transcrição rápida',
})
export class CaptionsCommand extends WorkspaceCommand {
  constructor(
    private readonly transcription: TranscriptionService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--lang <idioma>', description: 'idioma da legenda, ex.: pt' })
  parseLang(value: string): string {
    return value;
  }

  @Option({ flags: '--url <link>', description: 'link do vídeo, se não veio do fetch' })
  parseUrl(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(captionsOptions, raw);
    this.output.json(
      await this.transcription.fromYoutube(new Workspace(options.work), options.lang, options.url),
    );
  }
}

const refineOptions = z.object({
  work: workDir,
  pad: z.coerce.number().min(0).max(30).default(2),
});

@Command({
  name: 'refine',
  description: 'retranscreve com o whisper só os trechos dos cortes do cuts.json',
})
export class RefineCommand extends WorkspaceCommand {
  constructor(
    private readonly transcription: TranscriptionService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({
    flags: '--pad <segundos>',
    description: 'folga antes e depois de cada corte (padrão 2)',
  })
  parsePad(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(refineOptions, raw);
    this.output.json(await this.transcription.refine(new Workspace(options.work), options.pad));
  }
}

const frameOptions = z.object({
  work: workDir,
  at: z.coerce.number().min(0).max(86_400).default(5),
  role: role.default('source'),
});

@Command({ name: 'frame', description: 'extrai um quadro do vídeo para conferir o enquadramento' })
export class FrameCommand extends WorkspaceCommand {
  constructor(
    private readonly media: MediaTools,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--at <segundos>', description: 'instante do quadro (padrão 5)' })
  parseAt(value: string): string {
    return value;
  }

  @Option({ flags: '-r, --role <papel>', description: 'source (padrão) ou bottom' })
  parseRole(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(frameOptions, raw);
    const workspace = new Workspace(options.work);
    const video = workspace.video(options.role);
    if (!(await exists(video))) {
      throw new AppError('MISSING_FILE', `falta o ${options.role}.mp4 na pasta de trabalho`);
    }
    const file = workspace.file(`frame-${options.role}.jpg`);
    await this.media.frame(video, options.at, file);
    const meta = await this.media.probe(video);
    this.output.json({ file, width: meta.width, height: meta.height });
  }
}

const renderOptions = z.object({
  work: workDir,
  out: z.string().min(1).max(1024),
  account: z.string().min(1).max(700).optional(),
  engine: z.enum(ENGINE_NAMES).default('fast'),
});

@Command({ name: 'render', description: 'renderiza os cortes do cuts.json' })
export class RenderCommand extends WorkspaceCommand {
  constructor(
    private readonly renderer: RenderService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-o, --out <pasta>', description: 'pasta de saída', required: true })
  parseOut(value: string): string {
    return value;
  }

  @Option({ flags: '-e, --engine <motor>', description: 'fast (padrão) ou remotion' })
  parseEngine(value: string): string {
    return value;
  }

  @Option({ flags: '-a, --account <ids>', description: 'contas separadas por vírgula, ou all' })
  parseAccount(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(renderOptions, raw);
    const results = await this.renderer.run(
      new Workspace(options.work),
      options.out,
      options.account?.split(','),
      options.engine,
    );
    this.output.json(results);
    if (results.some((result) => !result.ok)) process.exitCode = 1;
  }
}

@Command({ name: 'sfx', description: 'gera os efeitos sonoros com a ElevenLabs' })
export class SfxCommand extends GuardedCommand {
  constructor(
    private readonly generator: SfxGenerator,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--force', description: 'gera de novo mesmo os que já existem' })
  parseForce(): boolean {
    return true;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(z.object({ force: z.boolean().default(false) }), raw);
    const outcomes = await this.generator.generate(options.force);
    this.output.json(outcomes);
    if (outcomes.some((outcome) => outcome.status === 'failed')) process.exitCode = 1;
  }
}
