import React, { useMemo, useState } from 'react';
import { CheckCircle2, RotateCw } from 'lucide-react';
import { calculateSm2Update, type ReviewQuality } from '../lib/spacedRepetition';
import { updateFlashcardSchedule } from '../lib/studyRepo';
import { PastelSelect } from './PastelSelect';
import type { Flashcard, Subject } from '../types/study';

interface ReviewViewProps {
  uid: string;
  flashcards: Flashcard[];
  subjects: Subject[];
}

export const ReviewView: React.FC<ReviewViewProps> = ({ uid, flashcards, subjects }) => {
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [practiceAll, setPracticeAll] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [reviewedInSession, setReviewedInSession] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const queue = useMemo(() => {
    const nowIso = new Date().toISOString();
    return flashcards.filter((c) => {
      if (subjectFilter !== 'all' && c.subjectId !== subjectFilter) return false;
      if (!practiceAll && c.nextReviewAt > nowIso) return false;
      return true;
    });
  }, [flashcards, subjectFilter, practiceAll]);

  const currentCard = queue[0] || null;
  const activeSubject = currentCard ? subjectMap.get(currentCard.subjectId) : undefined;

  const handleGrade = async (quality: ReviewQuality) => {
    if (!currentCard || submitting) return;
    setSubmitting(true);
    try {
      const nextSchedule = calculateSm2Update(currentCard, quality);
      await updateFlashcardSchedule(uid, currentCard.id, nextSchedule);
      setFlipped(false);
      setReviewedInSession((prev) => prev + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Spaced Repetition</h1>
          <p className="text-sm text-[var(--pastel-muted)]">
            Active recall scheduled with SM-2 intervals to strengthen long-term memory.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <PastelSelect
            value={subjectFilter}
            onChange={(val) => {
              setSubjectFilter(val);
              setFlipped(false);
            }}
            ariaLabel="Filter flashcards by subject"
            variant="pill"
            align="right"
            className="min-w-[140px]"
            options={[
              { value: 'all', label: 'All Subjects' },
              ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
            ]}
          />

          <button
            type="button"
            onClick={() => {
              setPracticeAll((prev) => !prev);
              setFlipped(false);
            }}
            className={`px-4 py-2 text-xs font-bold rounded-full border cursor-pointer transition-colors whitespace-nowrap ${
              practiceAll
                ? 'border-[var(--pastel-accent)] bg-[var(--pastel-soft)]'
                : 'border-[var(--pastel-border)] bg-[var(--pastel-surface)]'
            }`}
          >
            {practiceAll ? 'Showing All Cards' : 'Due Today Only'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--pastel-muted)] font-mono-tabular px-1">
        <span>{queue.length} cards remaining in queue</span>
        <span>{reviewedInSession} reviewed this session</span>
      </div>

      {!currentCard ? (
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-12 text-center space-y-4">
          <CheckCircle2 className="w-8 h-8 mx-auto text-[var(--pastel-muted)]" />
          <div className="space-y-1">
            <h2 className="text-lg font-extrabold">
              {flashcards.length === 0 ? 'No flashcards yet' : 'You are all caught up'}
            </h2>
            <p className="text-xs text-[var(--pastel-muted)] max-w-md mx-auto">
              {flashcards.length === 0
                ? 'Upload a PDF or add cards in your Syllabus chapters to start spaced repetition.'
                : 'Every scheduled card for now has been reviewed. Switch to "Showing All Cards" if you want extra practice.'}
            </p>
          </div>
          {flashcards.length > 0 && !practiceAll && (
            <button
              type="button"
              onClick={() => setPracticeAll(true)}
              className="px-5 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer"
            >
              Practice All {flashcards.length} Cards
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-8 md:p-10 space-y-8">
          <div className="flex items-center justify-between text-xs text-[var(--pastel-muted)]">
            <div className="flex items-center gap-2">
              {activeSubject && (
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: activeSubject.color }}
                />
              )}
              <span>{activeSubject?.name || 'Subject'}</span>
            </div>
            <span className="font-mono-tabular">
              Reps: {currentCard.repetitions} · Interval: {currentCard.intervalDays}d
            </span>
          </div>

          <button
            type="button"
            onClick={() => setFlipped((prev) => !prev)}
            className="w-full min-h-[240px] p-8 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] flex flex-col items-center justify-center text-center space-y-4 cursor-pointer hover:bg-[var(--pastel-soft)]/50 transition-colors"
          >
            <span className="text-[11px] uppercase tracking-wider text-[var(--pastel-muted)]">
              {flipped ? 'Answer' : 'Prompt'}
            </span>
            <p className="text-lg md:text-xl font-bold leading-relaxed max-w-xl">
              {flipped ? currentCard.back : currentCard.front}
            </p>
            <span className="text-xs text-[var(--pastel-muted)] inline-flex items-center gap-1.5 pt-2">
              <RotateCw className="w-3.5 h-3.5" />
              <span>{flipped ? 'Click to see prompt' : 'Click to reveal answer'}</span>
            </span>
          </button>

          {flipped ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Again', sub: '1 day', quality: 1 as ReviewQuality },
                { label: 'Hard', sub: 'Shorter', quality: 3 as ReviewQuality },
                { label: 'Good', sub: 'Standard', quality: 4 as ReviewQuality },
                { label: 'Easy', sub: 'Longer', quality: 5 as ReviewQuality },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleGrade(btn.quality)}
                  className="py-3 px-4 rounded-2xl border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] transition-colors text-center cursor-pointer disabled:opacity-50"
                >
                  <div className="text-sm font-bold">{btn.label}</div>
                  <div className="text-[11px] text-[var(--pastel-muted)]">{btn.sub}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setFlipped(true)}
                className="px-6 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer"
              >
                Reveal Answer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
