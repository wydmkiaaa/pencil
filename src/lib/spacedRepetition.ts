import {
  DEFAULT_REVIEW_INTERVALS,
  type DifficultyLevel,
  type Flashcard,
  type ReviewIntervalConfig,
} from '../types/study';

export type ReviewRating = 'hard' | 'medium' | 'easy';

export function calculateFlashcardReviewUpdate(
  card: Pick<Flashcard, 'repetitions' | 'intervalDays' | 'easeFactor'>,
  rating: ReviewRating,
  config: ReviewIntervalConfig = DEFAULT_REVIEW_INTERVALS,
  overrideDays?: number,
): {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  hardness: DifficultyLevel;
  nextReviewAt: string;
  lastReviewedAt: string;
} {
  let { repetitions, easeFactor } = card;

  const baseDays =
    rating === 'hard'
      ? config.hardDays
      : rating === 'medium'
        ? config.midDays
        : config.easyDays;

  const intervalDays =
    typeof overrideDays === 'number' && overrideDays >= 1
      ? Math.max(1, Math.min(365, Math.round(overrideDays)))
      : Math.max(1, Math.min(365, Math.round(baseDays)));

  if (rating === 'hard') {
    repetitions = Math.max(1, repetitions);
    easeFactor = Math.max(1.3, Number((easeFactor - 0.15).toFixed(2)));
  } else if (rating === 'medium') {
    repetitions += 1;
    easeFactor = Math.max(1.3, Math.min(5.0, Number(easeFactor.toFixed(2))));
  } else {
    repetitions += 1;
    easeFactor = Math.max(1.3, Math.min(5.0, Number((easeFactor + 0.15).toFixed(2))));
  }

  const now = new Date();
  const nextDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return {
    repetitions,
    intervalDays,
    easeFactor,
    hardness: rating,
    nextReviewAt: nextDate.toISOString(),
    lastReviewedAt: now.toISOString(),
  };
}

export function getDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationShort(totalSeconds: number): string {
  const mins = Math.round(totalSeconds / 60);
  if (mins === 0 && totalSeconds > 0) {
    return `${Math.round(totalSeconds)}s`;
  }
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function formatVideoTimestamp(totalSeconds?: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function parseVideoDurationInput(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => Number(p.trim()));
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
    if (parts.length === 2) {
      return Math.round(parts[0] * 60 + parts[1]);
    }
    if (parts.length === 3) {
      return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
    return 0;
  }
  const num = Number(trimmed);
  if (Number.isNaN(num) || num < 0) return 0;
  // Treat plain numbers as minutes (e.g. "55" -> 55 min = 3300s, "60" -> 1 hour)
  return Math.round(num * 60);
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getGreetingLabel(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
