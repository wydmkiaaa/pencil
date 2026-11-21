import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Pause,
  Play,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { extractPdfTextInBrowser } from '../lib/pdfExtract';
import {
  calculateFlashcardReviewUpdate,
  formatClock,
  formatDurationShort,
  getDateKey,
  type ReviewRating,
} from '../lib/spacedRepetition';
import {
  createBlurtSession,
  createFlashcardsBatch,
  deleteBlurtSession,
  logFocusSession,
  updateBlurtSessionCardsCount,
  updateFlashcardDetails,
  updateFlashcardSchedule,
  updateUserProfile,
} from '../lib/studyRepo';
import { PastelSelect } from './PastelSelect';
import {
  DEFAULT_REVIEW_INTERVALS,
  HARDNESS_LABELS,
  HARDNESS_ORDER_WEIGHT,
  PRIORITY_LABELS,
  PRIORITY_ORDER_WEIGHT,
  type AmbientSoundId,
  type BlurtSession,
  type Chapter,
  type DifficultyLevel,
  type Flashcard,
  type PriorityLevel,
  type ReviewIntervalConfig,
  type Subject,
  type UserProfile,
} from '../types/study';

interface ReviewViewProps {
  uid: string;
  profile: UserProfile;
  flashcards: Flashcard[];
  subjects: Subject[];
  chapters: Chapter[];
  blurtSessions: BlurtSession[];
  ambientSound: AmbientSoundId;
}

type ReviewTab = 'flashcards' | 'blurting';
type BlurtSourceMode = 'chapter' | 'pdf_or_text';

