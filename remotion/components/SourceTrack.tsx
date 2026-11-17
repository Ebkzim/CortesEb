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

type SourceTrackProps = {
  segments: RenderSegment[];
  file: string;
  focus: Focus;
  crop: Crop | null;
  sourceWidth: number;
  sourceHeight: number;
  top: number;
  height: number;
  muted: boolean;
  punch: boolean;
};

const CENTER: Focus = { x: 50, y: 50 };

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

const videoStyle = (props: SourceTrackProps): CSSProperties => {
  const { crop } = props;
  if (crop === null) {
    return {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition: `${props.focus.x}% ${props.focus.y}%`,
    };
  }
  const scale = Math.max(frame.width / crop.w, props.height / crop.h);
  return {
    position: 'absolute',
    width: props.sourceWidth * scale,
    height: props.sourceHeight * scale,
    left: -crop.x * scale + (frame.width - crop.w * scale) / 2,
    top: -crop.y * scale + (props.height - crop.h * scale) / 2,
    objectFit: 'fill',
  };
};

export const SourceTrack = (props: SourceTrackProps): ReactElement => {
  const { fps } = useVideoConfig();
  const style = videoStyle(props);
  let offset = 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: props.top,
        width: frame.width,
        height: props.height,
        overflow: 'hidden',
        background: colors.background,
      }}
    >
      {props.segments.map((segment, index) => {
        const frames = Math.max(1, Math.round((segment.to - segment.from) * fps));
        const from = offset;
        offset += frames;
        const video = (
          <OffthreadVideo
            src={staticFile(props.file)}
            trimBefore={Math.round(segment.from * fps)}
            durationInFrames={frames}
            muted={props.muted}
            style={style}
          />
        );
        return (
          <Sequence key={`${segment.from}-${index}`} from={from} durationInFrames={frames}>
            {props.punch ? <Punch index={index}>{video}</Punch> : video}
            {segment.turn ? <Flash /> : null}
          </Sequence>
        );
      })}
    </div>
  );
};

export const centerFocus = CENTER;
