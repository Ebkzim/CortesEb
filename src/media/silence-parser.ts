import type { Silence } from '../contracts/media.js';

const START = /silence_start: (-?[0-9.]+)/;
const END = /silence_end: (-?[0-9.]+)/;

export function parseSilences(log: string, totalDuration: number): Silence[] {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = START.exec(line)?.[1];
    const end = END.exec(line)?.[1];
    if (start !== undefined) open = Math.max(0, Number(start));
    if (end !== undefined && open !== null) {
      silences.push({ start: open, end: Number(end) });
      open = null;
    }
  }
  if (open !== null && totalDuration > open) silences.push({ start: open, end: totalDuration });
  return silences.filter((silence) => silence.end > silence.start);
}
