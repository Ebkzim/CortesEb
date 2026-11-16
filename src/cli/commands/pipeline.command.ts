import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { exists } from '../../common/json-file.js';
import { Output } from '../../common/output.js';
import { VideoFetcher } from '../../download/video-fetcher.js';
import { MediaTools } from '../../media/media-tools.js';
import { TargetsService } from '../../planning/targets.service.js';
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

const fetchOptions = z.object({ work: workDir, role: role.default('source') });

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

  protected async execute(params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(fetchOptions, raw);
    const [input] = params;
    if (input === undefined) throw new AppError('INVALID_INPUT', 'informe o link ou o arquivo');
    const file = await this.fetcher.fetch(input, options.role, new Workspace(options.work));
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

  @Option({ flags: '--max-seconds <n>', description: 'transcreve só os primeiros n segundos' })
  parseMaxSeconds(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(transcribeOptions, raw);
    const summary = await this.transcription.run(new Workspace(options.work), {
      ...(options.lang === undefined ? {} : { language: options.lang }),
      ...(options.maxSeconds === undefined ? {} : { maxSeconds: options.maxSeconds }),
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
