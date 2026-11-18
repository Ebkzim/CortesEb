import { describe, expect, it } from 'vitest';
import { AppError } from '../common/app-error.js';
import { isTransient, sectionArgs } from './video-fetcher.js';

describe('download retries', () => {
  it('retries refusals, rate limits and network drops', () => {
    for (const text of [
      'yt-dlp saiu com código 1: ERROR: unable to download video data: HTTP Error 403: Forbidden',
      'ERROR: HTTP Error 429: Too Many Requests',
      'HTTP Error 503: Service Unavailable',
      'Read timed out',
    ]) {
      expect(isTransient(new AppError('PROCESS_FAILED', text))).toBe(true);
    }
  });

  it('does not retry errors that will not change', () => {
    expect(
      isTransient(
        new AppError('PROCESS_FAILED', 'ERROR: Video unavailable. This video is private'),
      ),
    ).toBe(false);
    expect(isTransient(new AppError('PROCESS_FAILED', 'HTTP Error 404: Not Found'))).toBe(false);
    expect(isTransient('texto')).toBe(false);
  });

  it('builds the section argument', () => {
    expect(sectionArgs({ from: 10.4, to: 70.2 })).toEqual(['--download-sections', '*10-71']);
    expect(sectionArgs(undefined)).toEqual([]);
  });
});
