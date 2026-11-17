import type { SplitCutProps } from '../contracts/render.js';

export const ENGINE_NAMES = ['fast', 'remotion'] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export interface RenderSession {
  serveUrl: string;
  dispose: () => Promise<void>;
}

export interface RenderEngine {
  open(publicDir: string): Promise<RenderSession>;
  render(
    session: RenderSession,
    props: SplitCutProps,
    output: string,
    onProgress?: (fraction: number) => void,
  ): Promise<void>;
}
