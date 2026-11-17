import { describe, expect, it } from 'vitest';
import { sniffImage } from '../images/image-sniffer.js';
import { planSounds } from '../render/sound-plan.js';
import { placeShots } from '../timeline/spans.js';
import { dropLoops, dropMarkers, mergeTokens } from '../transcription/tokens.js';
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

describe('dropMarkers', () => {
  const word = (text: string, index: number): { text: string; startMs: number; endMs: number } => ({
    text,
    startMs: index * 100,
    endMs: index * 100 + 90,
  });
  const texts = (list: { text: string }[]): string[] => list.map((item) => item.text);

  it('removes bracketed markers split across words and lone dashes', () => {
    const input = [
      'Olha',
      '[MÚSICA',
      'DE',
      'FUNDO]',
      'isso',
      '[Música]',
      '-',
      'tá',
      '—',
      'bom',
    ].map(word);
    expect(texts(dropMarkers(input))).toEqual(['Olha', 'isso', 'tá', 'bom']);
  });

  it('never swallows speech after an unclosed bracket', () => {
    const input = ['[MÚSICA', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(word);
    expect(texts(dropMarkers(input))).toEqual(['f', 'g', 'h']);
  });
});

describe('dropLoops', () => {
  const words = (text: string): { text: string; startMs: number; endMs: number }[] =>
    text
      .split(' ')
      .map((item, index) => ({ text: item, startMs: index * 100, endMs: index * 100 + 90 }));
  const text = (list: { text: string }[]): string => list.map((item) => item.text).join(' ');

  it('keeps one copy of a phrase repeated in a loop', () => {
    const looped = words(
      'Olha isso. Eu tô perdido, eu tô perdido, eu tô perdido, eu tô perdido no trailer.',
    );
    expect(text(dropLoops(looped))).toBe('Olha isso. Eu tô perdido, no trailer.');
  });

  it('keeps short natural repetition and removes long runs of it', () => {
    expect(text(dropLoops(words('não, não, não, não. Vamo, vamo!')))).toBe(
      'não, não, não, não. Vamo, vamo!',
    );
    expect(text(dropLoops(words('ei ei ei ei ei ei ei fim')))).toBe('ei fim');
  });

  it('leaves normal speech untouched', () => {
    const speech = words('O mapa novo é a soma de três mapas e isso muda tudo no jogo.');
    expect(dropLoops(speech)).toEqual(speech);
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