export const ReviewView: React.FC<ReviewViewProps> = ({
  uid,
  profile,
  flashcards,
  subjects,
  chapters,
  blurtSessions,
  ambientSound,
}) => {
  const [reviewTab, setReviewTab] = useState<ReviewTab>('flashcards');

  // --- Flashcards State ---
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [selectedDifficulties, setSelectedDifficulties] = useState<DifficultyLevel[]>([
    'hard',
    'medium',
    'easy',
  ]);
  const [sortOrder, setSortOrder] = useState<'priority' | 'due'>('priority');
  const [practiceAll, setPracticeAll] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [reviewedInSession, setReviewedInSession] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [customNextDays, setCustomNextDays] = useState('');
  const [fcError, setFcError] = useState<string | null>(null);

  // Interval Settings UI inside Review
  const savedIntervals: ReviewIntervalConfig = profile.reviewIntervals || DEFAULT_REVIEW_INTERVALS;
  const [showIntervalsPanel, setShowIntervalsPanel] = useState(false);
  const [hardDaysInput, setHardDaysInput] = useState(String(savedIntervals.hardDays));
  const [midDaysInput, setMidDaysInput] = useState(String(savedIntervals.midDays));
  const [easyDaysInput, setEasyDaysInput] = useState(String(savedIntervals.easyDays));
  const [savingIntervals, setSavingIntervals] = useState(false);
  const [intervalNotice, setIntervalNotice] = useState<string | null>(null);

  // Active Recall Timer for Flashcards
  const [fcTimerRunning, setFcTimerRunning] = useState(false);
  const [fcSeconds, setFcSeconds] = useState(0);
  const [fcTimeStatus, setFcTimeStatus] = useState<string | null>(null);
  const [practicedIdsThisRound, setPracticedIdsThisRound] = useState<string[]>([]);
  const lastFcActivityRef = useRef<number>(Date.now());
  const fcSecondsRef = useRef(0);
  fcSecondsRef.current = fcSeconds;

  // --- Blurting State ---
  const [blurtSourceMode, setBlurtSourceMode] = useState<BlurtSourceMode>('chapter');
  const [blurtSubjectId, setBlurtSubjectId] = useState<string>('');
  const [blurtChapterId, setBlurtChapterId] = useState<string>('');
  const [blurtCustomSubjectId, setBlurtCustomSubjectId] = useState<string>('');
  const [blurtSourceLabel, setBlurtSourceLabel] = useState<string>('');
  const [customReferenceNotes, setCustomReferenceNotes] = useState<string>('');
  const [peekNotes, setPeekNotes] = useState(false);
  const [blurtText, setBlurtText] = useState('');
  const [blurtTimerRunning, setBlurtTimerRunning] = useState(false);
  const [blurtSeconds, setBlurtSeconds] = useState(0);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [blurtError, setBlurtError] = useState<string | null>(null);
  const [reviewingBlurt, setReviewingBlurt] = useState(false);
  const [activeBlurtResult, setActiveBlurtResult] = useState<BlurtSession | null>(null);
  const [weakCardCount, setWeakCardCount] = useState(6);
  const [weakCardSubjectId, setWeakCardSubjectId] = useState('');
  const [generatingWeakCards, setGeneratingWeakCards] = useState(false);
  const [weakCardsNotice, setWeakCardsNotice] = useState<string | null>(null);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const chapterMap = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);

  useEffect(() => {
    setHardDaysInput(String(savedIntervals.hardDays));
    setMidDaysInput(String(savedIntervals.midDays));
    setEasyDaysInput(String(savedIntervals.easyDays));
  }, [savedIntervals.hardDays, savedIntervals.midDays, savedIntervals.easyDays]);

  useEffect(() => {
    if (!blurtSubjectId && subjects.length > 0) {
      setBlurtSubjectId(subjects[0].id);
    }
  }, [subjects, blurtSubjectId]);

  const blurtSubjectChapters = useMemo(
    () => chapters.filter((c) => c.subjectId === blurtSubjectId).sort((a, b) => a.order - b.order),
    [chapters, blurtSubjectId],
  );

  useEffect(() => {
    if (blurtSubjectChapters.length > 0 && !blurtSubjectChapters.some((c) => c.id === blurtChapterId)) {
      setBlurtChapterId(blurtSubjectChapters[0].id);
    } else if (blurtSubjectChapters.length === 0) {
      setBlurtChapterId('');
    }
  }, [blurtSubjectChapters, blurtChapterId]);

  // Flashcard filter chapters
  const filterChapters = useMemo(() => {
    if (subjectFilter === 'all') return [];
    return chapters.filter((c) => c.subjectId === subjectFilter).sort((a, b) => a.order - b.order);
  }, [chapters, subjectFilter]);

  useEffect(() => {
    setChapterFilter('all');
  }, [subjectFilter]);

  const selectedDifficultyKey = useMemo(
    () => [...selectedDifficulties].sort().join(','),
    [selectedDifficulties],
  );

  const toggleDifficulty = (diff: DifficultyLevel) => {
    setSelectedDifficulties((prev) => {
      if (prev.includes(diff)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== diff);
      }
      if (prev.length >= 3) return prev;
      return [...prev, diff];
    });
    setFlipped(false);
  };

  useEffect(() => {
    setPracticedIdsThisRound([]);
  }, [subjectFilter, chapterFilter, selectedDifficultyKey, practiceAll]);

  const scopeMatchingCards = useMemo(
    () =>
      flashcards.filter((c) => {
        if (subjectFilter !== 'all' && c.subjectId !== subjectFilter) return false;
        if (chapterFilter !== 'all' && c.chapterId !== chapterFilter) return false;
        return true;
      }),
    [flashcards, subjectFilter, chapterFilter],
  );

  const difficultyCounts = useMemo(() => {
    const counts: Record<DifficultyLevel, number> = { hard: 0, medium: 0, easy: 0 };
    for (const c of scopeMatchingCards) {
      counts[c.hardness || 'medium'] += 1;
    }
    return counts;
  }, [scopeMatchingCards]);

  const selectedScopeCount = useMemo(
    () =>
      scopeMatchingCards.filter((c) =>
        selectedDifficulties.includes(c.hardness || 'medium'),
      ).length,
    [scopeMatchingCards, selectedDifficulties],
  );

  const queue = useMemo(() => {
    const nowIso = new Date().toISOString();
    const practicedSet = new Set(practicedIdsThisRound);
    const list = scopeMatchingCards.filter((c) => {
      if (practicedSet.has(c.id)) return false;
      if (!selectedDifficulties.includes(c.hardness || 'medium')) return false;
      if (!practiceAll && c.nextReviewAt > nowIso) {
        return false;
      }
      return true;
    });

    if (sortOrder === 'priority') {
      return [...list].sort((a, b) => {
        const pDiff =
          PRIORITY_ORDER_WEIGHT[b.priority || 'medium'] -
          PRIORITY_ORDER_WEIGHT[a.priority || 'medium'];
        if (pDiff !== 0) return pDiff;
        const hDiff =
          HARDNESS_ORDER_WEIGHT[b.hardness || 'medium'] -
          HARDNESS_ORDER_WEIGHT[a.hardness || 'medium'];
        if (hDiff !== 0) return hDiff;
        return a.nextReviewAt.localeCompare(b.nextReviewAt);
      });
    }
    return [...list].sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
  }, [
    scopeMatchingCards,
    selectedDifficulties,
    practiceAll,
    practicedIdsThisRound,
    sortOrder,
  ]);

  const currentCard = queue[0] || null;
  const activeSubject = currentCard ? subjectMap.get(currentCard.subjectId) : undefined;
  const activeCardChapter =
    currentCard && currentCard.chapterId ? chapterMap.get(currentCard.chapterId) : undefined;

  const logFlashcardPracticeTime = useCallback(
    async (seconds: number, reason?: string) => {
      if (seconds < 5) return;
      const subj = subjectFilter !== 'all' ? subjectMap.get(subjectFilter) : activeSubject;
      const chap = chapterFilter !== 'all' ? chapterMap.get(chapterFilter) : undefined;
      await logFocusSession(uid, {
        mode: 'flashcards',
        contextType: 'active_recall',
        subjectId: subj?.id || '',
        subjectName: subj?.name || 'All Subjects',
        subjectColor: subj?.color || '#4B5563',
        chapterId: chap?.id || '',
        chapterTitle: chap?.title || '',
        durationSeconds: seconds,
        ambientSound,
        completedAt: new Date().toISOString(),
        dateKey: getDateKey(),
      });
      setFcTimeStatus(
        reason || `Logged ${formatDurationShort(seconds)} active recall.`,
      );
    },
    [uid, subjectFilter, chapterFilter, subjectMap, chapterMap, activeSubject, ambientSound],
  );

  // Flashcard practice timer tick + 90s inactivity auto-stop
  useEffect(() => {
    if (!fcTimerRunning || reviewTab !== 'flashcards') return;
    const id = window.setInterval(() => {
      if (Date.now() - lastFcActivityRef.current >= 90_000) {
        const elapsed = fcSecondsRef.current;
        setFcTimerRunning(false);
        setFcSeconds(0);
        if (elapsed >= 5) {
          void logFlashcardPracticeTime(
            elapsed,
            `Timer stopped after inactivity · logged ${formatDurationShort(elapsed)}.`,
          );
        } else {
          setFcTimeStatus('Timer paused automatically due to inactivity.');
        }
        return;
      }
      setFcSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [fcTimerRunning, reviewTab, logFlashcardPracticeTime]);

  // Automatically stop & log timer whenever queue finishes or user switches away from Flashcards
  useEffect(() => {
    const shouldAutoStop = queue.length === 0 || reviewTab !== 'flashcards';
    if (!shouldAutoStop) return;
    if (!fcTimerRunning && fcSeconds === 0) return;

    const elapsed = fcSeconds;
    setFcTimerRunning(false);
    setFcSeconds(0);
    if (elapsed >= 5) {
      void logFlashcardPracticeTime(elapsed);
    }
  }, [queue.length, reviewTab, fcTimerRunning, fcSeconds, logFlashcardPracticeTime]);

  useEffect(() => {
    if (!blurtTimerRunning || reviewTab !== 'blurting') return;
    const id = window.setInterval(() => setBlurtSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [blurtTimerRunning, reviewTab]);

  const handleGrade = async (rating: ReviewRating) => {
    if (!currentCard || submitting) return;
    setFcError(null);
    lastFcActivityRef.current = Date.now();
    const gradedId = currentCard.id;
    const isLastInQueue = queue.length === 1;
    let finalSecondsToLog = 0;

    if (isLastInQueue) {
      finalSecondsToLog = fcSecondsRef.current;
      setFcTimerRunning(false);
      setFcSeconds(0);
    } else if (!fcTimerRunning && fcSeconds === 0) {
      setFcTimerRunning(true);
    }

    const overrideNum = Number(customNextDays);
    const overrideDays =
      customNextDays.trim() && !Number.isNaN(overrideNum) && overrideNum >= 1
        ? overrideNum
        : undefined;
    const nextSchedule = calculateFlashcardReviewUpdate(
      currentCard,
      rating,
      savedIntervals,
      overrideDays,
    );

    // Immediately mark card done in this round so it never repeats in the queue
    setPracticedIdsThisRound((prev) => (prev.includes(gradedId) ? prev : [...prev, gradedId]));
    setFlipped(false);
    setCustomNextDays('');
    setReviewedInSession((prev) => prev + 1);

    setSubmitting(true);
    try {
      await updateFlashcardSchedule(uid, gradedId, nextSchedule);

      if (isLastInQueue && finalSecondsToLog >= 5) {
        await logFlashcardPracticeTime(finalSecondsToLog);
      }
    } catch (err) {
      console.error('Failed to update flashcard schedule:', err);
      setFcError('Could not save your rating to cloud sync, though this card was marked done for this round.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePracticeTimerNow = async () => {
    if (fcSeconds < 5) {
      setFcTimeStatus('Practice at least 5 seconds to record active recall time.');
      return;
    }
    setFcTimerRunning(false);
    const secs = fcSeconds;
    setFcSeconds(0);
    await logFlashcardPracticeTime(secs);
  };

  const handleSaveIntervals = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIntervals(true);
    setIntervalNotice(null);
    try {
      await updateUserProfile(uid, {
        reviewIntervals: {
          hardDays: Math.max(1, Math.min(365, Math.round(Number(hardDaysInput) || 1))),
          midDays: Math.max(1, Math.min(365, Math.round(Number(midDaysInput) || 3))),
          easyDays: Math.max(1, Math.min(365, Math.round(Number(easyDaysInput) || 7))),
        },
      });
      setIntervalNotice('Review intervals updated.');
      setShowIntervalsPanel(false);
    } finally {
      setSavingIntervals(false);
    }
  };

  // --- Blurting Handlers ---
  const selectedBlurtChapter = blurtChapterId ? chapterMap.get(blurtChapterId) : undefined;
  const selectedBlurtSubject =
    blurtSourceMode === 'chapter'
      ? blurtSubjectId
        ? subjectMap.get(blurtSubjectId)
        : undefined
      : blurtCustomSubjectId
        ? subjectMap.get(blurtCustomSubjectId)
        : undefined;

  const effectiveReferenceNotes =
    blurtSourceMode === 'chapter'
      ? (selectedBlurtChapter?.notes || '').trim()
      : customReferenceNotes.trim();

  const effectiveSourceLabel =
    blurtSourceMode === 'chapter'
      ? selectedBlurtChapter
        ? `${selectedBlurtSubject?.name || 'Subject'} · ${selectedBlurtChapter.title}`
        : 'Syllabus Chapter Notes'
      : blurtSourceLabel.trim() || 'Uploaded / Pasted Notes';

  const handleBlurtPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBlurtError(null);
    setPdfExtracting(true);
    try {
      const result = await extractPdfTextInBrowser(file);
      if (result.text.length < 20) {
        setBlurtError('Could not extract readable text from that PDF.');
        return;
      }
      setCustomReferenceNotes(result.text.slice(0, 30000));
      setBlurtSourceLabel(`${file.name} (${result.pageCount}p)`);
    } catch (err) {
      setBlurtError(err instanceof Error ? err.message : 'Failed to extract PDF text.');
    } finally {
      setPdfExtracting(false);
    }
  };

  const handleRunBlurtReview = async () => {
    setBlurtError(null);
    setWeakCardsNotice(null);
    if (effectiveReferenceNotes.length < 20) {
      setBlurtError(
        blurtSourceMode === 'chapter'
          ? 'This chapter has no saved notes yet. Add notes in Syllabus or upload a PDF/notes here.'
          : 'Upload a PDF or paste at least a short reference note before reviewing your blurt.',
      );
      return;
    }
    if (blurtText.trim().length < 15) {
      setBlurtError('Write a little more from memory in your blurt before submitting.');
      return;
    }

    setBlurtTimerRunning(false);
    const recordedSeconds = Math.max(5, blurtSeconds || 15);
    setReviewingBlurt(true);

    try {
      const res = await fetch('/api/ai/blurt-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blurtText: blurtText.trim(),
          referenceNotes: effectiveReferenceNotes,
          subjectName: selectedBlurtSubject?.name || 'General Study',
          chapterTitle:
            blurtSourceMode === 'chapter'
              ? selectedBlurtChapter?.title || 'Chapter'
              : effectiveSourceLabel,
        }),
      });
      const rawText = await res.text();
      let data: {
        summary?: string;
        strongPoints?: string[];
        weakPoints?: Array<{ topic: string; gap: string; suggestedReview: string }>;
        missedKeyFacts?: string[];
        error?: string;
      } = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText) as typeof data;
        } catch {
          throw new Error(
            res.ok
              ? 'Received an unexpected response format from AI blurt review.'
              : `AI blurt review failed (${res.status}). Please try again.`,
          );
        }
      }
      if (!res.ok) {
        throw new Error(data.error || `Failed to review blurt (${res.status}).`);
      }

      const dateKey = getDateKey();
      const pendingResult: BlurtSession = {
        id: `temp_${Date.now()}`,
        ownerId: uid,
        subjectId: selectedBlurtSubject?.id || '',
        subjectName: selectedBlurtSubject?.name || 'General Study',
        chapterId: blurtSourceMode === 'chapter' ? selectedBlurtChapter?.id || '' : '',
        chapterTitle: blurtSourceMode === 'chapter' ? selectedBlurtChapter?.title || '' : '',
        sourceLabel: effectiveSourceLabel,
        blurtText: blurtText.trim(),
        durationSeconds: recordedSeconds,
        summary: data.summary || '',
        strongPoints: data.strongPoints || [],
        weakPoints: data.weakPoints || [],
        missedKeyFacts: data.missedKeyFacts || [],
        cardsGeneratedCount: 0,
        dateKey,
      };
      setActiveBlurtResult(pendingResult);
      setWeakCardSubjectId(selectedBlurtSubject?.id || subjects[0]?.id || '');
      setBlurtSeconds(0);

      try {
        const blurtId = await createBlurtSession(uid, {
          subjectId: pendingResult.subjectId,
          subjectName: pendingResult.subjectName,
          chapterId: pendingResult.chapterId,
          chapterTitle: pendingResult.chapterTitle,
          sourceLabel: pendingResult.sourceLabel,
          blurtText: pendingResult.blurtText,
          durationSeconds: recordedSeconds,
          summary: pendingResult.summary,
          strongPoints: pendingResult.strongPoints,
          weakPoints: pendingResult.weakPoints,
          missedKeyFacts: pendingResult.missedKeyFacts,
          dateKey,
        });

        await logFocusSession(uid, {
          mode: 'blurting',
          contextType: 'active_recall',
          subjectId: pendingResult.subjectId,
          subjectName: pendingResult.subjectName,
          subjectColor: selectedBlurtSubject?.color || '#4B5563',
          chapterId: pendingResult.chapterId,
          chapterTitle:
            blurtSourceMode === 'chapter'
              ? selectedBlurtChapter?.title || ''
              : effectiveSourceLabel,
          durationSeconds: recordedSeconds,
          ambientSound,
          completedAt: new Date().toISOString(),
          dateKey,
        });

        setActiveBlurtResult({ ...pendingResult, id: blurtId });
      } catch (saveErr) {
        console.error('Failed to save blurt session to Firestore:', saveErr);
        setBlurtError('AI analysis succeeded, but saving to your session history failed. Please try again or check your connection.');
      }
    } catch (err) {
      setBlurtError(err instanceof Error ? err.message : 'AI blurt review failed.');
    } finally {
      setReviewingBlurt(false);
    }
  };

  const handleGenerateWeakPointCards = async (session: BlurtSession) => {
    setWeakCardsNotice(null);
    setBlurtError(null);
    setGeneratingWeakCards(true);
    try {
      const res = await fetch('/api/ai/weakpoint-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weakPoints: session.weakPoints,
          missedKeyFacts: session.missedKeyFacts,
          referenceNotes: effectiveReferenceNotes,
          subjectName: session.subjectName || 'General Study',
          chapterTitle: session.chapterTitle || session.sourceLabel,
          cardCount: weakCardCount,
        }),
      });
      const rawText = await res.text();
      let data: {
        flashcards?: Array<{ front: string; back: string }>;
        error?: string;
      } = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText) as typeof data;
        } catch {
          throw new Error(
            res.ok
              ? 'Received an unexpected response format while generating flashcards.'
              : `Weak-point flashcard generation failed (${res.status}). Please try again.`,
          );
        }
      }
      if (!res.ok) {
        throw new Error(data.error || `Failed to generate weak-point flashcards (${res.status}).`);
      }

      const targetSubjId = weakCardSubjectId || session.subjectId || subjects[0]?.id || 'general';
      const generated = data.flashcards || [];
      if (generated.length > 0) {
        await createFlashcardsBatch(
          uid,
          targetSubjId,
          session.chapterId || '',
          generated.map((c) => ({
            ...c,
            priority: 'high' as PriorityLevel,
            hardness: 'hard' as DifficultyLevel,
          })),
        );
        if (!session.id.startsWith('temp_')) {
          await updateBlurtSessionCardsCount(
            uid,
            session.id,
            (session.cardsGeneratedCount || 0) + generated.length,
          );
        }
        if (activeBlurtResult?.id === session.id) {
          setActiveBlurtResult({
            ...activeBlurtResult,
            cardsGeneratedCount: (activeBlurtResult.cardsGeneratedCount || 0) + generated.length,
          });
        }
        setWeakCardsNotice(
          `Saved ${generated.length} high-priority hard flashcards targeting your weak points.`,
        );
      }
    } catch (err) {
      setBlurtError(err instanceof Error ? err.message : 'Failed to create flashcards.');
    } finally {
      setGeneratingWeakCards(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Header + Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Active Recall &amp; Review</h1>
          <p className="text-sm text-[var(--pastel-muted)]">
            Practice subject-wise flashcards on custom intervals or blurt from memory with AI feedback.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[var(--pastel-soft)] rounded-full">
          <button
            type="button"
            onClick={() => setReviewTab('flashcards')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
              reviewTab === 'flashcards'
                ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Flashcards</span>
          </button>
          <button
            type="button"
            onClick={() => setReviewTab('blurting')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
              reviewTab === 'blurting'
                ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Blurting</span>
          </button>
        </div>
      </div>

      {reviewTab === 'flashcards' ? (
        <div className="space-y-5">
          {/* Controls Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <PastelSelect
                value={subjectFilter}
                onChange={(val) => {
                  setSubjectFilter(val);
                  setFlipped(false);
                }}
                ariaLabel="Practice flashcards by subject"
                variant="pill"
                className="min-w-[140px]"
                options={[
                  { value: 'all', label: 'All Subjects' },
                  ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
                ]}
              />

              {subjectFilter !== 'all' && filterChapters.length > 0 && (
                <PastelSelect
                  value={chapterFilter}
                  onChange={(val) => {
                    setChapterFilter(val);
                    setFlipped(false);
                  }}
                  ariaLabel="Filter by chapter"
                  variant="pill"
                  className="min-w-[130px]"
                  options={[
                    { value: 'all', label: 'All Chapters' },
                    ...filterChapters.map((c) => ({ value: c.id, label: c.title })),
                  ]}
                />
              )}

              {/* Multi-select difficulty filter (up to 3 difficulties at a time) */}
              <div
                className="inline-flex items-center gap-1 p-1 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)]"
                role="group"
                aria-label="Filter by difficulty (up to 3)"
              >
                {(
                  [
                    { id: 'hard' as DifficultyLevel, label: 'Hard' },
                    { id: 'medium' as DifficultyLevel, label: 'Mid' },
                    { id: 'easy' as DifficultyLevel, label: 'Easy' },
                  ]
                ).map((d) => {
                  const active = selectedDifficulties.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDifficulty(d.id)}
                      aria-pressed={active}
                      className={`px-2.5 py-1 text-xs font-bold rounded-full transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                          : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)]'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
                {selectedDifficulties.length < 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDifficulties(['hard', 'medium', 'easy']);
                      setFlipped(false);
                    }}
                    className="px-2 py-1 text-[11px] font-bold text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] cursor-pointer whitespace-nowrap"
                  >
                    All 3
                  </button>
                )}
              </div>

              <PastelSelect
                value={sortOrder}
                onChange={(val) => setSortOrder(val as 'priority' | 'due')}
                ariaLabel="Sort card queue"
                variant="pill"
                className="min-w-[125px]"
                options={[
                  { value: 'priority', label: 'Priority First' },
                  { value: 'due', label: 'Due Earliest' },
                ]}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              <button
                type="button"
                onClick={() => setShowIntervalsPanel((prev) => !prev)}
                className="px-3.5 py-2 text-xs font-bold rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)] hover:bg-[var(--pastel-soft)] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>
                  Days: {savedIntervals.hardDays}/{savedIntervals.midDays}/{savedIntervals.easyDays}
                </span>
              </button>
            </div>
          </div>

          {/* Configurable Review Interval Days Panel */}
          {showIntervalsPanel && (
            <form
              onSubmit={handleSaveIntervals}
              className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-4"
            >
              <div>
                <h2 className="text-sm font-extrabold">Practice Interval Settings (Days)</h2>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Choose after how many days a card returns for review when marked Hard, Mid, or Easy.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="block text-xs font-bold text-[var(--pastel-muted)]">Hard (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={hardDaysInput}
                    onChange={(e) => setHardDaysInput(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-bold text-[var(--pastel-muted)]">Mid (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={midDaysInput}
                    onChange={(e) => setMidDaysInput(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-bold text-[var(--pastel-muted)]">Easy (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={easyDaysInput}
                    onChange={(e) => setEasyDaysInput(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowIntervalsPanel(false)}
                  className="px-4 py-2 text-xs font-bold text-[var(--pastel-muted)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingIntervals}
                  className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingIntervals ? 'Saving...' : 'Save Intervals'}
                </button>
              </div>
            </form>
          )}

          {intervalNotice && (
            <p className="text-xs text-[var(--pastel-muted)] px-1">{intervalNotice}</p>
          )}

          {/* Queue & Active Recall Practice Timer Bar */}
          <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="font-mono-tabular text-[var(--pastel-muted)]">
              {queue.length} remaining · {reviewedInSession} reviewed
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono-tabular font-bold">
                <Clock className="w-3.5 h-3.5 text-[var(--pastel-muted)]" />
                {formatClock(fcSeconds)}
              </span>
              <button
                type="button"
                onClick={() => {
                  lastFcActivityRef.current = Date.now();
                  setFcTimeStatus(null);
                  setFcTimerRunning((r) => !r);
                }}
                disabled={!currentCard && !fcTimerRunning}
                className="px-3 py-1 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-45"
              >
                {fcTimerRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{fcTimerRunning ? 'Pause' : 'Track Time'}</span>
              </button>
              {fcSeconds >= 5 && (
                <button
                  type="button"
                  onClick={() => void handleSavePracticeTimerNow()}
                  className="px-3 py-1 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] font-bold cursor-pointer"
                >
                  Log Recall Time
                </button>
              )}
              {fcTimeStatus && <span className="text-[var(--pastel-muted)]">{fcTimeStatus}</span>}
            </div>
          </div>

          {fcError && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50/70 border border-red-200 rounded-2xl p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{fcError}</span>
            </div>
          )}

          {!currentCard ? (
            <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-8 md:p-10 text-center space-y-5">
              <CheckCircle2 className="w-8 h-8 mx-auto text-[var(--pastel-muted)]" />
              <div className="space-y-1.5">
                <h2 className="text-lg font-extrabold">
                  {flashcards.length === 0
                    ? 'No flashcards yet'
                    : practicedIdsThisRound.length > 0
                      ? 'First round complete'
                      : 'You are all caught up'}
                </h2>
                <p className="text-xs text-[var(--pastel-muted)] max-w-md mx-auto leading-relaxed">
                  {flashcards.length === 0
                    ? 'Add flashcards in Syllabus chapters or generate them from Blurting weak points.'
                    : practicedIdsThisRound.length > 0
                      ? `You finished ${practicedIdsThisRound.length} ${practicedIdsThisRound.length === 1 ? 'card' : 'cards'} in this round and practice stopped automatically. Pick below if you want to practice all cards or specific difficulties.`
                      : 'No due cards match this filter right now. You can practice all cards or choose up to 3 difficulties below.'}
                </p>
              </div>

              {scopeMatchingCards.length > 0 && (
                <div className="max-w-md mx-auto pt-2 space-y-4">
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--pastel-muted)]">
                      Choose Difficulties (up to 3)
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {(
                        [
                          { id: 'hard' as DifficultyLevel, label: 'Hard', count: difficultyCounts.hard },
                          { id: 'medium' as DifficultyLevel, label: 'Mid', count: difficultyCounts.medium },
                          { id: 'easy' as DifficultyLevel, label: 'Easy', count: difficultyCounts.easy },
                        ]
                      ).map((d) => {
                        const active = selectedDifficulties.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => toggleDifficulty(d.id)}
                            aria-pressed={active}
                            className={`px-3.5 py-1.5 rounded-full border text-xs font-bold transition-colors cursor-pointer ${
                              active
                                ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border-[var(--pastel-accent)]'
                                : 'bg-[var(--pastel-canvas)] text-[var(--pastel-muted)] border-[var(--pastel-border)] hover:text-[var(--pastel-ink)]'
                            }`}
                          >
                            {d.label} ({d.count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      disabled={selectedScopeCount === 0}
                      onClick={() => {
                        lastFcActivityRef.current = Date.now();
                        setFcError(null);
                        setFlipped(false);
                        setPracticeAll(true);
                        setPracticedIdsThisRound([]);
                      }}
                      className="px-5 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer disabled:opacity-45"
                    >
                      Practice Selected ({selectedScopeCount})
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        lastFcActivityRef.current = Date.now();
                        setFcError(null);
                        setFlipped(false);
                        setSelectedDifficulties(['hard', 'medium', 'easy']);
                        setPracticeAll(true);
                        setPracticedIdsThisRound([]);
                      }}
                      className="px-5 py-2.5 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)] text-xs font-bold cursor-pointer"
                    >
                      Practice All Cards ({scopeMatchingCards.length})
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 md:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--pastel-muted)]">
                <div className="flex flex-wrap items-center gap-2">
                  {activeSubject && (
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: activeSubject.color }}
                    />
                  )}
                  <span className="font-semibold text-[var(--pastel-ink)]">
                    {activeSubject?.name || 'General Study'}
                  </span>
                  {activeCardChapter && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{activeCardChapter.title}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>
                    {PRIORITY_LABELS[currentCard.priority || 'medium']} priority ·{' '}
                    {HARDNESS_LABELS[currentCard.hardness || 'medium']}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <PastelSelect
                    value={currentCard.priority || 'medium'}
                    onChange={(val) =>
                      void updateFlashcardDetails(uid, currentCard.id, {
                        priority: val as PriorityLevel,
                      })
                    }
                    ariaLabel="Card priority"
                    variant="pill"
                    className="min-w-[96px]"
                    options={[
                      { value: 'high', label: 'High Prio' },
                      { value: 'medium', label: 'Mid Prio' },
                      { value: 'low', label: 'Low Prio' },
                    ]}
                  />
                  <span className="font-mono-tabular">
                    Reps {currentCard.repetitions} · Interval {currentCard.intervalDays}d
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  lastFcActivityRef.current = Date.now();
                  if (!fcTimerRunning && fcSeconds === 0) setFcTimerRunning(true);
                  setFlipped((prev) => !prev);
                }}
                className="w-full min-h-[230px] p-8 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] flex flex-col items-center justify-center text-center space-y-4 cursor-pointer hover:bg-[var(--pastel-soft)]/50 transition-colors"
              >
                <span className="text-[11px] uppercase tracking-wider text-[var(--pastel-muted)]">
                  {flipped ? 'Answer' : 'Prompt'}
                </span>
                <p className="text-lg md:text-xl font-bold leading-relaxed max-w-xl whitespace-pre-wrap">
                  {flipped ? currentCard.back : currentCard.front}
                </p>
                <span className="text-xs text-[var(--pastel-muted)] inline-flex items-center gap-1.5 pt-2">
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>{flipped ? 'Click to see prompt' : 'Click to reveal answer'}</span>
                </span>
              </button>

              {flipped ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        label: 'Hard',
                        sub: `${savedIntervals.hardDays} ${savedIntervals.hardDays === 1 ? 'day' : 'days'}`,
                        rating: 'hard' as ReviewRating,
                      },
                      {
                        label: 'Mid',
                        sub: `${savedIntervals.midDays} ${savedIntervals.midDays === 1 ? 'day' : 'days'}`,
                        rating: 'medium' as ReviewRating,
                      },
                      {
                        label: 'Easy',
                        sub: `${savedIntervals.easyDays} ${savedIntervals.easyDays === 1 ? 'day' : 'days'}`,
                        rating: 'easy' as ReviewRating,
                      },
                    ].map((btn) => (
                      <button
                        key={btn.label}
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleGrade(btn.rating)}
                        className="py-3.5 px-4 rounded-2xl border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] transition-colors text-center cursor-pointer disabled:opacity-50"
                      >
                        <div className="text-sm font-extrabold">{btn.label}</div>
                        <div className="text-[11px] font-mono-tabular text-[var(--pastel-muted)]">
                          {customNextDays.trim() ? `${customNextDays}d custom` : btn.sub}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-center gap-2 text-xs text-[var(--pastel-muted)]">
                    <span>Optional custom days override:</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={customNextDays}
                      onChange={(e) => setCustomNextDays(e.target.value)}
                      placeholder="default"
                      className="w-20 px-2.5 py-1 text-xs font-mono-tabular rounded-xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] text-center focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      lastFcActivityRef.current = Date.now();
                      if (!fcTimerRunning && fcSeconds === 0) setFcTimerRunning(true);
                      setFlipped(true);
                    }}
                    className="px-6 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer"
                  >
                    Reveal Answer
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* --- BLURTING TAB --- */
        <div className="space-y-6">
          <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">Blurt from Memory</h2>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Select a Syllabus chapter (auto-loads saved notes) or upload a PDF, write everything you remember while timed, and let AI pinpoint weak spots.
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-[var(--pastel-soft)] rounded-full">
                <button
                  type="button"
                  onClick={() => setBlurtSourceMode('chapter')}
                  className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-colors cursor-pointer ${
                    blurtSourceMode === 'chapter'
                      ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                      : 'text-[var(--pastel-muted)]'
                  }`}
                >
                  Syllabus Chapter
                </button>
                <button
                  type="button"
                  onClick={() => setBlurtSourceMode('pdf_or_text')}
                  className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-colors cursor-pointer ${
                    blurtSourceMode === 'pdf_or_text'
                      ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                      : 'text-[var(--pastel-muted)]'
                  }`}
                >
                  Upload PDF / Notes
                </button>
              </div>
            </div>

            {blurtSourceMode === 'chapter' ? (
              <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--pastel-muted)]">
                      Subject
                    </label>
                    <PastelSelect
                      value={blurtSubjectId}
                      onChange={setBlurtSubjectId}
                      ariaLabel="Blurt subject"
                      variant="field"
                      className="w-full"
                      options={
                        subjects.length === 0
                          ? [{ value: '', label: 'No subjects yet' }]
                          : subjects.map((s) => ({ value: s.id, label: s.name, color: s.color }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--pastel-muted)]">
                      Chapter
                    </label>
                    <PastelSelect
                      value={blurtChapterId}
                      onChange={setBlurtChapterId}
                      ariaLabel="Blurt chapter"
                      variant="field"
                      className="w-full"
                      options={
                        blurtSubjectChapters.length === 0
                          ? [{ value: '', label: 'No chapters in subject' }]
                          : blurtSubjectChapters.map((c) => ({
                              value: c.id,
                              label: `${c.order}. ${c.title}`,
                            }))
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--pastel-muted)]">
                    {effectiveReferenceNotes.length > 0
                      ? `Stored chapter notes ready (${effectiveReferenceNotes.length.toLocaleString()} chars · hidden while recalling)`
                      : 'This chapter has no saved notes yet — add notes in Syllabus or switch to Upload PDF / Notes.'}
                  </span>
                  {effectiveReferenceNotes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPeekNotes((p) => !p)}
                      className="inline-flex items-center gap-1 font-bold text-[var(--pastel-ink)] hover:opacity-75 cursor-pointer"
                    >
                      {peekNotes ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{peekNotes ? 'Hide Notes' : 'Peek Notes'}</span>
                    </button>
                  )}
                </div>

                {peekNotes && effectiveReferenceNotes && (
                  <pre className="p-3 rounded-xl bg-[var(--pastel-surface)] border border-[var(--pastel-border)] text-xs whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                    {effectiveReferenceNotes}
                  </pre>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="px-4 py-2 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)] hover:bg-[var(--pastel-soft)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{pdfExtracting ? 'Extracting PDF...' : 'Upload PDF Reference'}</span>
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(e) => void handleBlurtPdfUpload(e)}
                        className="hidden"
                      />
                    </label>
                    <PastelSelect
                      value={blurtCustomSubjectId}
                      onChange={setBlurtCustomSubjectId}
                      ariaLabel="Optional subject tag"
                      variant="pill"
                      className="min-w-[140px]"
                      options={[
                        { value: '', label: 'General Study' },
                        ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
                      ]}
                    />
                  </div>
                  <input
                    type="text"
                    value={blurtSourceLabel}
                    onChange={(e) => setBlurtSourceLabel(e.target.value)}
                    placeholder="Topic or PDF name..."
                    maxLength={120}
                    className="px-3.5 py-1.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none w-56"
                  />
                </div>

                <textarea
                  rows={4}
                  value={customReferenceNotes}
                  onChange={(e) => setCustomReferenceNotes(e.target.value)}
                  placeholder="Extracted PDF text appears here (or paste reference notes directly)..."
                  className="w-full p-3 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none"
                />
              </div>
            )}

            {/* Timer + Blurt Area */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--pastel-muted)]" />
                  <span className="text-sm font-extrabold font-mono-tabular">
                    {formatClock(blurtSeconds)}
                  </span>
                  <span className="text-xs text-[var(--pastel-muted)]">Active Recall Timer</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBlurtTimerRunning((r) => !r)}
                    className="px-3.5 py-1.5 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {blurtTimerRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{blurtTimerRunning ? 'Pause' : blurtSeconds > 0 ? 'Resume' : 'Start Timer'}</span>
                  </button>
                  {blurtSeconds > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setBlurtTimerRunning(false);
                        setBlurtSeconds(0);
                      }}
                      className="px-3 py-1.5 text-xs text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <textarea
                rows={9}
                value={blurtText}
                onChange={(e) => {
                  if (!blurtTimerRunning && blurtSeconds === 0 && e.target.value.trim().length > 0) {
                    setBlurtTimerRunning(true);
                  }
                  setBlurtText(e.target.value);
                }}
                placeholder="Write everything you can recall from memory without looking at your notes — definitions, steps, mechanisms, formulas, examples..."
                className="w-full p-4 text-sm leading-relaxed rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none resize-y"
              />

              {blurtError && (
                <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50/70 border border-red-200 rounded-2xl p-3">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{blurtError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
                  {blurtText.trim().length.toLocaleString()} characters written
                </span>
                <button
                  type="button"
                  disabled={reviewingBlurt}
                  onClick={() => void handleRunBlurtReview()}
                  className="px-5 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {reviewingBlurt ? 'Analyzing Blurt...' : 'Finish Blurt & AI Review'}
                  </span>
                </button>
              </div>
            </div>
          </section>

          {/* Active AI Blurt Feedback + Weak-Point Flashcard Generator */}
          {activeBlurtResult && (
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-[var(--pastel-muted)]">
                    AI Blurt Review · {activeBlurtResult.sourceLabel}
                  </div>
                  <h3 className="text-lg font-extrabold tracking-tight">
                    Strong &amp; Weak Points
                  </h3>
                </div>
                <span className="text-xs font-mono-tabular font-bold text-[var(--pastel-muted)]">
                  Recorded {formatDurationShort(activeBlurtResult.durationSeconds)} Active Recall
                </span>
              </div>

              {activeBlurtResult.summary && (
                <p className="text-sm leading-relaxed bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] rounded-2xl p-4">
                  {activeBlurtResult.summary}
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Strong Points */}
                <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-2.5">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                    Strong Points ({activeBlurtResult.strongPoints.length})
                  </div>
                  {activeBlurtResult.strongPoints.length === 0 ? (
                    <p className="text-xs text-[var(--pastel-muted)]">None highlighted.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs leading-relaxed list-disc pl-4">
                      {activeBlurtResult.strongPoints.map((pt, i) => (
                        <li key={i}>{pt}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Missed Key Facts */}
                <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-2.5">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-amber-800">
                    Missed Key Facts ({activeBlurtResult.missedKeyFacts.length})
                  </div>
                  {activeBlurtResult.missedKeyFacts.length === 0 ? (
                    <p className="text-xs text-[var(--pastel-muted)]">No major omissions detected.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs leading-relaxed list-disc pl-4">
                      {activeBlurtResult.missedKeyFacts.map((fact, i) => (
                        <li key={i}>{fact}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Weak Points Breakdown */}
              <div className="space-y-2.5">
                <div className="text-xs font-extrabold uppercase tracking-wider text-rose-800">
                  Weak Points to Target ({activeBlurtResult.weakPoints.length})
                </div>
                {activeBlurtResult.weakPoints.length === 0 ? (
                  <p className="text-xs text-[var(--pastel-muted)]">No weak points flagged.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeBlurtResult.weakPoints.map((wp, i) => (
                      <div
                        key={i}
                        className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-1.5"
                      >
                        <div className="text-xs font-extrabold">{wp.topic}</div>
                        <div className="text-xs text-[var(--pastel-muted)] leading-relaxed">
                          {wp.gap}
                        </div>
                        {wp.suggestedReview && (
                          <div className="text-xs font-medium pt-1 border-t border-[var(--pastel-border)]">
                            Review: {wp.suggestedReview}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Generate AI Flashcards for Weak Points */}
              {(activeBlurtResult.weakPoints.length > 0 ||
                activeBlurtResult.missedKeyFacts.length > 0) && (
                <div className="pt-4 border-t border-[var(--pastel-border)] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PastelSelect
                      value={weakCardSubjectId}
                      onChange={setWeakCardSubjectId}
                      ariaLabel="Target subject for weak-point flashcards"
                      variant="pill"
                      className="min-w-[140px]"
                      options={[
                        ...(subjects.length === 0
                          ? [{ value: 'general', label: 'General Study' }]
                          : subjects.map((s) => ({
                              value: s.id,
                              label: s.name,
                              color: s.color,
                            }))),
                      ]}
                    />
                    <PastelSelect
                      value={String(weakCardCount)}
                      onChange={(val) => setWeakCardCount(Number(val))}
                      ariaLabel="Weak-point flashcard count"
                      variant="pill"
                      className="min-w-[96px]"
                      options={[4, 6, 10, 12].map((n) => ({
                        value: String(n),
                        label: `${n} cards`,
                      }))}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={generatingWeakCards}
                      onClick={() => void handleGenerateWeakPointCards(activeBlurtResult)}
                      className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {generatingWeakCards
                          ? 'Creating Cards...'
                          : 'Create AI Flashcards for Weak Points'}
                      </span>
                    </button>

                    {(activeBlurtResult.cardsGeneratedCount || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (weakCardSubjectId && weakCardSubjectId !== 'general') {
                            setSubjectFilter(weakCardSubjectId);
                          }
                          setPracticeAll(true);
                          setReviewTab('flashcards');
                        }}
                        className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold cursor-pointer"
                      >
                        Practice Weak-Point Cards
                      </button>
                    )}
                  </div>
                </div>
              )}

              {weakCardsNotice && (
                <p className="text-xs font-semibold text-emerald-800">{weakCardsNotice}</p>
              )}
            </section>
          )}

          {/* Past Blurt Sessions */}
          {blurtSessions.length > 0 && (
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-extrabold tracking-tight flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[var(--pastel-muted)]" />
                  <span>Past Blurt Sessions ({blurtSessions.length})</span>
                </h3>
              </div>
              <div className="divide-y divide-[var(--pastel-border)]">
                {blurtSessions.slice(0, 10).map((sess) => (
                  <div
                    key={sess.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveBlurtResult(sess);
                        setWeakCardSubjectId(sess.subjectId || subjects[0]?.id || 'general');
                        setWeakCardsNotice(null);
                      }}
                      className="text-left min-w-0 flex-1 space-y-0.5 cursor-pointer hover:opacity-80"
                    >
                      <div className="text-xs font-bold truncate flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-[var(--pastel-muted)] shrink-0" />
                        <span className="truncate">{sess.sourceLabel}</span>
                      </div>
                      <div className="text-[11px] text-[var(--pastel-muted)] font-mono-tabular">
                        {sess.dateKey} · {formatDurationShort(sess.durationSeconds)} ·{' '}
                        {sess.strongPoints.length} strong · {sess.weakPoints.length} weak
                        {(sess.cardsGeneratedCount || 0) > 0
                          ? ` · ${sess.cardsGeneratedCount} cards created`
                          : ''}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (activeBlurtResult?.id === sess.id) setActiveBlurtResult(null);
                        void deleteBlurtSession(uid, sess.id);
                      }}
                      aria-label="Delete blurt session"
                      className="p-1.5 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
