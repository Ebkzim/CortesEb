import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';
import { AppPaths, HOME_ENV } from '../config/app-paths.js';
import type { PolicyLimits } from './publish-policy.js';

export const SERVICE_NAME = 'cortes-eb-publish.service';
export const AGENT_LABEL = 'com.cortes-eb.publish';

export interface ServiceStatus {
  supported: boolean;
  installed: boolean;
  active: boolean;
  unitFile: string | null;
}

interface ServiceInput {
  node: string;
  main: string;
  home: string;
  limits: PolicyLimits;
}

const UNSAFE_UNIT_TEXT = /["\\%\r\n]/;
const UNSAFE_AGENT_TEXT = /[<>&"'\r\n]/;
const AGENT_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

function checkPaths(input: ServiceInput, unsafe: RegExp): void {
  for (const value of [input.node, input.main, input.home]) {
    if (!path.isAbsolute(value) || unsafe.test(value)) {
      throw new AppError('UNSAFE_PATH', `caminho não suportado no serviço: ${value}`);
    }
  }
}

function limitArgs(limits: PolicyLimits): string[] {
  return [
    '--max-per-day',
    String(Math.trunc(limits.maxPerDay)),
    '--min-gap',
    String(Math.round(limits.minGapMs / 60_000)),
  ];
}

export function buildLaunchAgent(input: ServiceInput): string {
  checkPaths(input, UNSAFE_AGENT_TEXT);
  const args = [input.node, input.main, 'queue', 'run', '--live', ...limitArgs(input.limits)];
  const log = path.join(input.home, 'logs', 'publish.log');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${AGENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((arg) => `    <string>${arg}</string>`),
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    `    <key>${HOME_ENV}</key>`,
    `    <string>${input.home}</string>`,
    '    <key>PATH</key>',
    `    <string>${[path.join(input.home, 'bin'), ...AGENT_PATH].join(':')}</string>`,
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    '  <integer>30</integer>',
    '  <key>StandardOutPath</key>',
    `  <string>${log}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${log}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function buildUnit(input: ServiceInput): string {
  checkPaths(input, UNSAFE_UNIT_TEXT);
  return [
    '[Unit]',
    'Description=CortesEb - postagem automatica',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `Environment="${HOME_ENV}=${input.home}"`,
    `ExecStart="${input.node}" "${input.main}" queue run --live ${limitArgs(input.limits).join(' ')}`,
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
    return process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`)
      : path.join(os.homedir(), '.config', 'systemd', 'user', SERVICE_NAME);
  }

  async install(limits: PolicyLimits): Promise<ServiceStatus> {
    this.requireSupported();
    const input = {
      node: process.execPath,
      main: path.join(this.paths.packageRoot, 'dist', 'main.js'),
      home: this.paths.home,
      limits,
    };
    await fs.mkdir(path.dirname(this.unitFile), { recursive: true });
    if (process.platform === 'darwin') {
      await fs.mkdir(path.join(this.paths.home, 'logs'), { recursive: true });
      await fs.writeFile(this.unitFile, buildLaunchAgent(input), { mode: 0o644 });
      await this.launchctl(['bootout', this.agentTarget]).catch(() => undefined);
      await this.launchctl(['bootstrap', this.domain, this.unitFile]);
      return this.status();
    }
    await fs.writeFile(this.unitFile, buildUnit(input), { mode: 0o644 });
    await this.systemctl(['daemon-reload']);
    await this.systemctl(['enable', SERVICE_NAME]);
    await this.systemctl(['restart', SERVICE_NAME]);
    return this.status();
  }

  async uninstall(): Promise<ServiceStatus> {
    this.requireSupported();
    if (process.platform === 'darwin') {
      await this.launchctl(['bootout', this.agentTarget]).catch(() => undefined);
      await fs.rm(this.unitFile, { force: true });
      return this.status();
    }
    await this.systemctl(['disable', '--now', SERVICE_NAME]).catch(() => undefined);
    await fs.rm(this.unitFile, { force: true });
    await this.systemctl(['daemon-reload']);
    return this.status();
  }

  async status(): Promise<ServiceStatus> {
    if (!serviceSupported()) {
      return { supported: false, installed: false, active: false, unitFile: null };
    }
    const installed = await fs
      .access(this.unitFile)
      .then(() => true)
      .catch(() => false);
    const active = installed ? await this.isActive() : false;
    return { supported: true, installed, active, unitFile: this.unitFile };
  }

  private async isActive(): Promise<boolean> {
    if (process.platform === 'darwin') {
      return this.runner
        .run('launchctl', ['print', this.agentTarget], { timeoutMs: 10_000 })
        .then((result) => result.code === 0 && /state = running/.test(result.stdout))
        .catch(() => false);
    }
    return this.runner
      .run('systemctl', ['--user', 'is-active', SERVICE_NAME], { timeoutMs: 10_000 })
      .then((result) => result.stdout.trim() === 'active')
      .catch(() => false);
  }

  private get domain(): string {
    return `gui/${String(os.userInfo().uid)}`;
  }

  private get agentTarget(): string {
    return `${this.domain}/${AGENT_LABEL}`;
  }

  private requireSupported(): void {
    if (!serviceSupported()) {
      throw new AppError(
        'NOT_CONFIGURED',
        'o serviço automático existe no Linux e no Mac; no Windows, deixe um terminal aberto com cortes-eb queue run --live',
      );
    }
  }

  private async launchctl(args: string[]): Promise<void> {
    const result = await this.runner.run('launchctl', args, { timeoutMs: 30_000 });
    if (result.code !== 0) {
      const detail = (result.stderr.trim().split(/\r?\n/)[0] ?? '').slice(0, 200);
      throw new AppError('PROCESS_FAILED', `launchctl ${args[0] ?? ''} falhou: ${detail}`);
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

export function serviceSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux' || platform === 'darwin';
}
