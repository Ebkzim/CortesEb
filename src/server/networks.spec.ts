import { describe, expect, it, vi } from 'vitest';
import type { AccountService } from '../accounts/account.service.js';
import type { BrowserSessions } from '../browser/browser-sessions.js';
import type { LoginWindows } from '../browser/login-windows.js';
import type { UserConfigStore } from '../config/user-config.js';
import type { CredentialVault } from '../publish/credential-vault.js';
import type { QueueStore } from '../publish/queue-store.js';
import { NetworksController } from './networks.controller.js';

function setup(): {
  controller: NetworksController;
  forget: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const accounts = { list: () => Promise.resolve([{ id: 'canal', name: 'Canal' }]) };
  const forget = vi.fn(() => Promise.resolve());
  const sessions = {
    profiles: () =>
      Promise.resolve([
        {
          account: 'canal',
          platform: 'instagram',
          connected: true,
          handle: 'canal',
          url: 'https://www.instagram.com/canal/',
          connectedAt: '2026-11-21T12:00:00Z',
        },
      ]),
    forget,
  };
  const remove = vi.fn(() => Promise.resolve(true));
  const vault = { list: () => Promise.resolve([]), remove };
  const config = {
    load: () =>
      Promise.resolve({
        publishing: { instagram: 'api', youtube: 'browser', youtubeVisibility: 'public' },
      }),
  };
  return {
    controller: new NetworksController(
      accounts as unknown as AccountService,
      sessions as unknown as BrowserSessions,
      vault as unknown as CredentialVault,
      config as unknown as UserConfigStore,
      { list: () => [] } as unknown as LoginWindows,
      { list: () => Promise.resolve([]) } as unknown as QueueStore,
    ),
    forget,
    remove,
  };
}

describe('network browser sessions alongside API publishing', () => {
  it('reports browser login independently from publishing credentials', async () => {
    const { controller } = setup();
    const network = (await controller.overview()).accounts[0]?.networks.find(
      (item) => item.platform === 'instagram',
    );
    expect(network?.method).toBe('api');
    expect(network?.connected).toBe(false);
    expect(network?.browserConnected).toBe(true);
  });

  it('disconnects navigation without removing API publishing credentials', async () => {
    const { controller, forget, remove } = setup();
    await controller.disconnectBrowser('canal', 'instagram');
    expect(forget).toHaveBeenCalledWith('instagram', 'canal');
    expect(remove).not.toHaveBeenCalled();
  });
});
