import type { ReactElement } from 'react';
import { Img, staticFile } from 'remotion';
import type { RenderWatermark } from '../../src/contracts/render';
import { fontFamily } from '../font';
import { colors, watermarkStyle } from '../theme';

export const Watermark = ({ logo, name }: RenderWatermark): ReactElement => (
  <div
    style={{
      position: 'absolute',
      top: watermarkStyle.top,
      right: watermarkStyle.right,
      display: 'flex',
      alignItems: 'center',
      gap: watermarkStyle.gap,
    }}
  >
    {logo === null ? null : (
      <Img
        src={staticFile(logo)}
        style={{
          width: watermarkStyle.logoSize,
          height: watermarkStyle.logoSize,
          borderRadius: '50%',
          objectFit: 'cover',
          border: `4px solid ${colors.text}`,
          boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        }}
      />
    )}
    {name === null ? null : (
      <span
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: watermarkStyle.fontSize,
          textTransform: 'uppercase',
          color: colors.text,
          WebkitTextStroke: `7px ${colors.watermarkStroke}`,
          paintOrder: 'stroke fill',
          textShadow: `0 4px 0 ${colors.watermarkShadow}`,
        }}
      >
        {name}
      </span>
    )}
  </div>
);
