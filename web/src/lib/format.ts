export function duration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds))
    return '—';
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${String(hours)} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0)
    return seconds === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(seconds)} s`;
  return `${String(seconds)} s`;
}

export function remaining(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return 'calculando o tempo';
  if (totalSeconds < 5) return 'quase pronto';
  return `cerca de ${duration(totalSeconds)} restantes`;
}

export function bytes(size: number): string {
  if (size < 1024 * 1024) return `${String(Math.max(1, Math.round(size / 1024)))} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function dayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (year === undefined || month === undefined || date === undefined) return day;
  const target = new Date(year, month - 1, date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return target.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function timecode(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes)}:${seconds}`;
}

export function parseClock(text: string): number | null {
  const clean = text.trim();
  if (clean === '') return null;
  const parts = clean.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  running: 'Rodando',
  waiting: 'Esperando você',
  done: 'Concluído',
  failed: 'Falhou',
  canceled: 'Cancelado',
  interrupted: 'Interrompido',
};

export const PRESET_LABEL: Record<string, string> = {
  'gameplay-camera': 'Gameplay com câmera',
  react: 'React',
  filmes: 'React de filme',
  series: 'React de série',
  'filmes-cena': 'Cena de filme',
  'series-cena': 'Cena de série',
  podcast: 'Podcast',
};

export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${String(hours)} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ontem' : `há ${String(days)} dias`;
}
