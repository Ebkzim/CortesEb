import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import type { ClipImage } from '../contracts/cuts.js';
import type { Workspace } from '../workspace/workspace.js';
import { ImageFetcher } from './image-fetcher.js';
import { ImageSearch } from './image-search.js';

export interface ResolvedImage {
  file: string | null;
  warning: string | null;
}

@Injectable()
export class ImageResolver {
  constructor(
    private readonly fetcher: ImageFetcher,
    private readonly search: ImageSearch,
  ) {}

  async resolve(image: ClipImage, workspace: Workspace, baseName: string): Promise<ResolvedImage> {
    try {
      if (image.file !== undefined) {
        const stored = await this.fetcher.importFile(image.file, workspace.root, baseName);
        return { file: path.basename(stored), warning: null };
      }
      if (image.query !== undefined) {
        return await this.fromSearch(image.query, workspace, baseName);
      }
      return { file: null, warning: 'imagem sem arquivo nem busca' };
    } catch (error) {
      return { file: null, warning: describe(error) };
    }
  }

  private async fromSearch(
    query: string,
    workspace: Workspace,
    baseName: string,
  ): Promise<ResolvedImage> {
    if (!this.search.isConfigured()) {
      return { file: null, warning: `busca "${query}" pulada: faltam as chaves do Google` };
    }
    for (const link of await this.search.search(query)) {
      try {
        const stored = await this.fetcher.download(link, workspace.root, baseName);
        return { file: path.basename(stored), warning: null };
      } catch {
        continue;
      }
    }
    return { file: null, warning: `nenhuma imagem serviu para "${query}"` };
  }
}

function describe(error: unknown): string {
  return error instanceof AppError ? error.message : 'falha ao preparar a imagem';
}
