import type { ReactElement } from 'react';
import { AbsoluteFill } from 'remotion';
import type { SplitCutProps } from '../src/contracts/render';
import { BottomVideo } from './components/BottomVideo';
import { Captions, Divider } from './components/Captions';
import { ImageLayer, SoundLayer } from './components/Overlays';
import { TopVideo } from './components/TopVideo';
import { Watermark } from './components/Watermark';
import { colors } from './theme';

export const SplitCut = (props: SplitCutProps): ReactElement => (
  <AbsoluteFill style={{ background: colors.background }}>
    <TopVideo
      segments={props.segments}
      file={props.sourceFile}
      focus={props.focus}
      crop={props.crop}
      sourceWidth={props.sourceWidth}
      sourceHeight={props.sourceHeight}
    />
    <BottomVideo
      file={props.bottomFile}
      start={props.bottomStart}
      duration={props.bottomDuration}
    />
    <ImageLayer images={props.images} />
    <Divider />
    <Captions pages={props.pages} />
    <Watermark logo={props.watermark.logo} name={props.watermark.name} />
    <SoundLayer sounds={props.sfx} />
  </AbsoluteFill>
);
