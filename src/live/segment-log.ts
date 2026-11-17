export interface Segment {
  file: string;
  start: number;
  end: number;
}

const SEGMENT_NAME = /^[A-Za-z0-9._-]+\.ts$/;

export function parseSegmentList(text: string, base = 0): Segment[] {
  const segments: Segment[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [file, from, to] = line.trim().split(',');
    if (file === undefined || from === undefined || to === undefined) continue;
    if (!SEGMENT_NAME.test(file)) continue;
    const start = Number(from);
    const end = Number(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    segments.push({ file, start: base + start, end: base + end });
  }
  return segments;
}

export function segmentsCovering(
  segments: readonly Segment[],
  from: number,
  to: number,
): Segment[] {
  return segments.filter((segment) => segment.end > from && segment.start < to);
}

export function coveredUntil(segments: readonly Segment[]): number {
  return segments.reduce((latest, segment) => Math.max(latest, segment.end), 0);
}
