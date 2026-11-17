import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../common/app-error.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = 'v1';
const KEY_MODE = 0o600;

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) throw new AppError('INVALID_INPUT', 'chave mestra inválida');
  }

  seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, data]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || iv === undefined || tag === undefined || data === undefined) {
      throw new AppError('INVALID_INPUT', 'segredo guardado em formato desconhecido');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new AppError('INVALID_INPUT', 'não consegui abrir o segredo (chave mestra diferente?)');
    }
  }
}

export async function loadMasterKey(home: string, fromEnv: string | undefined): Promise<Buffer> {
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const key = Buffer.from(fromEnv.trim(), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new AppError('INVALID_INPUT', 'CORTES_EB_MASTER_KEY precisa ter 32 bytes em base64');
    }
    return key;
  }
  const file = path.join(home, 'master.key');
  try {
    const key = Buffer.from((await fs.readFile(file, 'utf8')).trim(), 'base64');
    if (key.length === KEY_BYTES) return key;
    throw new AppError('INVALID_INPUT', 'master.key corrompida');
  } catch (error) {
    if (error instanceof AppError) throw error;
  }
  await fs.mkdir(home, { recursive: true });
  const key = randomBytes(KEY_BYTES);
  await fs.writeFile(file, key.toString('base64'), { mode: KEY_MODE, flag: 'wx' });
  return key;
}

export function hintOf(secret: string): string {
  const clean = secret.trim();
  return clean.length <= 8 ? '••••' : `••${clean.slice(-4)}`;
}
