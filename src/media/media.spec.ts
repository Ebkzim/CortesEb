import { describe, expect, it } from 'vitest';
import { sniffImage } from '../images/image-sniffer.js';
import { planSounds } from '../render/sound-plan.js';
import { placeShots } from '../timeline/spans.js';
import { mergeTokens } from '../transcription/tokens.js';
import { parseSilences } from './silence-parser.js';

describe('parseSilences', () => {
  it('pairs starts and ends from the ffmpeg log', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: 4.5',
      '[silencedetect @ 0x1] silence_end: 6.4 | silence_duration: 1.9',
      'frame=  100',
      '[silencedetect @ 0x1] silence_start: 10.25',
      '[silencedetect @ 0x1] silence_end: 12 | silence_duration: 1.75',
    ].join('\n');
    expect(parseSilences(log, 30)).toEqual([
      { start: 4.5, end: 6.4 },
      { start: 10.25, end: 12 },
    ]);
  });

  it('closes a trailing silence at the total duration and clamps negatives', () => {
    const log = 'silence_start: -0.01\nsilence_end: 1\nsilence_start: 28';
    expect(parseSilences(log, 30)).toEqual([
      { start: 0, end: 1 },
      { start: 28, end: 30 },
    ]);
  });

  it('returns nothing for a log without silences', () => {
    expect(parseSilences('size=N/A time=00:00:10', 10)).toEqual([]);
  });
});

describe('mergeTokens', () => {
  it('joins sub-word tokens and drops markers', () => {
    const words = mergeTokens([
      { text: '[_BEG_]', startMs: 0, endMs: 0 },
      { text: ' Leo', startMs: 100, endMs: 200 },
      { text: 'nida', startMs: 200, endMs: 350 },
      { text: ',', startMs: 350, endMs: 360 },
      { text: ' mapa', startMs: 400, endMs: 600 },
      { text: '  ', startMs: 600, endMs: 610 },
      { text: ' [MUSIC]', startMs: 610, endMs: 700 },
    ]);
    expect(words).toEqual([
      { text: 'Leonida,', startMs: 100, endMs: 360 },
      { text: 'mapa', startMs: 400, endMs: 600 },
    ]);
  });
});

describe('sniffImage', () => {
  it('detects formats by signature', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = new TextEncoder().encode('RIFF0000WEBPVP8 ');
    expect(sniffImage(png)).toBe('.png');
    expect(sniffImage(jpg)).toBe('.jpg');
    expect(sniffImage(webp)).toBe('.webp');
  });

  it('rejects anything else', () => {
    expect(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('RIFF0000WAVEfmt '))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('planSounds', () => {
  const placed = placeShots(
    [
      { from: 0, to: 2, turn: false },
      { from: 2, to: 4, turn: true },
      { from: 4, to: 6, turn: false },
    ],
    30,
  );

  it('places impact at zero, whoosh on turns and pop on images', () => {
    const sounds = planSounds(placed, [3, 0.01], { impact: 'i', whoosh: 'w', pop: 'p' }, 0.6);
    expect(sounds).toEqual([
      { file: 'i', at: 0, volume: 0.3 },
      { file: 'w', at: 1.92, volume: 0.27 },
      { file: 'p', at: 2.95, volume: 0.27 },
      { file: 'p', at: 0, volume: 0.27 },
    ]);
  });

  it('skips sounds that are not staged', () => {
    expect(planSounds(placed, [3], {}, 1)).toEqual([]);
    expect(planSounds(placed, [3], { pop: 'p' }, 1)).toHaveLength(1);
  });
});
