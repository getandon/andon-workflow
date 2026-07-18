import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export function expiryLabel(dateStr: string): string {
  const diffMs = new Date(dateStr).getTime() - Date.now();
  if (diffMs <= 0) return `expired ${relativeTime(dateStr)}`;
  const diffMin = Math.ceil(diffMs / 60000);
  if (diffMin < 1) return 'expires in <1m';
  if (diffMin < 60) return `expires in ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `expires in ${diffH}h ${diffMin % 60 > 0 ? `${diffMin % 60}m` : ''}`.trim();
  const diffD = Math.floor(diffH / 24);
  return `expires in ${diffD}d ${diffH % 24 > 0 ? `${diffH % 24}h` : ''}`.trim();
}

export function formatDuration(sec?: number | null): string {
  if (sec == null || sec === 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

export function calcDurationSec(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return Math.round((end - start) / 1000);
}
