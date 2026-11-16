import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { AppPaths } from '../config/app-paths.js';

export interface Niche {
  id: string;
  label: string;
  summary: string;
  bottomHint: string;
  defaultBottomUrl: string | null;
}

const NICHES: readonly Niche[] = [
  {
    id: 'gta6',
    label: 'GTA 6',
    summary: 'Cortes de streamers e podcasts falando de GTA 6',
    bottomHint: 'trailer oficial ou gameplay de GTA',
    defaultBottomUrl: 'https://www.youtube.com/watch?v=rz1B4B2yBZY',
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    summary: 'Cortes de lives e vídeos de qualquer jogo',
    bottomHint: 'gameplay do jogo comentado',
    defaultBottomUrl: null,
  },
  {
    id: 'filmes-series',
    label: 'Filmes e séries',
    summary: 'Cortes de reviews, reacts e análises de filmes e séries',
    bottomHint: 'trailer oficial da obra comentada',
    defaultBottomUrl: null,
  },
  {
    id: 'podcast',
    label: 'Podcast',
    summary: 'Cortes de conversas e entrevistas sobre qualquer assunto',
    bottomHint: 'b-roll neutro ou gameplay sem áudio',
    defaultBottomUrl: null,
  },
];

@Injectable()
export class NicheRegistry {
  constructor(private readonly paths: AppPaths) {}

  list(): readonly Niche[] {
    return NICHES;
  }

  get(id: string): Niche & { guide: string } {
    const niche = NICHES.find((item) => item.id === id);
    if (niche === undefined) {
      const known = NICHES.map((item) => item.id).join(', ');
      throw new AppError('INVALID_INPUT', `nicho desconhecido: ${id} (use ${known})`);
    }
    return { ...niche, guide: path.join(this.paths.skillDir, 'niches', `${niche.id}.md`) };
  }
}
