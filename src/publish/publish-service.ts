import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';
import { AppPaths, HOME_ENV } from '../config/app-paths.js';
import type { PolicyLimits } from './publish-policy.js';

export const SERVICE_NAME = 'cortes-eb-publish.service';

export interface ServiceStatus {
  supported: boolean;
  installed: boolean;
  active: boolean;
  unitFile: string | null;
}

const UNSAFE_UNIT_TEXT = /["\\%\r\n]/;

export function buildUnit(input: {
  node: string;
  main: string;
  home: string;
  limits: PolicyLimits;
}): string {
  for (const value of [input.node, input.main, input.home]) {
    if (!path.isAbsolute(value) || UNSAFE_UNIT_TEXT.test(value)) {
      throw new AppError('UNSAFE_PATH', `caminho não suportado no serviço: ${value}`);
    }
  }
  const maxPerDay = String(Math.trunc(input.limits.maxPerDay));
  const minGap = String(Math.round(input.limits.minGapMs / 60_000));
  return [
    '[Unit]',
    'Description=CortesEb - postagem automatica',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `Environment="${HOME_ENV}=${input.home}"`,
    `ExecStart="${input.node}" "${input.main}" queue run --live --max-per-day ${maxPerDay} --min-gap ${minGap}`,
    'Restart=on-failure',
    'RestartSec=30',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

@Injectable()
export class PublishService {
  constructor(
    private readonly paths: AppPaths,
    private readonly runner: ProcessRunner,
  ) {}

  get unitFile(): string {
    return path.join(os.homedir(), '.config', 'systemd', 'user', SERVICE_NAME);
  }

  async install(limits: PolicyLimits): Promise<ServiceStatus> {
    this.requireLinux();
    const unit = buildUnit({
      node: process.execPath,
      main: path.join(this.paths.packageRoot, 'dist', 'main.js'),
      home: this.paths.home,
      limits,
    });
    await fs.mkdir(path.dirname(this.unitFile), { recursive: true });
    await fs.writeFile(this.unitFile, unit, { mode: 0o644 });
    await this.systemctl(['daemon-reload']);
    await this.systemctl(['enable', SERVICE_NAME]);
    await this.systemctl(['restart', SERVICE_NAME]);
    return this.status();
  }

  async uninstall(): Promise<ServiceStatus> {
    this.requireLinux();
    await this.systemctl(['disable', '--now', SERVICE_NAME]).catch(() => undefined);
    await fs.rm(this.unitFile, { force: true });
    await this.systemctl(['daemon-reload']);
    return this.status();
  }

  async status(): Promise<ServiceStatus> {
    if (process.platform !== 'linux') {
      return { supported: false, installed: false, active: false, unitFile: null };
    }
    const installed = await fs
      .access(this.unitFile)
      .then(() => true)
      .catch(() => false);
    const active = installed
      ? await this.runner
          .run('systemctl', ['--user', 'is-active', SERVICE_NAME], { timeoutMs: 10_000 })
          .then((result) => result.stdout.trim() === 'active')
          .catch(() => false)
      : false;
    return { supported: true, installed, active, unitFile: this.unitFile };
  }

  private requireLinux(): void {
    if (process.platform !== 'linux') {
      throw new AppError(
        'NOT_CONFIGURED',
        'o serviço automático por enquanto só existe no Linux; use cortes-eb queue run --live',
      );
    }
  }

  private async systemctl(args: string[]): Promise<void> {
    const result = await this.runner.run('systemctl', ['--user', ...args], { timeoutMs: 30_000 });
    if (result.code !== 0) {
      const detail = (result.stderr.trim().split(/\r?\n/)[0] ?? '').slice(0, 200);
      throw new AppError('PROCESS_FAILED', `systemctl ${args.join(' ')} falhou: ${detail}`);
    }
  }
}
