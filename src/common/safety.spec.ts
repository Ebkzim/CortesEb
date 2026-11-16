import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './app-error.js';
import { exists, readJson, writeJson } from './json-file.js';
import { assertPlainName, resolveInside } from './safe-path.js';
import { isBlockedAddress, parsePublicUrl } from './safe-url.js';

describe('resolveInside', () => {
  it('resolves paths under the base', () => {
    expect(resolveInside('/base', 'a', 'b.mp4')).toBe(path.resolve('/base/a/b.mp4'));
  });

  it('rejects traversal and absolute escapes', () => {
    for (const parts of [['..', 'x'], ['a', '..', '..', 'x'], ['/etc/passwd']]) {
      expect(() => resolveInside('/base', ...parts)).toThrow(AppError);
    }
  });
});

describe('assertPlainName', () => {
  it('accepts plain file names', () => {
    expect(assertPlainName('logo.png')).toBe('logo.png');
  });

  it('rejects separators, dots and null bytes', () => {
    for (const name of ['a/b', '..', '.', 'a\0b', '../x']) {
      expect(() => assertPlainName(name)).toThrow(AppError);
    }
  });
});

describe('parsePublicUrl', () => {
  it('accepts public https links', () => {
    expect(parsePublicUrl('https://www.youtube.com/watch?v=abc').hostname).toBe('www.youtube.com');
  });

  it('rejects unsafe links', () => {
    const unsafe = [
      'http://example.com/a',
      'file:///etc/passwd',
      'ftp://example.com/a',
      'https://user:pass@example.com/',
      'https://localhost/a',
      'https://app.localhost/a',
      'https://printer.local/a',
      'https://127.0.0.1/a',
      'https://10.1.2.3/a',
      'https://192.168.0.10/a',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a',
      'not a url',
      `https://example.com/${'a'.repeat(3000)}`,
    ];
    for (const link of unsafe) {
      expect(() => parsePublicUrl(link), link).toThrow(AppError);
    }
  });
});

describe('isBlockedAddress', () => {
  it('blocks private, loopback and link-local ranges', () => {
    for (const address of [
      '10.0.0.1',
      '172.16.5.5',
      '::ffff:127.0.0.1',
      'fe80::1',
      'fd00::1',
      'x',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows public addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('json files', () => {
  let folder: string;
  const schema = z.strictObject({ value: z.number() });

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-test-'));
  });

  afterEach(async () => {
    await fs.rm(folder, { recursive: true, force: true });
  });

  it('writes atomically and reads back validated data', async () => {
    const file = path.join(folder, 'nested', 'data.json');
    await writeJson(file, { value: 3 }, 0o600);
    expect(await readJson(file, schema)).toEqual({ value: 3 });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(path.dirname(file))).toEqual(['data.json']);
  });

  it('reports missing, malformed and invalid files', async () => {
    const file = path.join(folder, 'data.json');
    await expect(readJson(file, schema)).rejects.toMatchObject({ code: 'MISSING_FILE' });
    await fs.writeFile(file, '{oops');
    await expect(readJson(file, schema)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await fs.writeFile(file, '{"value":"x"}');
    await expect(readJson(file, schema)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await exists(file)).toBe(true);
    expect(await exists(path.join(folder, 'nope'))).toBe(false);
  });
});
