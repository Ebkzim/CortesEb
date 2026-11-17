export interface RmsSample {
  time: number;
  level: number;
}

const TIME_LINE = /pts_time:([0-9.]+)/;
const LEVEL_LINE = /Overall\.RMS_level=(-inf|inf|-?[0-9.]+)/;
const SILENT_DB = -90;
const MAX_PENDING = 64 * 1024;

export class RmsStreamParser {
  private pending = '';
  private time = 0;

  push(chunk: string): RmsSample[] {
    const lines = (this.pending + chunk).split(/\r\n|\r|\n/);
    this.pending = (lines.pop() ?? '').slice(-MAX_PENDING);
    const samples: RmsSample[] = [];
    for (const line of lines) {
      const stamp = TIME_LINE.exec(line);
      if (stamp?.[1] !== undefined) this.time = Number(stamp[1]);
      const level = LEVEL_LINE.exec(line);
      if (level?.[1] === undefined) continue;
      const value = level[1].includes('inf') ? SILENT_DB : Number(level[1]);
      samples.push({ time: this.time, level: Number.isFinite(value) ? value : SILENT_DB });
    }
    return samples;
  }
}
