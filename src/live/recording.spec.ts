import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProcessRunner } from '../common/process-runner.js';
import type { YtDlp } from '../download/yt-dlp.js';
import { LiveRecorder } from './live-recorder.js';
import type { RmsSample } from './rms-stream.js';
import { coveredUntil, parseSegmentList } from './segment-log.js';

const hasFfmpeg = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('recording a synthetic stream', () => {
  let dir = '';
  let input = '';

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortes-eb-rec-'));
    input = path.join(dir, 'input.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=25:duration=12',
        '-f',
        'lavfi',
        '-i',
        "aevalsrc='0.02*sin(2*PI*440*t)+if(between(t,6,9),0.6*sin(2*PI*220*t),0)':s=16000:d=12",
        '-c:v',
        'libx264',
        '-g',
        '25',
        '-c:a',
        'aac',
        '-shortest',
        input,
      ],
      { stdio: 'ignore' },
    );
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes segments, a segment list and one loudness sample per second', async () => {
    const recorder = new LiveRecorder(new ProcessRunner(), {} as YtDlp);
    const recDir = path.join(dir, 'rec');
    fs.mkdirSync(recDir);
    const samples: RmsSample[] = [];
    const recording = recorder.start(
      { input, dir: recDir, epoch: 0, protocols: 'file,crypto' },
      (sample) => samples.push(sample),
    );
    expect(await recording.exited).toBe(0);

    const segments = parseSegmentList(fs.readFileSync(recording.list, 'utf8'));
    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(coveredUntil(segments)).toBeGreaterThan(10);
    for (const segment of segments) {
      expect(fs.existsSync(path.join(recDir, segment.file))).toBe(true);
    }

    expect(samples.length).toBeGreaterThanOrEqual(10);
    const quiet = samples.find((sample) => sample.time >= 2 && sample.time < 4);
    const loud = samples.find((sample) => sample.time >= 7 && sample.time < 8);
    expect(quiet).toBeDefined();
    expect(loud).toBeDefined();
    expect((loud?.level ?? -90) - (quiet?.level ?? 0)).toBeGreaterThan(10);
  });
});
