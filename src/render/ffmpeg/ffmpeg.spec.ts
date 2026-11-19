import { describe, expect, it } from 'vitest';
import type { SplitCutProps } from '../../contracts/render.js';
import { assColor, assTime, buildAssCaptions, type AssStyle } from './ass-captions.js';
import {
  buildGraph,
  clampCrop,
  cover,
  escapeValue,
  scriptOption,
  type GraphFiles,
} from './filter-graph.js';
import { cellHeightRatio, measureWidth } from './text-metrics.js';

const style: AssStyle = {
  fontName: 'Montserrat Black',
  fontSize: 150,
  outline: 6,
  highlight: '#FFD400',
  base: '#FFFFFF',
  width: 1080,
  height: 1920,
  centerY: 960,
  sideMargin: 50,
  shadowY: 7,
  shadowAlpha: 0.35,
};

const files: GraphFiles = {
  assFile: 'c.ass',
  fontsDir: '/fonts',
  dividerFile: 'divider.png',
  watermark: null,
  hasAudio: true,
};

const props = (patch: Partial<SplitCutProps> = {}): SplitCutProps => ({
  totalSeconds: 6,
  segments: [
    { from: 10, to: 12.5, turn: false },
    { from: 12.5, to: 16, turn: true },
  ],
  sourceFile: 'source.mp4',
  bottomFile: 'bottom.mp4',
  bottomSource: null,
  bottomStart: 8,
  bottomDuration: 100,
  focus: { x: 50, y: 35 },
  crop: null,
  sourceWidth: 1920,
  sourceHeight: 1080,
  pages: [],
  watermark: null,
  sfx: [],
  images: [],
  ...patch,
});

describe('assColor and assTime', () => {
  it('converts rgb hex to the ass bgr order', () => {
    expect(assColor('#FFD400')).toBe('&H00D4FF&');
    expect(assColor('#102030')).toBe('&H302010&');
  });

  it('formats centiseconds', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(61_230)).toBe('0:01:01.23');
    expect(assTime(3_600_000)).toBe('1:00:00.00');
    expect(assTime(-5)).toBe('0:00:00.00');
  });
});

describe('buildAssCaptions', () => {
  const pages = [
    {
      startMs: 0,
      endMs: 1000,
      words: [
        { text: 'MAPA', startMs: 0, endMs: 400 },
        { text: 'NOVO', startMs: 500, endMs: 900 },
      ],
    },
  ];

  it('highlights the spoken word and keeps the page visible between words', () => {
    const ass = buildAssCaptions(pages, style);
    const events = ass.split('\n').filter((line) => line.startsWith('Dialogue'));
    expect(events).toHaveLength(4);
    expect(events[0]).toContain('{\\c&H00D4FF&}MAPA{\\c&HFFFFFF&} NOVO');
    expect(events[1]).toContain('}MAPA NOVO');
    expect(events[1]).not.toContain('{\\c&H00D4FF&}');
    expect(events[2]).toContain('MAPA {\\c&H00D4FF&}NOVO');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('Style: Cap,Montserrat Black,150,');
  });

  it('strips characters that libass would read as override codes', () => {
    const ass = buildAssCaptions(
      [{ startMs: 0, endMs: 500, words: [{ text: '{\\an1}oi\\N', startMs: 0, endMs: 400 }] }],
      style,
    );
    const event = ass.split('\n').find((line) => line.startsWith('Dialogue')) ?? '';
    expect(event).toContain('an1oiN');
    expect(event.split('}').filter((part) => part.includes('an1'))).toHaveLength(1);
  });

  it('writes nothing for an empty page list', () => {
    expect(buildAssCaptions([], style)).not.toContain('Dialogue');
  });
});

