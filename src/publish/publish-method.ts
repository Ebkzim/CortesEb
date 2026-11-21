import type { Publishing, PublishMethod } from '../config/user-config.js';
import { PLATFORMS, type Platform } from '../contracts/publish.js';

export function methodOf(publishing: Publishing, platform: Platform): PublishMethod {
  return platform === 'tiktok' ? 'browser' : publishing[platform];
}

export function methodsOf(publishing: Publishing): Record<Platform, PublishMethod> {
  return Object.fromEntries(
    PLATFORMS.map((platform) => [platform, methodOf(publishing, platform)]),
  ) as Record<Platform, PublishMethod>;
}
