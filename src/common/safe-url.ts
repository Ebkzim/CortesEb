import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { AppError } from './app-error.js';

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.0.0.0', 24, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addSubnet('198.18.0.0', 15, 'ipv4');
blocked.addSubnet('224.0.0.0', 3, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');

const MAX_URL_LENGTH = 2048;

export function parsePublicUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH) throw new AppError('UNSAFE_URL', 'link longo demais');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('UNSAFE_URL', 'link inválido');
  }
  if (url.protocol !== 'https:') throw new AppError('UNSAFE_URL', 'só aceito links https');
  if (url.username !== '' || url.password !== '') {
    throw new AppError('UNSAFE_URL', 'link com usuário e senha não é aceito');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new AppError('UNSAFE_URL', 'link aponta para a máquina local');
  }
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new AppError('UNSAFE_URL', 'link aponta para um endereço interno');
  }
  return url;
}

export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new AppError('UNSAFE_URL', `não resolvi o endereço de ${host}`);
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new AppError('UNSAFE_URL', `${host} aponta para um endereço interno`);
  }
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}
