import type { ReactElement } from 'react';
import { Loop, OffthreadVideo, staticFile, useVideoConfig } from 'remotion';
import { colors, frame } from '../theme';

type BottomVideoProps = {
  file: string;
  start: number;
  duration: number;
};

const MIN_LOOP_FRAMES = 30;
const LOOP_SAFETY_FRAMES = 2;

export const BottomVideo = ({ file, start, duration }: BottomVideoProps): ReactElement => {
  const { fps, durationInFrames } = useVideoConfig();
  const startFrame = Math.round(start * fps);
  const loopFrames =
    duration > 0
      ? Math.max(MIN_LOOP_FRAMES, Math.floor(duration * fps) - LOOP_SAFETY_FRAMES)
      : durationInFrames;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: frame.topHeight,
        width: frame.width,
        height: frame.height - frame.topHeight,
        overflow: 'hidden',
        background: colors.background,
      }}
    >
      <Loop durationInFrames={loopFrames}>
        <OffthreadVideo
          src={staticFile(file)}
          trimBefore={startFrame}
          durationInFrames={loopFrames}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Loop>
    </div>
  );
};
