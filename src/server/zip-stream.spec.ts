import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uniqueNames, zipSize, zipStream } from './zip-stream.js';

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function readZip(zip: Buffer): { name: string; data: Buffer; crc: number }[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const files = [];
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(cursor + 16);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const local = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26);
    files.push({ name, data: zip.subarray(start, start + size), crc });
    cursor += 46 + nameLength;
  }
  return files;
}

describe('zipStream', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-zip-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores every file with the right crc, size and utf-8 name', async () => {
    const first = path.join(dir, 'a.mp4');
    const second = path.join(dir, 'b.mp4');
    await fs.writeFile(first, Buffer.alloc(200_000, 7));
    await fs.writeFile(second, 'segundo clipe');
    const entries = [
      { name: 'corte-ação.mp4', file: first, size: 200_000 },
      { name: 'b.mp4', file: second, size: 13 },
    ];
    const zip = await collect(zipStream(entries));
    expect(zip.length).toBe(zipSize(entries));
    const files = readZip(zip);
    expect(files.map((file) => file.name)).toEqual(['corte-ação.mp4', 'b.mp4']);
    for (const file of files) expect(crc32(file.data) >>> 0).toBe(file.crc);
    expect(files[1]?.data.toString()).toBe('segundo clipe');
  });

  it('fails when a file changed size after it was listed', async () => {
    const file = path.join(dir, 'a.mp4');
    await fs.writeFile(file, 'abc');
    await expect(collect(zipStream([{ name: 'a.mp4', file, size: 99 }]))).rejects.toThrow(/mudou/);
  });

  it('refuses selections that would need zip64', () => {
    expect(() => zipStream([{ name: 'x.mp4', file: 'x', size: 4 * 1024 ** 3 }])).toThrow(/3,5 GB/);
  });

  it('renames duplicates without touching the extension', () => {
    expect(uniqueNames(['a.mp4', 'A.mp4', 'a.mp4', 'b'])).toEqual([
      'a.mp4',
      'A-2.mp4',
      'a-3.mp4',
      'b',
    ]);
  });
});
