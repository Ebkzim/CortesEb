import fs from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { UserConfigStore } from '../config/user-config.js';
import { layoutSchema, type Layout } from '../contracts/layout.js';
import type { Workspace } from '../workspace/workspace.js';
import { parseCamera } from './camera.js';
import { mergeLayouts, NO_CAMERA } from './layout.js';

export interface LayoutView {
  workspace: Layout | null;
  default: Layout;
  effective: Layout;
}

@Injectable()
export class LayoutService {
  constructor(private readonly config: UserConfigStore) {}

  async view(workspace: Workspace | null): Promise<LayoutView> {
    const saved = (await this.config.load()).layout;
    const local = workspace === null ? null : await this.read(workspace);
    return { workspace: local, default: saved, effective: mergeLayouts(local, saved) };
  }

  async effective(workspace: Workspace): Promise<Layout> {
    return (await this.view(workspace)).effective;
  }

  async saveForWorkspace(workspace: Workspace, patch: Layout): Promise<LayoutView> {
    const next = layoutSchema.parse(
      validated({ ...((await this.read(workspace)) ?? {}), ...patch }),
    );
    await writeJson(workspace.layout, next);
    return this.view(workspace);
  }

  async saveDefault(patch: Layout): Promise<LayoutView> {
    const current = (await this.config.load()).layout;
    const next = layoutSchema.parse(validated({ ...current, ...patch }));
    await this.config.update({ layout: next });
    return this.view(null);
  }

  async clearWorkspace(workspace: Workspace): Promise<LayoutView> {
    await fs.rm(workspace.layout, { force: true });
    return this.view(workspace);
  }

  async clearDefault(): Promise<LayoutView> {
    await this.config.update({ layout: {} });
    return this.view(null);
  }

  private async read(workspace: Workspace): Promise<Layout | null> {
    return (await exists(workspace.layout)) ? readJson(workspace.layout, layoutSchema) : null;
  }
}

function validated(layout: Layout): Layout {
  if (layout.camera !== undefined && layout.camera !== NO_CAMERA) {
    parseCamera(layout.camera, layout.cameraSize ?? 40);
  }
  return layout;
}
