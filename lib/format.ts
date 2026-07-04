import type { Language } from '@/lib/i18n/translations';

const localeOf = (language: Language) => (language === 'zh' ? 'zh-CN' : 'en-US');

/** Calendar date, e.g. "Jul 4, 2026". `utc: true` keeps date-only values from shifting by timezone. */
export function formatDate(iso: string, language: Language, opts?: { utc?: boolean }): string {
  return new Date(iso).toLocaleDateString(localeOf(language), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(opts?.utc ? { timeZone: 'UTC' } : {}),
  });
}

/** Short date-time, e.g. "Jul 4, 09:30". */
export function formatDateTime(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(localeOf(language), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
