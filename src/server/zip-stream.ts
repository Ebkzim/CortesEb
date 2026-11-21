import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { AppError } from '../common/app-error.js';

export interface ZipEntry {
  name: string;
  file: string;
  size: number;
}

export const MAX_ZIP_BYTES = 3.5 * 1024 * 1024 * 1024;

const FLAGS = 0x0008 | 0x0800;
const VERSION = 20;

export function zipSize(entries: readonly ZipEntry[]): number {
  return entries.reduce((total, entry) => {
    const name = Buffer.byteLength(entry.name);
    return total + 30 + name + entry.size + 16 + 46 + name;
  }, 22);
}

export function zipStream(entries: readonly ZipEntry[], now = new Date()): Readable {
  if (zipSize(entries) > MAX_ZIP_BYTES) {
    throw new AppError('INVALID_INPUT', 'a seleção passa de 3,5 GB; escolha menos clipes');
  }
  return Readable.from(generate(entries, dosStamp(now)));
}

export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((original) => {
    const dot = original.lastIndexOf('.');
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const ext = dot > 0 ? original.slice(dot) : '';
    let name = original;
    for (let index = 2; used.has(name.toLowerCase()); index += 1) {
      name = `${stem}-${String(index)}${ext}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

async function* generate(
  entries: readonly ZipEntry[],
  stamp: { time: number; date: number },
): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt16LE(name.length, 26);
    yield header;
    yield name;
    let crc = 0;
    let size = 0;
    for await (const chunk of createReadStream(entry.file)) {
      const data = chunk as Buffer;
      crc = crc32(data, crc);
      size += data.length;
      yield data;
    }
    if (size !== entry.size) {
      throw new AppError('MISSING_FILE', `${entry.name} mudou durante o download`);
    }
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(VERSION, 4);
    record.writeUInt16LE(VERSION, 6);
    record.writeUInt16LE(FLAGS, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(stamp.time, 12);
    record.writeUInt16LE(stamp.date, 14);
    record.writeUInt32LE(crc >>> 0, 16);
    record.writeUInt32LE(size, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += 30 + name.length + size + 16;
  }
  const directory = Buffer.concat(central);
  yield directory;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  yield end;
}

function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