describe('buildGraph', () => {
  it('builds trims, zoom, concat and the final mapping', () => {
    const plan = buildGraph(props(), files);
    expect(plan.video).toBe('vout');
    expect(plan.audio).toBe('aout');
    expect(plan.inputs.slice(0, 6)).toEqual(['-ss', '10.000', '-t', '6.000', '-i', 'source.mp4']);
    expect(plan.script).toContain('trim=start=0.000:end=2.500');
    expect(plan.script).toContain('trim=start=2.500:end=6.000');
    expect(plan.script).toContain('concat=n=2:v=1:a=1[topcat][acat]');
    expect(plan.script).toContain('setsar=1[tv0]');
    expect(plan.script).toContain('eval=frame');
    expect(plan.script).toContain('vstack=inputs=2');
    expect(plan.script).toContain('ass=c.ass:fontsdir=/fonts');
    expect(plan.script).toContain('[vout]');
  });

  it('flashes only on turn segments', () => {
    const plan = buildGraph(props(), files);
    const flashes = plan.script.match(/eq=brightness/g) ?? [];
    expect(flashes).toHaveLength(1);
    expect(plan.script).toContain('between(t,2.5000,2.6667)');
  });

  it('uses the same source for the bottom half when asked and adds a second video stream', () => {
    const plan = buildGraph(
      props({ bottomSource: { crop: { x: 360, y: 0, w: 1215, h: 1080 } } }),
      files,
    );
    expect(plan.inputs).not.toContain('bottom.mp4');
    expect(plan.script).toContain('split=2[srcT][srcB]');
    expect(plan.script).toContain('crop=1215:1080:360:0');
    expect(plan.script).toContain('concat=n=2:v=2:a=1[topcat][botcat][acat]');
    expect(plan.script).toContain('[botcat]null[bot]');
  });

  it('loops the bottom video from its start point', () => {
    const plan = buildGraph(props(), files);
    const text = plan.inputs.join(' ');
    expect(text).toContain('-stream_loop -1 -ss 8.000 -t 6.000 -i bottom.mp4');
  });

  it('mixes sound effects with a delay and a volume', () => {
    const plan = buildGraph(
      props({ sfx: [{ file: 'sfx-whoosh.mp3', at: 2.42, volume: 0.27 }] }),
      files,
    );
    expect(plan.script).toContain('volume=0.270,adelay=2420:all=1[sf0]');
    expect(plan.script).toContain('amix=inputs=2:normalize=0:duration=first');
  });

  it('overlays images in time and the watermark at the right edge', () => {
    const plan = buildGraph(props({ images: [{ file: 'img.png', at: 1.5, dur: 2 }] }), {
      ...files,
      watermark: { file: 'wm.png', width: 300 },
    });
    expect(plan.script).toContain('setpts=PTS+1.500/TB[img0]');
    expect(plan.script).toContain('overlay=x=740:y=150');
    expect(plan.script).toContain('[cap]');
  });

  it('works without source audio by using a silent track', () => {
    const plan = buildGraph(props(), { ...files, hasAudio: false });
    expect(plan.inputs.join(' ')).toContain('anullsrc');
    expect(plan.script).toContain('concat=n=2:v=1:a=0[topcat]');
    expect(plan.script).toContain('[sil]anull[aout]');
  });

  it('rejects a clip without segments', () => {
    expect(() => buildGraph(props({ segments: [] }), files)).toThrow();
  });
});

describe('cover and crop helpers', () => {
  it('centres by focus when there is no crop', () => {
    expect(cover(null, { x: 50, y: 35 }, props())).toContain("'(ih-960)*0.3500'");
  });

  it('keeps the crop inside the frame', () => {
    expect(clampCrop({ x: 1900, y: 1000, w: 500, h: 500 }, 1920, 1080)).toEqual({
      x: 1420,
      y: 580,
      w: 500,
      h: 500,
    });
    expect(clampCrop({ x: -5, y: 0, w: 0, h: 0 }, 1920, 1080)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('escapes characters that break filter values', () => {
    expect(escapeValue("C:\\Users\\a'b")).toBe("C\\\\:/Users/a\\\\\\'b");
    expect(escapeValue('/home/x/fonts')).toBe('/home/x/fonts');
    expect(escapeValue('/a,b[c];d')).toBe('/a\\,b\\[c\\]\\;d');
  });

  it('picks the filter script option by ffmpeg version', () => {
    expect(scriptOption('ffmpeg version 6.1.1-3ubuntu5 Copyright')).toBe('-filter_complex_script');
    expect(scriptOption('ffmpeg version n6.0 Copyright')).toBe('-filter_complex_script');
    expect(scriptOption('ffmpeg version 7.1 Copyright')).toBe('-/filter_complex');
    expect(scriptOption('ffmpeg version 9.0.2-full_build-www.gyan.dev')).toBe('-/filter_complex');
    expect(scriptOption('ffmpeg version N-118000-gabc Copyright')).toBe('-/filter_complex');
    expect(scriptOption('')).toBe('-/filter_complex');
  });
});

describe('credit line', () => {
  const credit = { text: 'Live de @canal', totalMs: 12_000, fontSize: 50, bottomY: 1860 };

  it('adds a credit style and one dialogue for the whole clip', () => {
    const ass = buildAssCaptions([], style, credit);
    expect(ass).toContain('Style: Credit,');
    const events = ass.split('\n').filter((line) => line.startsWith('Dialogue'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('0:00:00.00,0:00:12.00,Credit');
    expect(events[0]).toContain('\\pos(540,1860)');
    expect(events[0]).toContain('Live de @canal');
  });

  it('strips override characters from the credit', () => {
    const ass = buildAssCaptions([], style, { ...credit, text: '{\\an1}x\\N' });
    const event = ass.split('\n').find((line) => line.startsWith('Dialogue')) ?? '';
    expect(event.endsWith('an1xN')).toBe(true);
  });

  it('keeps captions unchanged without a credit', () => {
    expect(buildAssCaptions([], style)).not.toContain('Credit');
  });
});

describe('text metrics', () => {
  const font = 'assets/fonts/Montserrat-Black.ttf';

  it('measures text with the bundled font', () => {
    expect(measureWidth(font, 'Teste', 80)).toBeCloseTo(238.8, 1);
    expect(cellHeightRatio(font)).toBeCloseTo(1.562, 3);
  });
});
