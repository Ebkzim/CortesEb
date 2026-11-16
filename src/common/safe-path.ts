import path from 'node:path';
import { AppError } from './app-error.js';

export function resolveInside(base: string, ...parts: string[]): string {
  const root = path.resolve(base);
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('UNSAFE_PATH', `caminho fora de ${root}: ${parts.join('/')}`);
  }
  return target;
}

export function assertPlainName(name: string): string {
  if (name !== path.basename(name) || name === '.' || name === '..' || name.includes('\0')) {
    throw new AppError('UNSAFE_PATH', `nome de arquivo inválido: ${name}`);
  }
  return name;
}
