import type { ReactElement } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionPage } from '../../src/contracts/render';
import { fontFamily } from '../font';
import { captionStyle, colors, dividerStyle, frame } from '../theme';

export const Divider = (): ReactElement => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      width: frame.width,
      top: frame.topHeight - dividerStyle.height / 2,
      height: dividerStyle.height,
      background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.62) 50%, rgba(0,0,0,0))',
    }}
  />
);

export const Captions = ({ pages }: { pages: CaptionPage[] }): ReactElement | null => {
  const current = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (current / fps) * 1000;
  const page = pages.find((item) => ms >= item.startMs && ms < item.endMs);
  if (page === undefined) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: captionStyle.sideMargin,
        width: frame.width - captionStyle.sideMargin * 2,
        top: frame.topHeight,
        transform: 'translateY(-50%)',
        textAlign: 'center',
        fontFamily,
        fontWeight: 900,
        fontSize: captionStyle.fontSize,
        lineHeight: captionStyle.lineHeight,
        textTransform: 'uppercase',
        color: colors.text,
        WebkitTextStroke: `${captionStyle.strokeWidth}px ${colors.stroke}`,
        paintOrder: 'stroke fill',
        textShadow: '0 7px 0 rgba(0,0,0,0.35)',
      }}
    >
      {page.words.map((word, index) => {
        const active = ms >= word.startMs && ms < word.endMs;
        return (
          <span
            key={`${word.startMs}-${index}`}
            style={{
              color: active ? colors.highlight : colors.text,
              display: 'inline-block',
              margin: `0 ${captionStyle.wordGap}px`,
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
