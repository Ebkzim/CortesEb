import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { AppError } from './app-error.js';

const MAX_JSON_BYTES = 64 * 1024 * 1024;

export async function readJson<Schema extends z.ZodType>(
  file: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: string;
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_JSON_BYTES) {
      throw new AppError('INVALID_INPUT', `${path.basename(file)} é grande demais`);
    }
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('MISSING_FILE', `não achei ${file}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_INPUT', `${path.basename(file)} não é um JSON válido`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? '' : `${issue.path.join('.')}: ${issue.message}`;
    throw new AppError('INVALID_INPUT', `${path.basename(file)} inválido (${where})`);
  }
  return parsed.data;
}

export async function writeJson(file: string, data: unknown, mode = 0o644): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
