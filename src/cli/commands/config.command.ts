import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { AppPaths } from '../../config/app-paths.js';
import { UserConfigStore, WHISPER_MODELS, type UserConfig } from '../../config/user-config.js';
import { ImageFetcher } from '../../images/image-fetcher.js';
import { NicheRegistry } from '../../niches/niche-registry.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const profileOptions = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  logo: z.string().min(1).max(1024).optional(),
});

@Command({ name: 'profile', description: 'define o nome e a logo da marca d’água' })
export class ProfileCommand extends GuardedCommand {
  constructor(
    private readonly config: UserConfigStore,
    private readonly paths: AppPaths,
    private readonly images: ImageFetcher,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-n, --name <nome>', description: 'nome do perfil' })
  parseName(value: string): string {
    return value;
  }

  @Option({ flags: '-l, --logo <arquivo>', description: 'imagem da logo (png, jpg ou webp)' })
  parseLogo(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(profileOptions, raw);
    if (options.name === undefined && options.logo === undefined) {
      throw new AppError('INVALID_INPUT', 'informe --name, --logo ou os dois');
    }
    const patch: Partial<UserConfig> = {};
    if (options.name !== undefined) patch.profileName = options.name;
    if (options.logo !== undefined) {
      const stored = await this.images.importFile(options.logo, this.paths.home, 'logo');
      patch.logo = stored.slice(this.paths.home.length + 1);
    }
    const next = await this.config.update(patch);
    this.output.json({ profileName: next.profileName ?? null, logo: next.logo ?? null });
  }
}

const settingsOptions = z.object({
  model: z.enum(WHISPER_MODELS).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .optional(),
  sfxGain: z.coerce.number().min(0).max(2).optional(),
  niche: z.string().optional(),
});

@Command({ name: 'config', description: 'mostra ou altera modelo, idioma, volume e nicho' })
export class ConfigCommand extends GuardedCommand {
  constructor(
    private readonly config: UserConfigStore,
    private readonly niches: NicheRegistry,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-m, --model <modelo>', description: WHISPER_MODELS.join(', ') })
  parseModel(value: string): string {
    return value;
  }

  @Option({ flags: '--language <idioma>', description: 'idioma padrão, ex.: pt' })
  parseLanguage(value: string): string {
    return value;
  }

  @Option({ flags: '--sfx-gain <volume>', description: 'volume dos efeitos, de 0 a 2' })
  parseSfxGain(value: string): string {
    return value;
  }

  @Option({ flags: '--niche <id>', description: 'nicho padrão' })
  parseNiche(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(settingsOptions, raw);
    const patch: Partial<UserConfig> = {};
    if (options.model !== undefined) patch.whisperModel = options.model;
    if (options.language !== undefined) patch.language = options.language;
    if (options.sfxGain !== undefined) patch.sfxGain = options.sfxGain;
    if (options.niche !== undefined) patch.niche = this.niches.get(options.niche).id;
    this.output.json(await this.config.update(patch));
  }
}

@Command({
  name: 'niches',
  arguments: '[id]',
  description: 'lista os nichos ou mostra os dados de um',
})
export class NichesCommand extends GuardedCommand {
  constructor(
    private readonly niches: NicheRegistry,
    private readonly output: Output,
  ) {
    super();
  }

  protected execute(params: string[]): Promise<void> {
    const [id] = params;
    this.output.json(id === undefined ? this.niches.list() : this.niches.get(id));
    return Promise.resolve();
  }
}
