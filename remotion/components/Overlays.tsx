import type { ReactElement } from 'react';
import {
  Easing,
  Html5Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { RenderImage, RenderSound } from '../../src/contracts/render';
import { colors, frame, motion, popStyle } from '../theme';

const PopImage = ({ file, frames }: { file: string; frames: number }): ReactElement => {
  const current = useCurrentFrame();
  const enter = interpolate(current, [0, motion.popInFrames], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.back(1.6)),
  });
  const leave = interpolate(current, [frames - motion.popOutFrames, frames], [1, 0], {
    extrapolateLeft: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        width: frame.width,
        top: frame.topHeight + popStyle.inset,
        height: frame.height - frame.topHeight - popStyle.inset * 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: Math.max(0, Math.min(enter, leave)),
        transform: `scale(${0.9 + 0.1 * enter})`,
      }}
    >
      <Img
        src={staticFile(file)}
        style={{
          maxWidth: popStyle.maxWidth,
          maxHeight: popStyle.maxHeight,
          objectFit: 'contain',
          borderRadius: 26,
          border: `5px solid ${colors.text}`,
          boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
        }}
      />
    </div>
  );
};

export const ImageLayer = ({ images }: { images: RenderImage[] }): ReactElement => {
  const { fps } = useVideoConfig();
  return (
    <>
      {images.map((image, index) => {
        const frames = Math.max(motion.minPopFrames, Math.round(image.dur * fps));
        return (
          <Sequence
            key={`${image.file}-${index}`}
            from={Math.round(image.at * fps)}
            durationInFrames={frames}
          >
            <PopImage file={image.file} frames={frames} />
          </Sequence>
        );
      })}
    </>
  );
};

export const SoundLayer = ({ sounds }: { sounds: RenderSound[] }): ReactElement => {
  const { fps } = useVideoConfig();
  return (
    <>
      {sounds.map((sound, index) => (
        <Sequence
          key={`${sound.file}-${index}`}
          from={Math.max(0, Math.round(sound.at * fps))}
          durationInFrames={Math.round(motion.soundSeconds * fps)}
        >
          <Html5Audio src={staticFile(sound.file)} volume={sound.volume} />
        </Sequence>
      ))}
    </>
  );
};
