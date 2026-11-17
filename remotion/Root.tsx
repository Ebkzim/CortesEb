import type { ReactElement } from 'react';
import { Composition } from 'remotion';
import {
  RENDER_FPS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  SPLIT_CUT_COMPOSITION,
  type SplitCutProps,
} from '../src/contracts/render';
import { SplitCut } from './SplitCut';

const previewProps: SplitCutProps = {
  totalSeconds: 5,
  segments: [{ from: 0, to: 5, turn: false }],
  sourceFile: 'source.mp4',
  bottomFile: 'bottom.mp4',
  bottomSource: null,
  bottomStart: 0,
  bottomDuration: 0,
  focus: { x: 50, y: 35 },
  crop: null,
  sourceWidth: 1280,
  sourceHeight: 720,
  pages: [],
  watermark: null,
  sfx: [],
  images: [],
};

export const Root = (): ReactElement => (
  <Composition
    id={SPLIT_CUT_COMPOSITION}
    component={SplitCut}
    width={RENDER_WIDTH}
    height={RENDER_HEIGHT}
    fps={RENDER_FPS}
    durationInFrames={RENDER_FPS * 5}
    defaultProps={previewProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.round(props.totalSeconds * RENDER_FPS)),
      fps: RENDER_FPS,
    })}
  />
);
