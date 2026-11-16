import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { Crop, Focus } from '../../src/contracts/cuts';
import type { RenderSegment } from '../../src/contracts/render';
import { colors, frame, motion } from '../theme';

type TopVideoProps = {
  segments: RenderSegment[];
  file: string;
  focus: Focus;
  crop: Crop | null;
  sourceWidth: number;
  sourceHeight: number;
};

const punchScale = (index: number): number => {
  if (index === 0) return motion.firstPunch;
  return index % 2 === 1 ? motion.oddPunch : 1;
};

const Punch = ({ index, children }: { index: number; children: ReactNode }): ReactElement => {
  const current = useCurrentFrame();
  const scale = interpolate(current, [0, motion.punchFrames], [punchScale(index), 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out((value) => Easing.cubic(value)),
  });
  return <AbsoluteFill style={{ transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
};

const Flash = (): ReactElement => {
  const current = useCurrentFrame();
  const opacity = interpolate(current, [0, motion.flashFrames], [motion.flashOpacity, 0], {
    extrapolateRight: 'clamp',
  });
  return <AbsoluteFill style={{ background: colors.text, opacity }} />;
};

const videoStyle = (
  crop: Crop | null,
  sourceWidth: number,
  sourceHeight: number,
  focus: Focus,
): CSSProperties => {
  if (crop === null) {
    return {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition: `${focus.x}% ${focus.y}%`,
    };
  }
  const scale = Math.max(frame.width / crop.w, frame.topHeight / crop.h);
  return {
    position: 'absolute',
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    left: -crop.x * scale + (frame.width - crop.w * scale) / 2,
    top: -crop.y * scale + (frame.topHeight - crop.h * scale) / 2,
    objectFit: 'fill',
  };
};

export const TopVideo = (props: TopVideoProps): ReactElement => {
  const { fps } = useVideoConfig();
  const style = videoStyle(props.crop, props.sourceWidth, props.sourceHeight, props.focus);
  let offset = 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: frame.width,
        height: frame.topHeight,
        overflow: 'hidden',
        background: colors.background,
      }}
    >
      {props.segments.map((segment, index) => {
        const frames = Math.max(1, Math.round((segment.to - segment.from) * fps));
        const from = offset;
        offset += frames;
        return (
          <Sequence key={`${segment.from}-${index}`} from={from} durationInFrames={frames}>
            <Punch index={index}>
              <OffthreadVideo
                src={staticFile(props.file)}
                trimBefore={Math.round(segment.from * fps)}
                durationInFrames={frames}
                style={style}
              />
            </Punch>
            {segment.turn ? <Flash /> : null}
          </Sequence>
        );
      })}
    </div>
  );
};
