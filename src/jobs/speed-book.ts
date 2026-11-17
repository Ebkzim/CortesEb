import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';

const bookSchema = z.record(z.string().max(120), z.number().positive().max(100_000));
const WEIGHT = 0.5;
const KEY = /^[a-z0-9:._-]{1,120}$/;

export type SpeedKey = string;

@Injectable()
export class SpeedBook {
  private cache: Record<string, number> | null = null;

  constructor(private readonly paths: AppPaths) {}

  async rate(key: SpeedKey, fallback: number): Promise<number> {
    const book = await this.load();
    return book[clean(key)] ?? fallback;
  }

  async estimate(key: SpeedKey, units: number, fallback: number): Promise<number> {
    return Math.round((await this.rate(key, fallback)) * Math.max(0, units));
  }

  async record(key: SpeedKey, seconds: number, units: number): Promise<void> {
    if (!(seconds > 0) || !(units > 0)) return;
    const book = await this.load();
    const name = clean(key);
    const sample = seconds / units;
    const previous = book[name];
    book[name] = Number(
      (previous === undefined ? sample : previous * (1 - WEIGHT) + sample * WEIGHT).toFixed(4),
    );
    await writeJson(this.paths.inHome('speed.json'), book).catch(() => undefined);
  }

  private async load(): Promise<Record<string, number>> {
    if (this.cache !== null) return this.cache;
    const file = this.paths.inHome('speed.json');
    const parsed = (await exists(file)) ? await readJson(file, bookSchema).catch(() => ({})) : {};
    this.cache = { ...parsed };
    return this.cache;
  }
}

function clean(key: string): string {
  const value = key
    .toLowerCase()
    .replace(/[^a-z0-9:._-]/g, '-')
    .slice(0, 120);
  return KEY.test(value) ? value : 'desconhecido';
}
