import { Module } from '@nestjs/common';
import { BrowserSessions } from './browser-sessions.js';
import { DeskClient } from './desk-client.js';
import { DeskServer } from './desk-server.js';
import { LoginWindows } from './login-windows.js';
import { RemoteDesk } from './remote-desk.js';
import { TikTokSession } from './tiktok.js';

@Module({
  providers: [BrowserSessions, RemoteDesk, TikTokSession, DeskServer, DeskClient, LoginWindows],
  exports: [BrowserSessions, RemoteDesk, TikTokSession, DeskServer, DeskClient, LoginWindows],
})
export class BrowserModule {}
