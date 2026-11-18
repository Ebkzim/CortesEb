import path from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { HOME_ENV, resolveHome } from './app-paths.js';

export function loadUserEnvironment(): string {
  const home = resolveHome(process.env[HOME_ENV]);
  const file = path.join(home, '.env');
  loadEnvironment({ path: file, quiet: true });
  const tools = path.join(home, 'bin');
  const current = process.env.PATH ?? '';
  if (!current.split(path.delimiter).includes(tools)) {
    process.env.PATH = current === '' ? tools : `${tools}${path.delimiter}${current}`;
  }
  return file;
}
