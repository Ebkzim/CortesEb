import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppPaths } from '../config/app-paths.js';
import { UserConfigStore } from '../config/user-config.js';
import { clipSchema } from '../contracts/cuts.js';
import { ImageFetcher } from '../images/image-fetcher.js';
import { AccountService } from './account.service.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe('AccountService', () => {
  let home: string;
  let logo: string;
  let service: AccountService;
  let store: UserConfigStore;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-acc-'));
    logo = path.join(home, 'input.png');
    await fs.writeFile(logo, PNG);
    process.env.CORTES_EB_HOME = path.join(home, 'data');
    const paths = new AppPaths();
    store = new UserConfigStore(paths);
    service = new AccountService(store, paths, new ImageFetcher());
  });

  afterEach(async () => {
    delete process.env.CORTES_EB_HOME;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('adds accounts, stores each logo and makes the first one default', async () => {
    const first = await service.save('gta', { name: '@gta', logo });
    await service.save('filmes', { name: '@filmes', logo });
    expect(first).toEqual({ id: 'gta', name: '@gta', logo: 'logo-gta.png', isDefault: true });
    expect((await service.list()).map((account) => account.id)).toEqual(['gta', 'filmes']);
    expect(await service.logoFile(first)).toBe(path.join(home, 'data', 'logo-gta.png'));
  });

  it('updates one field at a time and replaces the old logo file', async () => {
    await service.save('gta', { name: '@gta', logo });
    const other = path.join(home, 'other.jpg');
    await fs.writeFile(other, JPG);
    const updated = await service.save('gta', { logo: other });
    expect(updated).toMatchObject({ name: '@gta', logo: 'logo-gta.jpg' });
    expect(await fs.readdir(path.join(home, 'data'))).not.toContain('logo-gta.png');
    expect((await service.save('gta', { name: '@novo' })).name).toBe('@novo');
  });

  it('rejects bad ids, the reserved id and incomplete new accounts', async () => {
    for (const id of ['../x', 'A', 'all', '', 'a b']) {
      await expect(service.save(id, { name: 'x', logo })).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
    await expect(service.save('gta', { name: 'x' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(service.save('gta', { logo })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const fake = path.join(home, 'fake.png');
    await fs.writeFile(fake, '<svg/>');
    await expect(service.save('gta', { name: 'x', logo: fake })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('resolves default, explicit, all and unknown selections', async () => {
    await expect(service.resolve(undefined)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await service.save('a', { name: 'A', logo });
    await service.save('b', { name: 'B', logo });
    await service.save('c', { name: 'C', logo });
    const ids = async (input?: string[]): Promise<string[]> =>
      (await service.resolve(input)).map((account) => account.id);
    expect(await ids()).toEqual(['a']);
    expect(await ids(['c', 'b', 'c'])).toEqual(['c', 'b']);
    expect(await ids(['all'])).toEqual(['a', 'b', 'c']);
    await expect(service.resolve(['zz'])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await service.setDefault('b');
    expect(await ids()).toEqual(['b']);
  });

  it('removes an account, its logo and moves the default', async () => {
    await service.save('a', { name: 'A', logo });
    await service.save('b', { name: 'B', logo });
    const left = await service.remove('a');
    expect(left).toEqual([{ id: 'b', name: 'B', logo: 'logo-b.png', isDefault: true }]);
    expect(await fs.readdir(path.join(home, 'data'))).not.toContain('logo-a.png');
    expect(await service.remove('b')).toEqual([]);
    expect((await store.load()).defaultAccount).toBeUndefined();
    await expect(service.remove('b')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('clip accounts', () => {
  it('accepts account ids and rejects unsafe ones', () => {
    const base = { id: 'a', start: 0, end: 1 };
    expect(clipSchema.safeParse({ ...base, accounts: ['gta', 'filmes-2'] }).success).toBe(true);
    expect(clipSchema.safeParse({ ...base, accounts: ['../x'] }).success).toBe(false);
    expect(clipSchema.safeParse({ ...base, accounts: [] }).success).toBe(false);
  });
});
