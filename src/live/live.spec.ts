import { describe, expect, it } from 'vitest';
import type { Word } from '../contracts/media.js';
import { buildLiveClip } from './clip-cut.js';
import { LiveDetector, type LiveWindow } from './live-detector.js';
import { recorderArgs } from './live-recorder.js';
import { RmsStreamParser } from './rms-stream.js';
import { coveredUntil, parseSegmentList, segmentsCovering } from './segment-log.js';

function feed(detector: LiveDetector, from: number, to: number, level: number): LiveWindow[] {
  const found: LiveWindow[] = [];
  for (let second = from; second < to; second += 1) found.push(...detector.push(second, level));
  return found;
}

describe('LiveDetector', () => {
  it('emits one window after a loud burst once the tail has passed', () => {
    const detector = new LiveDetector();
    expect(feed(detector, 0, 100, -30)).toEqual([]);
    expect(feed(detector, 100, 106, -14)).toEqual([]);
    const windows = feed(detector, 106, 140, -30);
    expect(windows).toHaveLength(1);
    const [window] = windows;
    expect(window?.peakAt).toBeGreaterThanOrEqual(100);
    expect(window?.peakAt).toBeLessThan(106);
    expect(window?.start).toBeGreaterThanOrEqual(88);
    expect(window?.end).toBeGreaterThan(113);
    expect((window?.end ?? 0) - (window?.start ?? 0)).toBeGreaterThanOrEqual(20);
  });

  it('stays silent during warmup and on steady volume', () => {
    const detector = new LiveDetector();
    expect(feed(detector, 0, 20, -10)).toEqual([]);
    expect(feed(detector, 20, 300, -25)).toEqual([]);
  });

  it('merges bursts that are close together into one window', () => {
    const detector = new LiveDetector();
    feed(detector, 0, 100, -30);
    feed(detector, 100, 103, -14);
    feed(detector, 103, 106, -30);
    feed(detector, 106, 109, -14);
    const windows = feed(detector, 109, 150, -30);
    expect(windows).toHaveLength(1);
  });

  it('keeps consecutive windows from overlapping', () => {
    const detector = new LiveDetector();
    feed(detector, 0, 100, -30);
    feed(detector, 100, 104, -14);
    const first = feed(detector, 104, 125, -30);
    feed(detector, 125, 128, -14);
    const second = feed(detector, 128, 160, -30);
    expect(first).toHaveLength(1);
    expect(second.length).toBeLessThanOrEqual(1);
    if (second[0] !== undefined && first[0] !== undefined) {
      expect(second[0].start).toBeGreaterThanOrEqual(first[0].end);
    }
  });

  it('flushes an open event when the stream ends', () => {
    const detector = new LiveDetector();
    feed(detector, 0, 100, -30);
    feed(detector, 100, 106, -14);
    expect(detector.flush()).toHaveLength(1);
    expect(detector.flush()).toEqual([]);
  });

  it('caps a long event at the maximum length', () => {
    const detector = new LiveDetector({ maxSeconds: 40 });
    feed(detector, 0, 100, -30);
    feed(detector, 100, 190, -12);
    const windows = feed(detector, 190, 230, -30);
    const [window] = windows;
    expect((window?.end ?? 0) - (window?.start ?? 0)).toBeLessThanOrEqual(40);
  });
});

describe('RmsStreamParser', () => {
  it('pairs timestamps with levels across split chunks', () => {
    const parser = new RmsStreamParser();
    const first = parser.push(
      '[Parsed_ametadata_3 @ 0x1] frame:0    pts:0       pts_time:0\n[Parsed_ametadata_3 @ 0x1] lavfi.astats.Overall.RMS_le',
    );
    expect(first).toEqual([]);
    const second = parser.push(
      'vel=-18.5\n[x] frame:1 pts:16000 pts_time:1\n[x] lavfi.astats.Overall.RMS_level=-inf\n',
    );
    expect(second).toEqual([
      { time: 0, level: -18.5 },
      { time: 1, level: -90 },
    ]);
  });

  it('ignores unrelated lines', () => {
    const parser = new RmsStreamParser();
    expect(parser.push("[hls @ 0x1] Opening 'x.ts' for reading\nsize=N/A\r")).toEqual([]);
  });
});

describe('segment list', () => {
  const text =
    'e0-000000.ts,0.000000,6.066667\ne0-000001.ts,6.066667,9.066667\nlixo\n../x.ts,1,2\n';

  it('parses valid rows and offsets them', () => {
    const segments = parseSegmentList(text, 100);
    expect(segments).toHaveLength(2);
    expect(segments[1]).toEqual({ file: 'e0-000001.ts', start: 106.066667, end: 109.066667 });
  });

  it('selects the segments that overlap a range', () => {
    const segments = parseSegmentList(text);
    expect(segmentsCovering(segments, 7, 8).map((item) => item.file)).toEqual(['e0-000001.ts']);
    expect(coveredUntil(segments)).toBeCloseTo(9.066667);
  });
});

describe('recorderArgs', () => {
  it('restricts protocols and records audio levels without a shell', () => {
    const args = recorderArgs({
      input: 'https://cdn.example/live.m3u8',
      dir: '/tmp/rec',
      epoch: 2,
    });
    expect(args).toContain('-protocol_whitelist');
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('https,tls,tcp,crypto');
    expect(args).toContain('/tmp/rec/e2-%06d.ts');
    expect(args).toContain('/tmp/rec/e2.csv');
    expect(args.join(' ')).toContain('astats');
  });
});

describe('buildLiveClip', () => {
  const word = (text: string, start: number, end: number): Word => ({
    text,
    startMs: start * 1000,
    endMs: end * 1000,
  });
  const words: Word[] = [
    word('olha', 8.2, 8.5),
    word('isso', 8.55, 8.9),
    word('cara', 8.95, 9.3),
    ...Array.from({ length: 14 }, (_, index) =>
      word(`p${index}`, 10 + index * 0.4, 10.3 + index * 0.4),
    ),
    word('acabou', 20, 20.5),
  ];
  const window: LiveWindow = { start: 8, end: 28, peakAt: 14, score: 7.4 };

  it('snaps to sentence edges and keeps the peak as a turn', () => {
    const outcome = buildLiveClip({
      id: 'live-0001-14',
      window,
      offset: 0,
      duration: 30,
      words,
      bottom: 'video',
      minWords: 8,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.clip.start).toBeCloseTo(8.05, 1);
    expect(outcome.clip.end).toBeGreaterThan(20);
    expect(outcome.clip.turns).toEqual([14]);
    expect(outcome.clip.score).toBe(7);
    expect(outcome.clip.hook).toContain('olha isso cara');
  });

  it('rejects windows with too little speech', () => {
    const outcome = buildLiveClip({
      id: 'live-0002-14',
      window,
      offset: 0,
      duration: 30,
      words: words.slice(0, 3),
      bottom: 'source',
      minWords: 8,
    });
    expect(outcome).toEqual({ ok: false, reason: 'pouca fala (3 palavras)' });
  });

  it('maps stream time to clip time through the offset', () => {
    const outcome = buildLiveClip({
      id: 'live-0003-114',
      window: { start: 108, end: 128, peakAt: 114, score: 6 },
      offset: 100,
      duration: 30,
      words,
      bottom: 'video',
      minWords: 8,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.clip.turns).toEqual([14]);
  });
});
