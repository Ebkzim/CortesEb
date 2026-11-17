import { describe, expect, it } from 'vitest';
import { LANGUAGE_PATTERN } from '../config/user-config.js';
import type { Word } from '../contracts/media.js';
import { AdWatcher, playlistHasAd } from './ad-watcher.js';
import { cameraCrop, parseCamera } from './camera.js';
import { ChatCounter } from './chat-counter.js';
import { buildLiveClip } from './clip-cut.js';
import { LiveDetector, type LiveWindow } from './live-detector.js';
import { recorderArgs } from './live-recorder.js';
import { RmsStreamParser } from './rms-stream.js';
import { certNamesAreTwitchEdge, parseIrcLine, twitchChannel } from './twitch-chat.js';
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

describe('recorderArgs with separate audio', () => {
  it('reads audio from the second input', () => {
    const args = recorderArgs({
      input: 'https://cdn.example/v.m3u8',
      audioInput: 'https://cdn.example/a.m3u8',
      dir: '/tmp/rec',
      epoch: 0,
    });
    const inputs = args.flatMap((arg, index) => (arg === '-i' ? [args[index + 1]] : []));
    expect(inputs).toEqual(['https://cdn.example/v.m3u8', 'https://cdn.example/a.m3u8']);
    const maps = args.flatMap((arg, index) => (arg === '-map' ? [args[index + 1]] : []));
    expect(maps).toEqual(['0:v:0', '1:a:0', '1:a:0']);
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

describe('ChatCounter', () => {
  function fill(counter: ChatCounter, from: number, to: number, perSecond: number): void {
    for (let second = from; second < to; second += 1) {
      for (let message = 0; message < perSecond; message += 1) counter.add(second + message / 10);
    }
  }

  it('stays at zero on a steady chat', () => {
    const counter = new ChatCounter();
    fill(counter, 0, 400, 1);
    expect(counter.boost(399)).toBe(0);
  });

  it('boosts when the chat explodes against its own average', () => {
    const counter = new ChatCounter();
    fill(counter, 0, 400, 1);
    fill(counter, 400, 410, 6);
    expect(counter.boost(409)).toBeGreaterThan(6);
    expect(counter.boost(409)).toBeLessThanOrEqual(12);
  });

  it('ignores bursts that are too small to mean anything', () => {
    const counter = new ChatCounter();
    fill(counter, 400, 405, 1);
    expect(counter.boost(404)).toBe(0);
  });
});

describe('twitch chat helpers', () => {
  it('extracts a channel only from twitch links', () => {
    expect(twitchChannel('https://www.twitch.tv/MaxyLobes')).toBe('maxylobes');
    expect(twitchChannel('https://twitch.tv/videos/123')).toBeNull();
    expect(twitchChannel('https://evil.com/maxylobes')).toBeNull();
    expect(twitchChannel('https://www.twitch.tv/a b')).toBeNull();
    expect(twitchChannel('nada')).toBeNull();
  });

  it('accepts only the real twitch edge certificate names', () => {
    expect(
      certNamesAreTwitchEdge(
        'DNS:raw-1.us-west-2.prod.twitchircedge.twitch.a2z.com, DNS:*.raw-1.us-west-2.prod.twitchircedge.twitch.a2z.com',
      ),
    ).toBe(true);
    expect(certNamesAreTwitchEdge('DNS:evil.com')).toBe(false);
    expect(certNamesAreTwitchEdge('DNS:a.twitchircedge.twitch.a2z.com, DNS:evil.com')).toBe(false);
    expect(certNamesAreTwitchEdge(undefined)).toBe(false);
  });

  it('recognizes pings and chat messages', () => {
    expect(parseIrcLine('PING :tmi.twitch.tv')).toEqual({
      kind: 'ping',
      payload: ':tmi.twitch.tv',
    });
    expect(parseIrcLine(':user!user@user.tmi.twitch.tv PRIVMSG #canal :oi')).toEqual({
      kind: 'message',
    });
    expect(parseIrcLine('@badges=;id=1 :u!u@u.tmi.twitch.tv PRIVMSG #canal :kkk')).toEqual({
      kind: 'message',
    });
    expect(parseIrcLine(':tmi.twitch.tv 001 justinfan1 :Welcome')).toBeNull();
  });
});

describe('LiveDetector with chat boost', () => {
  it('opens a window on a chat spike without any audio change', () => {
    const detector = new LiveDetector();
    const found: LiveWindow[] = [];
    for (let second = 0; second < 200; second += 1) {
      const boost = second >= 100 && second < 106 ? 8 : 0;
      found.push(...detector.push(second, -30, boost));
    }
    expect(found).toHaveLength(1);
  });
});

describe('camera crop', () => {
  it('builds a corner crop with the top-half ratio', () => {
    const crop = cameraCrop(parseCamera('bottom-left', 40), 1920, 1080);
    expect(crop).toEqual({ x: 0, y: 648, w: 486, h: 432 });
    expect(crop.w / crop.h).toBeCloseTo(1.125, 2);
  });

  it('anchors the right corners to the right edge', () => {
    const crop = cameraCrop(parseCamera('top-right', 30), 1920, 1080);
    expect(crop.x + crop.w).toBe(1920);
    expect(crop.y).toBe(0);
  });

  it('converts a percent rectangle to pixels', () => {
    expect(cameraCrop(parseCamera('0,60,25,40', 40), 1920, 1080)).toEqual({
      x: 0,
      y: 648,
      w: 480,
      h: 432,
    });
  });

  it('rejects invalid camera specs', () => {
    expect(() => parseCamera('meio', 40)).toThrow();
    expect(() => parseCamera('90,0,20,20', 40)).toThrow();
    expect(() => parseCamera('1,2,3', 40)).toThrow();
  });

  it('puts the crop on the clip', () => {
    const words = Array.from({ length: 14 }, (_, index) => ({
      text: `p${index}`,
      startMs: 8000 + index * 500,
      endMs: 8300 + index * 500,
    }));
    const outcome = buildLiveClip({
      id: 'live-0001-14',
      window: { start: 8, end: 20, peakAt: 12, score: 7 },
      offset: 0,
      duration: 30,
      words,
      bottom: 'source',
      minWords: 8,
      crop: { x: 0, y: 648, w: 486, h: 432 },
    });
    expect(outcome.ok && outcome.clip.crop).toEqual({ x: 0, y: 648, w: 486, h: 432 });
  });
});

describe('language pattern', () => {
  it('accepts codes and auto but nothing else', () => {
    expect(LANGUAGE_PATTERN.test('pt')).toBe(true);
    expect(LANGUAGE_PATTERN.test('auto')).toBe(true);
    expect(LANGUAGE_PATTERN.test('por')).toBe(true);
    expect(LANGUAGE_PATTERN.test('autos')).toBe(false);
    expect(LANGUAGE_PATTERN.test('p')).toBe(false);
    expect(LANGUAGE_PATTERN.test('pt-BR')).toBe(false);
  });
});

describe('ad detection', () => {
  const clean = '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.000,live\nseg1.ts\n';
  const ad =
    '#EXTM3U\n#EXT-X-DATERANGE:ID="1",CLASS="twitch-stitched-ad",START-DATE="2026-11-17T10:00:00Z"\n#EXTINF:2.000,Amazon\nad1.ts\n';

  it('recognizes twitch stitched ad markers', () => {
    expect(playlistHasAd(ad)).toBe(true);
    expect(playlistHasAd(clean)).toBe(false);
    expect(playlistHasAd('#EXT-X-TWITCH-INFO:X-TV-TWITCH-AD-URL="x"')).toBe(true);
  });

  it('reports only changes of state', async () => {
    const answers = [clean, ad, ad, clean];
    const seen: boolean[] = [];
    const watcher = new AdWatcher(
      'https://example.com/x.m3u8',
      (active) => seen.push(active),
      () => Promise.resolve(answers.shift() ?? ''),
    );
    for (let index = 0; index < 4; index += 1) await watcher.poll();
    expect(seen).toEqual([true, false]);
  });

  it('keeps the last state when the playlist cannot be fetched', async () => {
    const seen: boolean[] = [];
    const watcher = new AdWatcher(
      'https://example.com/x.m3u8',
      (active) => seen.push(active),
      () => Promise.reject(new Error('rede')),
    );
    await watcher.poll();
    expect(seen).toEqual([]);
  });
});
