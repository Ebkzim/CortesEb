import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { LayoutService } from '../../layout/layout.service.js';
import { Workspace } from '../../workspace/workspace.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const layoutOptions = z.object({
  work: z.string().min(1).max(1024).optional(),
  global: z.boolean().default(false),
  camera: z.string().trim().min(1).max(100).optional(),
  cameraSize: z.coerce.number().min(10).max(100).optional(),
  bottom: z.enum(['video', 'source']).optional(),
  clear: z.boolean().default(false),
});

@Command({
  name: 'layout',
  description: 'define o layout dos cortes: rosto no topo (camera) e o que vai embaixo (bottom)',
})
export class LayoutCommand extends GuardedCommand {
  constructor(
    private readonly layouts: LayoutService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-w, --work <pasta>', description: 'pasta de trabalho do vídeo' })
  parseWork(value: string): string {
    return value;
  }

  @Option({ flags: '--global', description: 'grava como padrão para todos os vídeos' })
  parseGlobal(): boolean {
    return true;
  }

  @Option({
    flags: '--camera <posicao>',
    description: 'top-left, top-right, bottom-left, bottom-right, x,y,w,h em % ou none',
  })
  parseCamera(value: string): string {
    return value;
  }

  @Option({ flags: '--camera-size <%>', description: 'altura da câmera nos cantos (padrão 40)' })
  parseCameraSize(value: string): string {
    return value;
  }

  @Option({ flags: '--bottom <origem>', description: 'video (trailer) ou source (a própria live)' })
  parseBottom(value: string): string {
    return value;
  }

  @Option({ flags: '--clear', description: 'remove o layout salvo (do vídeo ou o global)' })
  parseClear(): boolean {
    return true;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(layoutOptions, raw);
    const workspace = options.work === undefined ? null : new Workspace(options.work);
    const patch = {
      ...(options.camera === undefined ? {} : { camera: options.camera }),
      ...(options.cameraSize === undefined ? {} : { cameraSize: options.cameraSize }),
      ...(options.bottom === undefined ? {} : { bottom: options.bottom }),
    };
    const changing = options.clear || Object.keys(patch).length > 0;
    if (!changing) {
      this.output.json(await this.layouts.view(workspace));
      return;
    }
    if (options.global) {
      this.output.json(
        options.clear ? await this.layouts.clearDefault() : await this.layouts.saveDefault(patch),
      );
      return;
    }
    if (workspace === null) {
      throw new AppError(
        'INVALID_INPUT',
        'informe --work para um vídeo, ou --global para o padrão',
      );
    }
    this.output.json(
      options.clear
        ? await this.layouts.clearWorkspace(workspace)
        : await this.layouts.saveForWorkspace(workspace, patch),
    );
  }
}
