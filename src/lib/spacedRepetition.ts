import type { Flashcard } from '../types/study';

export type ReviewQuality = 1 | 3 | 4 | 5; // 1 = Again, 3 = Hard, 4 = Good, 5 = Easy

export function calculateSm2Update(
  card: Pick<Flashcard, 'repetitions' | 'intervalDays' | 'easeFactor'>,
  quality: ReviewQuality,
): {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: string;
  lastReviewedAt: string;
} {
  let { repetitions, intervalDays, easeFactor } = card;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    if (quality === 3) {
      intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
    } else if (quality === 5) {
      intervalDays = Math.max(2, Math.round(intervalDays * 1.3));
    }
    repetitions += 1;
  }

  const nextEase = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  easeFactor = Math.max(1.3, Math.min(5.0, Number(nextEase.toFixed(2))));
  intervalDays = Math.max(1, Math.min(36500, intervalDays));

  const now = new Date();
  const nextDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return {
    repetitions,
    intervalDays,
    easeFactor,
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
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
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
