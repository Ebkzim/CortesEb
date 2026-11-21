import { Injectable } from '@nestjs/common';
import { BrowserSessions } from '../browser/browser-sessions.js';
import { DeskServer } from '../browser/desk-server.js';
import { SiteSession } from '../browser/sites.js';
import { AppPaths } from '../config/app-paths.js';

@Injectable()
export class BrowserTools {
  constructor(
    readonly paths: AppPaths,
    readonly sessions: BrowserSessions,
    readonly site: SiteSession,
    readonly server: DeskServer,
  ) {}
}
