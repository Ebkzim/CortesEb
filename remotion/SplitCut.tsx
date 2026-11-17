import type { ReactElement } from 'react';
import { AbsoluteFill } from 'remotion';
import type { SplitCutProps } from '../src/contracts/render';
import { BottomVideo } from './components/BottomVideo';
import { Captions, Divider } from './components/Captions';
import { ImageLayer, SoundLayer } from './components/Overlays';
import { SourceTrack, centerFocus } from './components/SourceTrack';
import { Watermark } from './components/Watermark';
import { colors, frame } from './theme';

export const SplitCut = (props: SplitCutProps): ReactElement => (
  <AbsoluteFill style={{ background: colors.background }}>
    <SourceTrack
      segments={props.segments}
      file={props.sourceFile}
      focus={props.focus}
      crop={props.crop}
      sourceWidth={props.sourceWidth}
      sourceHeight={props.sourceHeight}
      top={0}
      height={frame.topHeight}
      muted={false}
      punch
    />
    {props.bottomSource === null ? (
      <BottomVideo
        file={props.bottomFile}
        start={props.bottomStart}
        duration={props.bottomDuration}
      />
    ) : (
      <SourceTrack
        segments={props.segments}
        file={props.sourceFile}
        focus={centerFocus}
        crop={props.bottomSource.crop}
        sourceWidth={props.sourceWidth}
        sourceHeight={props.sourceHeight}
        top={frame.topHeight}
        height={frame.height - frame.topHeight}
        muted
        punch={false}
      />
    )}
    <ImageLayer images={props.images} />
    <Divider />
    <Captions pages={props.pages} />
    {props.watermark === null ? null : (
      <Watermark logo={props.watermark.logo} name={props.watermark.name} />
    )}
    <SoundLayer sounds={props.sfx} />
  </AbsoluteFill>
);
