import path from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { HOME_ENV, resolveHome } from './app-paths.js';

export function loadUserEnvironment(): string {
  const file = path.join(resolveHome(process.env[HOME_ENV]), '.env');
  loadEnvironment({ path: file, quiet: true });
  return file;
}
