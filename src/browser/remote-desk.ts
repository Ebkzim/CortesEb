import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright-core';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { VIEWPORT, type BrowserPlatform } from './browser-sessions.js';

export const DESK_REASONS = ['captcha', 'login', 'verify'] as const;
export type DeskReason = (typeof DESK_REASONS)[number];

export interface DeskState {
  id: string;
  reason: DeskReason;
  platform: BrowserPlatform;
  account: string;
  message: string;
  since: string;
  width: number;
  height: number;
}

const ratio = z.number().min(0).max(1);
const SPECIAL_KEYS = [
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
] as const;

export const deskInputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.enum(['move', 'down', 'up']),
    x: ratio,
    y: ratio,
    button: z.enum(['left', 'right']).default('left'),
  }),
  z.strictObject({ type: z.literal('click'), x: ratio, y: ratio }),
  z.strictObject({
    type: z.literal('wheel'),
    dx: z.number().min(-2000).max(2000),
    dy: z.number().min(-2000).max(2000),
  }),
  z.strictObject({ type: z.literal('key'), key: z.enum(SPECIAL_KEYS) }),
  z.strictObject({ type: z.literal('text'), text: z.string().min(1).max(500) }),
]);

export type DeskInput = z.infer<typeof deskInputSchema>;

export interface HumanRequest {
  reason: DeskReason;
  platform: BrowserPlatform;
  account: string;
  message: string;
  solved: () => Promise<boolean>;
  timeoutMs: number;
  pollMs?: number;
}

export type Notifier = (title: string, body: string) => void;

@Injectable()
export class RemoteDesk {
  private page: Page | null = null;
  private current: DeskState | null = null;
  private cancelled = false;
  private notify: Notifier = desktopNotify;

  state(): DeskState | null {
    return this.current;
  }

  alert(title: string, body: string): void {
    this.notify(title, body);
  }

  useNotifier(notifier: Notifier): void {
    this.notify = notifier;
  }

  async request(page: Page, request: HumanRequest): Promise<boolean> {
    if (this.current !== null) {
      throw new AppError('PROCESS_FAILED', 'já existe uma verificação esperando você');
    }
    this.page = page;
    this.cancelled = false;
    this.current = {
      id: randomBytes(6).toString('hex'),
      reason: request.reason,
      platform: request.platform,
      account: request.account,
      message: request.message,
      since: new Date().toISOString(),
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    };
    this.notify('CortesEb precisa de você', request.message);
    const deadline = Date.now() + request.timeoutMs;
    try {
      while (Date.now() < deadline && !this.wasCancelled()) {
        if (await request.solved().catch(() => false)) return true;
        await new Promise((resolve) => setTimeout(resolve, request.pollMs ?? 1500));
      }
      return false;
    } finally {
      this.current = null;
      this.page = null;
    }
  }

  private wasCancelled(): boolean {
    return this.cancelled;
  }

  cancel(): boolean {
    if (this.current === null) return false;
    this.cancelled = true;
    return true;
  }

  async frame(): Promise<Buffer> {
    const page = this.requirePage();
    return page.screenshot({ type: 'jpeg', quality: 60, timeout: 10_000 });
  }

  async input(raw: unknown): Promise<void> {
    const parsed = deskInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'comando de tela inválido');
    const page = this.requirePage();
    const event = parsed.data;
    const size = page.viewportSize() ?? VIEWPORT;
    const at = (x: number, y: number): [number, number] => [x * size.width, y * size.height];
    switch (event.type) {
      case 'move':
        await page.mouse.move(...at(event.x, event.y), { steps: 1 });
        return;
      case 'down':
        await page.mouse.move(...at(event.x, event.y));
        await page.mouse.down({ button: event.button });
        return;
      case 'up':
        await page.mouse.move(...at(event.x, event.y));
        await page.mouse.up({ button: event.button });
        return;
      case 'click':
        await page.mouse.click(...at(event.x, event.y));
        return;
      case 'wheel':
        await page.mouse.wheel(event.dx, event.dy);
        return;
      case 'key':
        await page.keyboard.press(event.key);
        return;
      case 'text':
        await page.keyboard.type(event.text);
    }
  }

  private requirePage(): Page {
    if (this.page === null || this.current === null) {
      throw new AppError('INVALID_INPUT', 'nenhuma verificação esperando agora');
    }
    return this.page;
  }
}

export function desktopNotify(title: string, body: string): void {
  if (process.platform !== 'linux') return;
  try {
    const child = spawn('notify-send', ['-a', 'CortesEb', '-u', 'critical', title, body], {
      stdio: 'ignore',
      shell: false,
      detached: true,
    });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    return;
  }
}
