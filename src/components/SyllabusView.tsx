import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ExternalLink,
  Eye,
  FileText,
  Image as ImageIcon,
  Layers,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { extractPdfTextInBrowser } from '../lib/pdfExtract';
import { formatVideoTimestamp, parseVideoDurationInput } from '../lib/spacedRepetition';
import {
  addChapterPhoto,
  createChapter,
  createFlashcardsBatch,
  createSubject,
  deleteChapter,
  deleteChapterPhoto,
  deleteFlashcard,
  deleteSubject,
  updateChapterDetails,
  updateChapterNotesAndPdfs,
  updateChapterRating,
  updateChapterVideos,
  updateFlashcardDetails,
  updateSubjectDetails,
  updateSubjectRating,
} from '../lib/studyRepo';
import { PastelSelect } from './PastelSelect';
import { YouTubeLecturePlayer, extractYouTubeVideoId } from './YouTubeLecturePlayer';
import {
  BLUEPRINT_LIMITS,
  HARDNESS_LABELS,
  HARDNESS_ORDER_WEIGHT,
  PRIORITY_LABELS,
  PRIORITY_ORDER_WEIGHT,
  SUBJECT_COLOR_PALETTE,
  type Chapter,
  type ChapterPhoto,
  type DifficultyLevel,
  type Flashcard,
  type PdfSourceMeta,
  type PriorityLevel,
  type Subject,
  type VideoLecture,
} from '../types/study';

interface SyllabusViewProps {
  uid: string;
  subjects: Subject[];
  chapters: Chapter[];
  flashcards: Flashcard[];
  chapterPhotos: ChapterPhoto[];
}

async function compressChapterPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 960;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported.');
  ctx.drawImage(bitmap, 0, 0, width, height);

  let dataUrl = canvas.toDataURL('image/jpeg', 0.74);
  if (dataUrl.length > BLUEPRINT_LIMITS.PHOTO_DATA_URL_MAX) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.52);
  }
  if (dataUrl.length > BLUEPRINT_LIMITS.PHOTO_DATA_URL_MAX) {
    const smallerCanvas = document.createElement('canvas');
    smallerCanvas.width = Math.max(1, Math.round(width * 0.65));
    smallerCanvas.height = Math.max(1, Math.round(height * 0.65));
    const sCtx = smallerCanvas.getContext('2d');
    if (sCtx) {
      sCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
      dataUrl = smallerCanvas.toDataURL('image/jpeg', 0.55);
    }
  }
  if (dataUrl.length > BLUEPRINT_LIMITS.PHOTO_DATA_URL_MAX) {
    throw new Error('Image is still too large after compression. Try a smaller photo.');
  }
  return dataUrl;
}

export const SyllabusView: React.FC<SyllabusViewProps> = ({
  uid,
  subjects,
  chapters,
  flashcards,
  chapterPhotos,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [chapterSortMode, setChapterSortMode] = useState<'order' | 'priority'>('order');

  // Create Subject form
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [subjName, setSubjName] = useState('');
  const [subjColor, setSubjColor] = useState(SUBJECT_COLOR_PALETTE[1].hex);
  const [subjDesc, setSubjDesc] = useState('');
  const [subjPriority, setSubjPriority] = useState<PriorityLevel>('medium');
  const [subjHardness, setSubjHardness] = useState<DifficultyLevel>('medium');

  // Edit Subject modal
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editSubjName, setEditSubjName] = useState('');
  const [editSubjColor, setEditSubjColor] = useState(SUBJECT_COLOR_PALETTE[1].hex);
  const [editSubjDesc, setEditSubjDesc] = useState('');
  const [editSubjPriority, setEditSubjPriority] = useState<PriorityLevel>('medium');
  const [editSubjHardness, setEditSubjHardness] = useState<DifficultyLevel>('medium');
  const [savingSubjectEdit, setSavingSubjectEdit] = useState(false);
  const [subjectEditError, setSubjectEditError] = useState<string | null>(null);

  // Create Chapter form
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterPriority, setChapterPriority] = useState<PriorityLevel>('medium');
  const [chapterHardness, setChapterHardness] = useState<DifficultyLevel>('medium');

  // Edit Chapter modal
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editChapTitle, setEditChapTitle] = useState('');
  const [editChapOrder, setEditChapOrder] = useState('1');
  const [editChapPriority, setEditChapPriority] = useState<PriorityLevel>('medium');
  const [editChapHardness, setEditChapHardness] = useState<DifficultyLevel>('medium');
  const [savingChapterEdit, setSavingChapterEdit] = useState(false);
  const [chapterEditError, setChapterEditError] = useState<string | null>(null);

  // Chapter workspace state
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  // Video lectures (single + multiple batch attach + progress tracking)
  const [videoBatchMode, setVideoBatchMode] = useState(false);
  const [videoTitle, setVideoTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoTotalInput, setVideoTotalInput] = useState('');
  const [videoBatchText, setVideoBatchText] = useState('');
  const [activeVideoIdx, setActiveVideoIdx] = useState<number | null>(null);
  const [editingVideoIdx, setEditingVideoIdx] = useState<number | null>(null);
  const [editWatchedInput, setEditWatchedInput] = useState('');
  const [editTotalInput, setEditTotalInput] = useState('');

  // PDF.js client-side extraction + AI flashcard/notes generation
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [extractedPayload, setExtractedPayload] = useState<{
    fileName: string;
    pageCount: number;
    text: string;
  } | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [cardCount, setCardCount] = useState(8);

  // Chapter Photos
  const [photoTitleInput, setPhotoTitleInput] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<ChapterPhoto | null>(null);

  // Compact Flashcard creation + View Previous Cards modal
  const [manualFront, setManualFront] = useState('');
  const [manualBack, setManualBack] = useState('');
  const [manualPriority, setManualPriority] = useState<PriorityLevel>('medium');
  const [manualHardness, setManualHardness] = useState<DifficultyLevel>('medium');
  const [cardSavedFlash, setCardSavedFlash] = useState<string | null>(null);
  const [showCardsModal, setShowCardsModal] = useState(false);
  const [cardModalSearch, setCardModalSearch] = useState('');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardFront, setEditCardFront] = useState('');
  const [editCardBack, setEditCardBack] = useState('');
  const [editCardPriority, setEditCardPriority] = useState<PriorityLevel>('medium');
  const [editCardHardness, setEditCardHardness] = useState<DifficultyLevel>('medium');
  const [editCardDays, setEditCardDays] = useState('1');

  const sortedSubjects = useMemo(() => {
    return [...subjects].sort((a, b) => {
      const pDiff =
        PRIORITY_ORDER_WEIGHT[b.priority || 'medium'] -
        PRIORITY_ORDER_WEIGHT[a.priority || 'medium'];
      if (pDiff !== 0) return pDiff;
      return (
        HARDNESS_ORDER_WEIGHT[b.hardness || 'medium'] -
        HARDNESS_ORDER_WEIGHT[a.hardness || 'medium']
      );
    });
  }, [subjects]);

  useEffect(() => {
    if (!selectedSubjectId && sortedSubjects.length > 0) {
      setSelectedSubjectId(sortedSubjects[0].id);
    } else if (selectedSubjectId && !subjects.some((s) => s.id === selectedSubjectId)) {
      setSelectedSubjectId(sortedSubjects[0]?.id || '');
    }
  }, [subjects, sortedSubjects, selectedSubjectId]);

  const subjectChapters = useMemo(() => {
    const filtered = chapters.filter((c) => c.subjectId === selectedSubjectId);
    if (chapterSortMode === 'priority') {
      return [...filtered].sort((a, b) => {
        const pDiff =
          PRIORITY_ORDER_WEIGHT[b.priority || 'medium'] -
          PRIORITY_ORDER_WEIGHT[a.priority || 'medium'];
        if (pDiff !== 0) return pDiff;
        const hDiff =
          HARDNESS_ORDER_WEIGHT[b.hardness || 'medium'] -
          HARDNESS_ORDER_WEIGHT[a.hardness || 'medium'];
        if (hDiff !== 0) return hDiff;
        return a.order - b.order;
      });
    }
    return [...filtered].sort((a, b) => a.order - b.order);
  }, [chapters, selectedSubjectId, chapterSortMode]);

  useEffect(() => {
    if (subjectChapters.length > 0 && !subjectChapters.some((c) => c.id === selectedChapterId)) {
      setSelectedChapterId(subjectChapters[0].id);
    } else if (subjectChapters.length === 0) {
      setSelectedChapterId('');
    }
  }, [subjectChapters, selectedChapterId]);

  const activeSubject = subjects.find((s) => s.id === selectedSubjectId) || null;
  const activeChapter = subjectChapters.find((c) => c.id === selectedChapterId) || null;

  useEffect(() => {
    if (activeChapter) {
      setNotesDraft(activeChapter.notes || '');
      setNotesDirty(false);
      setActiveVideoIdx(null);
      setEditingVideoIdx(null);
      setExtractedPayload(null);
      setPdfStatus(null);
      setPdfError(null);
      setPhotoError(null);
    } else {
      setNotesDraft('');
      setNotesDirty(false);
    }
  }, [activeChapter?.id]);

  const chapterFlashcards = useMemo(() => {
    return flashcards
      .filter((f) => f.chapterId === selectedChapterId)
      .sort((a, b) => {
        const pDiff =
          PRIORITY_ORDER_WEIGHT[b.priority || 'medium'] -
          PRIORITY_ORDER_WEIGHT[a.priority || 'medium'];
        if (pDiff !== 0) return pDiff;
        return (
          HARDNESS_ORDER_WEIGHT[b.hardness || 'medium'] -
          HARDNESS_ORDER_WEIGHT[a.hardness || 'medium']
        );
      });
  }, [flashcards, selectedChapterId]);

  const filteredModalFlashcards = useMemo(() => {
    const q = cardModalSearch.trim().toLowerCase();
    if (!q) return chapterFlashcards;
    return chapterFlashcards.filter(
      (c) => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q),
    );
  }, [chapterFlashcards, cardModalSearch]);

  const currentChapterPhotos = useMemo(
    () => chapterPhotos.filter((p) => p.chapterId === selectedChapterId),
    [chapterPhotos, selectedChapterId],
  );

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjName.trim()) return;
    const newId = await createSubject(uid, {
      name: subjName,
      color: subjColor,
      description: subjDesc,
      priority: subjPriority,
      hardness: subjHardness,
    });
    setSubjName('');
    setSubjDesc('');
    setSubjPriority('medium');
    setSubjHardness('medium');
    setShowAddSubject(false);
    setSelectedSubjectId(newId);
  };

  const startEditSubject = (subject: Subject) => {
    setEditingSubjectId(subject.id);
    setEditSubjName(subject.name);
    setEditSubjColor(subject.color || SUBJECT_COLOR_PALETTE[1].hex);
    setEditSubjDesc(subject.description || '');
    setEditSubjPriority(subject.priority || 'medium');
    setEditSubjHardness(subject.hardness || 'medium');
    setSubjectEditError(null);
  };

  const handleSaveSubjectEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubjectId) return;
    if (!editSubjName.trim()) {
      setSubjectEditError('Subject name cannot be empty.');
      return;
    }
    setSavingSubjectEdit(true);
    setSubjectEditError(null);
    try {
      await updateSubjectDetails(uid, editingSubjectId, {
        name: editSubjName,
        color: editSubjColor,
        description: editSubjDesc,
        priority: editSubjPriority,
        hardness: editSubjHardness,
      });
      setEditingSubjectId(null);
    } catch (err) {
      setSubjectEditError(
        err instanceof Error ? err.message : 'Unable to save subject settings right now.',
      );
    } finally {
      setSavingSubjectEdit(false);
    }
  };

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId || !chapterTitle.trim()) return;
    const nextOrder = subjectChapters.length + 1;
    const newId = await createChapter(uid, {
      subjectId: selectedSubjectId,
      title: chapterTitle,
      order: nextOrder,
      priority: chapterPriority,
      hardness: chapterHardness,
    });
    setChapterTitle('');
    setChapterPriority('medium');
    setChapterHardness('medium');
    setSelectedChapterId(newId);
  };

  const startEditChapter = (chapter: Chapter) => {
    setEditingChapterId(chapter.id);
    setEditChapTitle(chapter.title);
    setEditChapOrder(String(chapter.order ?? 1));
    setEditChapPriority(chapter.priority || 'medium');
    setEditChapHardness(chapter.hardness || 'medium');
    setChapterEditError(null);
  };

  const handleSaveChapterEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChapterId) return;
    if (!editChapTitle.trim()) {
      setChapterEditError('Chapter title cannot be empty.');
      return;
    }
    const parsedOrder = Number(editChapOrder);
    const safeOrder = Number.isFinite(parsedOrder)
      ? Math.max(0, Math.min(10000, Math.round(parsedOrder)))
      : 1;
    setSavingChapterEdit(true);
    setChapterEditError(null);
    try {
      await updateChapterDetails(uid, editingChapterId, {
        title: editChapTitle,
        order: safeOrder,
        priority: editChapPriority,
        hardness: editChapHardness,
      });
      setEditingChapterId(null);
    } catch (err) {
      setChapterEditError(
        err instanceof Error ? err.message : 'Unable to save chapter settings right now.',
      );
    } finally {
      setSavingChapterEdit(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!activeChapter) return;
    setSavingNotes(true);
    try {
      await updateChapterNotesAndPdfs(uid, activeChapter.id, notesDraft, activeChapter.pdfSources || []);
      setNotesDirty(false);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleAddSingleVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChapter || !videoTitle.trim() || !videoUrl.trim()) return;
    const parsedTotal = parseVideoDurationInput(videoTotalInput);
    const nextList: VideoLecture[] = [
      ...(activeChapter.videoLectures || []),
      {
        id: `vid_${Date.now().toString(36)}`,
        title: videoTitle.trim(),
        url: videoUrl.trim(),
        totalSeconds: parsedTotal,
        watchedSeconds: 0,
        lastWatchedAt: '',
      },
    ];
    await updateChapterVideos(uid, activeChapter.id, nextList);
    setVideoTitle('');
    setVideoUrl('');
    setVideoTotalInput('');
  };

  const handleAddBatchVideos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChapter || !videoBatchText.trim()) return;
    const existing = activeChapter.videoLectures || [];
    const lines = videoBatchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const additions: VideoLecture[] = [];
    lines.forEach((line, i) => {
      let title = '';
      let url = line;
      let totalSeconds = 0;

      if (line.includes('|')) {
        const parts = line.split('|').map((p) => p.trim());
        if (parts.length >= 2) {
          title = parts[0];
          url = parts[1];
          if (parts[2]) {
            totalSeconds = parseVideoDurationInput(parts[2]);
          }
        }
      }

      if (!/^https?:\/\//i.test(url)) return;
      if (!title) {
        title = `Lecture ${existing.length + additions.length + 1}`;
      }
      additions.push({
        id: `vid_${Date.now().toString(36)}_${i}`,
        title,
        url,
        totalSeconds,
        watchedSeconds: 0,
        lastWatchedAt: '',
      });
    });

    if (additions.length === 0) return;
    await updateChapterVideos(uid, activeChapter.id, [...existing, ...additions]);
    setVideoBatchText('');
    setVideoBatchMode(false);
  };

  const handleRemoveVideo = async (index: number) => {
    if (!activeChapter) return;
    if (activeVideoIdx === index) setActiveVideoIdx(null);
    if (editingVideoIdx === index) setEditingVideoIdx(null);
    const nextList = (activeChapter.videoLectures || []).filter((_, idx) => idx !== index);
    await updateChapterVideos(uid, activeChapter.id, nextList);
  };

  const handleVideoPlayerProgress = async (
    index: number,
    watchedSeconds: number,
    totalSeconds: number,
  ) => {
    if (!activeChapter) return;
    const currentList = activeChapter.videoLectures || [];
    const target = currentList[index];
    if (!target) return;
    const nextTotal = totalSeconds > 0 ? totalSeconds : target.totalSeconds || 0;
    const nextWatched = nextTotal > 0 ? Math.min(nextTotal, watchedSeconds) : watchedSeconds;
    const nextList = currentList.map((v, i) =>
      i === index
        ? {
            ...v,
            totalSeconds: nextTotal,
            watchedSeconds: nextWatched,
            lastWatchedAt: new Date().toISOString(),
          }
        : v,
    );
    await updateChapterVideos(uid, activeChapter.id, nextList);
  };

  const handleSaveVideoTimestamp = async (index: number) => {
    if (!activeChapter) return;
    const currentList = activeChapter.videoLectures || [];
    const target = currentList[index];
    if (!target) return;
    const watched = parseVideoDurationInput(editWatchedInput);
    const total = editTotalInput.trim()
      ? parseVideoDurationInput(editTotalInput)
      : target.totalSeconds || 0;
    const safeWatched = total > 0 ? Math.min(total, watched) : watched;

    const nextList = currentList.map((v, i) =>
      i === index
        ? {
            ...v,
            totalSeconds: total,
            watchedSeconds: safeWatched,
            lastWatchedAt: new Date().toISOString(),
          }
        : v,
    );
    await updateChapterVideos(uid, activeChapter.id, nextList);
    setEditingVideoIdx(null);
  };

  const handlePdfSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPdfError(null);
    setPdfStatus('Reading PDF locally in browser...');
    try {
      const result = await extractPdfTextInBrowser(file, (page, total) => {
        setPdfStatus(`Extracting text locally: page ${page} of ${total}...`);
      });
      if (result.text.length < 30) {
        setPdfError('Could not extract readable text from this PDF (it may be a scanned image PDF).');
        setPdfStatus(null);
        return;
      }
      setExtractedPayload(result);
      setPdfStatus(
        `Extracted ${result.pageCount} pages (${result.text.length.toLocaleString()} chars) in browser. Ready to generate notes & flashcards.`,
      );
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to extract PDF text.');
      setPdfStatus(null);
    }
  };

  const handleGenerateFromPdf = async () => {
    if (!activeChapter || !activeSubject || !extractedPayload) return;
    setPdfError(null);
    setGeneratingAi(true);
    try {
      const res = await fetch('/api/ai/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractedText: extractedPayload.text,
          subjectName: activeSubject.name,
          chapterTitle: activeChapter.title,
          cardCount,
        }),
      });
      const rawText = await res.text();
      let data: {
        summaryNotes?: string;
        flashcards?: Array<{ front: string; back: string }>;
        error?: string;
      } = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText) as typeof data;
        } catch {
          throw new Error(
            res.ok
              ? 'Received an unexpected response format from AI generator.'
              : `AI generation failed (${res.status}). Please try again.`,
          );
        }
      }
      if (!res.ok) {
        throw new Error(data.error || `Failed to generate study material (${res.status}).`);
      }

      const appendedNotes = [
        notesDraft.trim(),
        data.summaryNotes
          ? `--- Notes from ${extractedPayload.fileName} ---\n${data.summaryNotes.trim()}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, BLUEPRINT_LIMITS.CHAPTER_NOTES_MAX);

      const nextPdfMeta: PdfSourceMeta[] = [
        ...(activeChapter.pdfSources || []).slice(-9),
        {
          fileName: extractedPayload.fileName,
          pageCount: extractedPayload.pageCount,
          extractedAt: new Date().toISOString(),
        },
      ];

      await updateChapterNotesAndPdfs(uid, activeChapter.id, appendedNotes, nextPdfMeta);
      setNotesDraft(appendedNotes);
      setNotesDirty(false);

      if (data.flashcards && data.flashcards.length > 0) {
        await createFlashcardsBatch(
          uid,
          activeSubject.id,
          activeChapter.id,
          data.flashcards.map((c) => ({
            ...c,
            priority: activeChapter.priority || 'medium',
            hardness: activeChapter.hardness || 'medium',
          })),
        );
      }

      setPdfStatus(
        `Saved generated notes and ${data.flashcards?.length ?? 0} flashcards to Firestore (raw PDF not uploaded).`,
      );
      setExtractedPayload(null);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGeneratingAi(false);
    }
  };

  const handlePhotosSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !activeSubject || !activeChapter) return;
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      for (const file of files.slice(0, 6)) {
        const dataUrl = await compressChapterPhoto(file);
        const fallbackTitle = file.name.replace(/\.[^.]+$/, '') || 'Chapter Photo';
        await addChapterPhoto(uid, {
          subjectId: activeSubject.id,
          chapterId: activeChapter.id,
          title: photoTitleInput.trim() || fallbackTitle,
          dataUrl,
        });
      }
      setPhotoTitleInput('');
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not attach image.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleAddManualCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSubject || !activeChapter || !manualFront.trim() || !manualBack.trim()) return;
    await createFlashcardsBatch(uid, activeSubject.id, activeChapter.id, [
      {
        front: manualFront.trim(),
        back: manualBack.trim(),
        priority: manualPriority,
        hardness: manualHardness,
      },
    ]);
    setManualFront('');
    setManualBack('');
    setCardSavedFlash('Card added');
    window.setTimeout(() => setCardSavedFlash(null), 1800);
  };

  const startEditCard = (card: Flashcard) => {
    setEditingCardId(card.id);
    setEditCardFront(card.front);
    setEditCardBack(card.back);
    setEditCardPriority(card.priority || 'medium');
    setEditCardHardness(card.hardness || 'medium');
    setEditCardDays(String(Math.max(1, card.intervalDays || 1)));
  };

  const saveEditCard = async (cardId: string) => {
    if (!editCardFront.trim() || !editCardBack.trim()) return;
    await updateFlashcardDetails(uid, cardId, {
      front: editCardFront,
      back: editCardBack,
      priority: editCardPriority,
      hardness: editCardHardness,
      intervalDays: Math.max(1, Number(editCardDays) || 1),
    });
    setEditingCardId(null);
  };

  const activeVideo =
    activeVideoIdx !== null ? (activeChapter?.videoLectures || [])[activeVideoIdx] || null : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Syllabus &amp; Material</h1>
          <p className="text-sm text-[var(--pastel-muted)]">
            Prioritize subjects and chapters, attach lecture videos with watched progress, upload PDFs &amp; photos, and manage compact flashcards.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddSubject((prev) => !prev)}
          className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{showAddSubject ? 'Close' : 'New Subject'}</span>
        </button>
      </div>

      {showAddSubject && (
        <form
          onSubmit={handleCreateSubject}
          className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              type="text"
              required
              value={subjName}
              onChange={(e) => setSubjName(e.target.value)}
              placeholder="Subject name (e.g., Cell Biology)"
              maxLength={100}
              className="md:col-span-4 px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
            <input
              type="text"
              value={subjDesc}
              onChange={(e) => setSubjDesc(e.target.value)}
              placeholder="Short syllabus goal or course code (optional)"
              maxLength={400}
              className="md:col-span-4 px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
            <PastelSelect
              value={subjPriority}
              onChange={(val) => setSubjPriority(val as PriorityLevel)}
              ariaLabel="Subject priority"
              variant="field"
              className="md:col-span-2 w-full"
              options={[
                { value: 'high', label: 'High Priority' },
                { value: 'medium', label: 'Mid Priority' },
                { value: 'low', label: 'Low Priority' },
              ]}
            />
            <PastelSelect
              value={subjHardness}
              onChange={(val) => setSubjHardness(val as DifficultyLevel)}
              ariaLabel="Subject hardness"
              variant="field"
              className="md:col-span-2 w-full"
              options={[
                { value: 'hard', label: 'Hard' },
                { value: 'medium', label: 'Mid Hardness' },
                { value: 'easy', label: 'Easy' },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--pastel-muted)] mr-1">Color code:</span>
              {SUBJECT_COLOR_PALETTE.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  onClick={() => setSubjColor(swatch.hex)}
                  aria-label={swatch.name}
                  className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                    subjColor === swatch.hex ? 'ring-2 ring-offset-2 ring-[var(--pastel-ink)] scale-110' : ''
                  }`}
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
              <input
                type="color"
                value={subjColor}
                onChange={(e) => setSubjColor(e.target.value)}
                aria-label="Custom subject color"
                className="w-7 h-7 rounded-full cursor-pointer border-0 bg-transparent"
              />
            </div>

            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer"
            >
              Save Subject
            </button>
          </div>
        </form>
      )}

      {subjects.length === 0 ? (
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-10 text-center space-y-3">
          <BookOpen className="w-6 h-6 mx-auto text-[var(--pastel-muted)]" />
          <p className="text-sm font-bold">Create your first color-coded subject</p>
          <p className="text-xs text-[var(--pastel-muted)] max-w-md mx-auto">
            Add subjects like Mathematics, Literature, or Biology to organize chapters, lecture videos, photos, notes, and flashcards.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Subjects + Chapters */}
          <aside className="lg:col-span-4 space-y-6">
            <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-2.5">
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-xs font-bold text-[var(--pastel-muted)]">
                  Subjects ({sortedSubjects.length})
                </span>
                <span className="text-[11px] text-[var(--pastel-muted)]">By priority</span>
              </div>
              {sortedSubjects.map((s) => {
                const active = s.id === selectedSubjectId;
                const sPrio: PriorityLevel = s.priority || 'medium';
                const sHard: DifficultyLevel = s.hardness || 'medium';
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl transition-colors ${
                      active ? 'bg-[var(--pastel-soft)]' : 'hover:bg-[var(--pastel-canvas)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSubjectId(s.id)}
                      className="flex items-center gap-2.5 text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{s.name}</div>
                        <div className="text-[11px] text-[var(--pastel-muted)]">
                          {PRIORITY_LABELS[sPrio]} priority · {HARDNESS_LABELS[sHard]}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditSubject(s)}
                        aria-label={`Edit ${s.name} settings`}
                        title="Edit subject settings"
                        className="p-1 text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] cursor-pointer shrink-0"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSubject(uid, s.id)}
                        aria-label={`Delete ${s.name}`}
                        className="p-1 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {activeSubject && (
                <div className="pt-2.5 mt-2 border-t border-[var(--pastel-border)] space-y-2 px-1">
                  {activeSubject.description && (
                    <p className="text-[11px] text-[var(--pastel-muted)] leading-snug">
                      {activeSubject.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => startEditSubject(activeSubject)}
                      className="text-[11px] font-bold text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] inline-flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <PastelSelect
                        value={activeSubject.priority || 'medium'}
                        onChange={(val) =>
                          void updateSubjectRating(
                            uid,
                            activeSubject.id,
                            val as PriorityLevel,
                            activeSubject.hardness || 'medium',
                          )
                        }
                        ariaLabel="Selected subject priority"
                        variant="pill"
                        className="min-w-[96px]"
                        options={[
                          { value: 'high', label: 'High Prio' },
                          { value: 'medium', label: 'Mid Prio' },
                          { value: 'low', label: 'Low Prio' },
                        ]}
                      />
                      <PastelSelect
                        value={activeSubject.hardness || 'medium'}
                        onChange={(val) =>
                          void updateSubjectRating(
                            uid,
                            activeSubject.id,
                            activeSubject.priority || 'medium',
                            val as DifficultyLevel,
                          )
                        }
                        ariaLabel="Selected subject hardness"
                        variant="pill"
                        className="min-w-[82px]"
                        options={[
                          { value: 'hard', label: 'Hard' },
                          { value: 'medium', label: 'Mid' },
                          { value: 'easy', label: 'Easy' },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {activeSubject && (
              <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-xs font-bold text-[var(--pastel-muted)] truncate">
                    Chapters · {activeSubject.name}
                  </span>
                  <PastelSelect
                    value={chapterSortMode}
                    onChange={(val) => setChapterSortMode(val as 'order' | 'priority')}
                    ariaLabel="Sort chapters"
                    variant="pill"
                    align="right"
                    className="min-w-[110px]"
                    options={[
                      { value: 'order', label: 'Chapter Order' },
                      { value: 'priority', label: 'Priority First' },
                    ]}
                  />
                </div>

                <form onSubmit={handleCreateChapter} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={chapterTitle}
                      onChange={(e) => setChapterTitle(e.target.value)}
                      placeholder="Add chapter..."
                      maxLength={160}
                      className="flex-1 px-4 py-2 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!chapterTitle.trim()}
                      className="w-9 h-9 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
                      aria-label="Add chapter"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <PastelSelect
                      value={chapterPriority}
                      onChange={(val) => setChapterPriority(val as PriorityLevel)}
                      ariaLabel="New chapter priority"
                      variant="pill"
                      className="w-full"
                      options={[
                        { value: 'high', label: 'High Priority' },
                        { value: 'medium', label: 'Mid Priority' },
                        { value: 'low', label: 'Low Priority' },
                      ]}
                    />
                    <PastelSelect
                      value={chapterHardness}
                      onChange={(val) => setChapterHardness(val as DifficultyLevel)}
                      ariaLabel="New chapter hardness"
                      variant="pill"
                      className="w-full"
                      options={[
                        { value: 'hard', label: 'Hard' },
                        { value: 'medium', label: 'Mid Hardness' },
                        { value: 'easy', label: 'Easy' },
                      ]}
                    />
                  </div>
                </form>

                <div className="space-y-1">
                  {subjectChapters.length === 0 ? (
                    <p className="py-4 text-xs text-[var(--pastel-muted)] text-center">
                      No chapters yet.
                    </p>
                  ) : (
                    subjectChapters.map((ch) => {
                      const cPrio: PriorityLevel = ch.priority || 'medium';
                      const cHard: DifficultyLevel = ch.hardness || 'medium';
                      return (
                        <div
                          key={ch.id}
                          className={`py-2.5 px-3.5 flex items-center justify-between gap-2 rounded-2xl transition-colors ${
                            ch.id === selectedChapterId
                              ? 'bg-[var(--pastel-soft)]'
                              : 'hover:bg-[var(--pastel-canvas)]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedChapterId(ch.id)}
                            className="text-left min-w-0 flex-1 cursor-pointer"
                          >
                            <div className="text-xs font-semibold truncate">
                              {String(ch.order).padStart(2, '0')}. {ch.title}
                            </div>
                            <div className="text-[10px] text-[var(--pastel-muted)]">
                              {PRIORITY_LABELS[cPrio]} · {HARDNESS_LABELS[cHard]}
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditChapter(ch)}
                              aria-label={`Edit ${ch.title} settings`}
                              title="Edit chapter settings"
                              className="p-1 text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] cursor-pointer shrink-0"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteChapter(uid, ch.id)}
                              aria-label={`Delete ${ch.title}`}
                              className="p-1 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </aside>

          {/* Right Column: Chapter Workspace */}
          <main className="lg:col-span-8 space-y-6">
            {!activeChapter ? (
              <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-10 text-center space-y-2">
                <p className="text-sm font-bold">Select or add a chapter</p>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Each chapter stores your notes, lecture videos, photos, PDFs, and compact flashcards.
                </p>
              </div>
            ) : (
              <>
                {/* Chapter Notes, PDF.js Extraction & Photos */}
                <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-[var(--pastel-muted)] flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: activeSubject?.color }}
                        />
                        <span>{activeSubject?.name}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-extrabold tracking-tight">{activeChapter.title}</h2>
                        <button
                          type="button"
                          onClick={() => startEditChapter(activeChapter)}
                          aria-label="Edit chapter settings"
                          className="px-2.5 py-1 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-[11px] font-bold text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <PastelSelect
                        value={activeChapter.priority || 'medium'}
                        onChange={(val) =>
                          void updateChapterRating(
                            uid,
                            activeChapter.id,
                            val as PriorityLevel,
                            activeChapter.hardness || 'medium',
                          )
                        }
                        ariaLabel="Chapter priority"
                        variant="pill"
                        className="min-w-[104px]"
                        options={[
                          { value: 'high', label: 'High Priority' },
                          { value: 'medium', label: 'Mid Priority' },
                          { value: 'low', label: 'Low Priority' },
                        ]}
                      />
                      <PastelSelect
                        value={activeChapter.hardness || 'medium'}
                        onChange={(val) =>
                          void updateChapterRating(
                            uid,
                            activeChapter.id,
                            activeChapter.priority || 'medium',
                            val as DifficultyLevel,
                          )
                        }
                        ariaLabel="Chapter hardness"
                        variant="pill"
                        className="min-w-[84px]"
                        options={[
                          { value: 'hard', label: 'Hard' },
                          { value: 'medium', label: 'Mid' },
                          { value: 'easy', label: 'Easy' },
                        ]}
                      />
                      <button
                        type="button"
                        disabled={!notesDirty || savingNotes}
                        onClick={() => void handleSaveNotes()}
                        className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-45 whitespace-nowrap"
                      >
                        {savingNotes ? 'Saving...' : notesDirty ? 'Save Notes' : 'Notes Saved'}
                      </button>
                    </div>
                  </div>

                  {/* PDF.js Local Extraction + Photos side by side */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* PDF block */}
                    <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-3 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-[var(--pastel-muted)]" />
                            <span>PDF Study Material</span>
                          </div>
                          <label className="px-3.5 py-1.5 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)] hover:bg-[var(--pastel-soft)] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                            <Upload className="w-3.5 h-3.5" />
                            <span>Select PDF</span>
                            <input
                              type="file"
                              accept="application/pdf,.pdf"
                              onChange={(e) => void handlePdfSelected(e)}
                              className="hidden"
                            />
                          </label>
                        </div>
                        <p className="text-[11px] text-[var(--pastel-muted)] leading-relaxed">
                          Extracted locally in browser with PDF.js. Turn slides or chapters into summary notes &amp; flashcards.
                        </p>
                      </div>

                      {pdfStatus && <p className="text-xs text-[var(--pastel-ink)]">{pdfStatus}</p>}
                      {pdfError && <p className="text-xs text-red-700">{pdfError}</p>}

                      {extractedPayload && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--pastel-border)]">
                          <PastelSelect
                            value={String(cardCount)}
                            onChange={(val) => setCardCount(Number(val))}
                            ariaLabel="Number of flashcards to generate"
                            variant="pill"
                            className="min-w-[96px]"
                            options={[5, 8, 12, 16].map((n) => ({
                              value: String(n),
                              label: `${n} cards`,
                            }))}
                          />
                          <button
                            type="button"
                            disabled={generatingAi}
                            onClick={() => void handleGenerateFromPdf()}
                            className="px-3.5 py-1.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{generatingAi ? 'Generating...' : 'Generate Cards'}</span>
                          </button>
                        </div>
                      )}

                      {(activeChapter.pdfSources || []).length > 0 && (
                        <div className="text-[11px] text-[var(--pastel-muted)] pt-1">
                          PDFs:{' '}
                          {(activeChapter.pdfSources || [])
                            .map((p) => `${p.fileName} (${p.pageCount}p)`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>

                    {/* Photos block */}
                    <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-3 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold flex items-center gap-1.5">
                            <ImageIcon className="w-3.5 h-3.5 text-[var(--pastel-muted)]" />
                            <span>Chapter Photos ({currentChapterPhotos.length})</span>
                          </div>
                          <label className="px-3.5 py-1.5 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)] hover:bg-[var(--pastel-soft)] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                            <Upload className="w-3.5 h-3.5" />
                            <span>{uploadingPhoto ? 'Adding...' : 'Add Photos'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              disabled={uploadingPhoto}
                              onChange={(e) => void handlePhotosSelected(e)}
                              className="hidden"
                            />
                          </label>
                        </div>
                        <input
                          type="text"
                          value={photoTitleInput}
                          onChange={(e) => setPhotoTitleInput(e.target.value)}
                          placeholder="Optional caption before selecting photos..."
                          maxLength={120}
                          className="w-full px-3 py-1.5 text-xs rounded-xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none"
                        />
                      </div>

                      {photoError && <p className="text-xs text-red-700">{photoError}</p>}

                      {currentChapterPhotos.length === 0 ? (
                        <p className="text-[11px] text-[var(--pastel-muted)]">
                          Attach handwritten diagrams, whiteboard snaps, or formula sheets.
                        </p>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 pt-1">
                          {currentChapterPhotos.map((photo) => (
                            <div
                              key={photo.id}
                              className="group relative rounded-xl overflow-hidden border border-[var(--pastel-border)] bg-[var(--pastel-surface)] aspect-square"
                            >
                              <button
                                type="button"
                                onClick={() => setLightboxPhoto(photo)}
                                className="w-full h-full cursor-pointer block"
                                title={photo.title}
                              >
                                <img
                                  src={photo.dataUrl}
                                  alt={photo.title}
                                  className="w-full h-full object-cover"
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteChapterPhoto(uid, photo.id)}
                                aria-label={`Delete ${photo.title}`}
                                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/65 text-white flex items-center justify-center opacity-85 hover:opacity-100 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Notes Editor */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pastel-muted)]">
                      Chapter Notes (used automatically when blurting this chapter)
                    </label>
                    <textarea
                      rows={8}
                      value={notesDraft}
                      onChange={(e) => {
                        setNotesDraft(e.target.value);
                        setNotesDirty(true);
                      }}
                      placeholder="Write chapter summaries, formulas, or key definitions here..."
                      className="w-full p-4 text-sm leading-relaxed rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none resize-y"
                    />
                  </div>
                </section>

                {/* Video Lectures (Multiple YouTube links + Total Length & Watched Till) */}
                <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-[var(--pastel-muted)]" />
                      <div>
                        <h3 className="text-base font-extrabold tracking-tight">
                          Video Lectures ({(activeChapter.videoLectures || []).length})
                        </h3>
                        <p className="text-xs text-[var(--pastel-muted)]">
                          Attach multiple YouTube lectures and resume right from where you left off.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setVideoBatchMode((prev) => !prev)}
                      className="px-3.5 py-1.5 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold cursor-pointer"
                    >
                      {videoBatchMode ? 'Single Video Form' : 'Add Multiple URLs'}
                    </button>
                  </div>

                  {videoBatchMode ? (
                    <form onSubmit={handleAddBatchVideos} className="space-y-2.5">
                      <textarea
                        rows={4}
                        value={videoBatchText}
                        onChange={(e) => setVideoBatchText(e.target.value)}
                        placeholder={
                          'Paste one YouTube link per line (optional title & length with |):\nPart 1 Membranes | https://youtube.com/watch?v=... | 1:00:00\nhttps://youtu.be/...'
                        }
                        className="w-full p-3.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={!videoBatchText.trim()}
                          className="py-2 px-5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer disabled:opacity-45"
                        >
                          Attach All Videos
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form
                      onSubmit={handleAddSingleVideo}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2.5"
                    >
                      <input
                        type="text"
                        required
                        value={videoTitle}
                        onChange={(e) => setVideoTitle(e.target.value)}
                        placeholder="Lecture title"
                        maxLength={160}
                        className="sm:col-span-4 px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                      />
                      <input
                        type="url"
                        required
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        placeholder="https://youtube.com/watch?v=..."
                        maxLength={500}
                        className="sm:col-span-4 px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                      />
                      <input
                        type="text"
                        value={videoTotalInput}
                        onChange={(e) => setVideoTotalInput(e.target.value)}
                        placeholder="Length (1:00:00 or 60)"
                        maxLength={20}
                        className="sm:col-span-2 px-3 py-2.5 text-xs font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="sm:col-span-2 py-2.5 px-4 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer whitespace-nowrap"
                      >
                        Attach
                      </button>
                    </form>
                  )}

                  {(activeChapter.videoLectures || []).length > 0 && (
                    <div className="divide-y divide-[var(--pastel-border)]">
                      {(activeChapter.videoLectures || []).map((vid, idx) => {
                        const isYouTube = Boolean(extractYouTubeVideoId(vid.url));
                        const totalSec = vid.totalSeconds || 0;
                        const watchedSec = vid.watchedSeconds || 0;
                        const progressPct =
                          totalSec > 0
                            ? Math.min(100, Math.round((watchedSec / totalSec) * 100))
                            : 0;
                        const isPlayingThis = activeVideoIdx === idx;
                        const isEditingTime = editingVideoIdx === idx;

                        return (
                          <div key={vid.id || `${vid.url}-${idx}`} className="py-3 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="text-sm font-semibold truncate">{vid.title}</div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--pastel-muted)] font-mono-tabular">
                                  <span>
                                    Total length:{' '}
                                    <strong className="text-[var(--pastel-ink)]">
                                      {totalSec > 0 ? formatVideoTimestamp(totalSec) : 'Auto on play'}
                                    </strong>
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    Watched till:{' '}
                                    <strong className="text-[var(--pastel-ink)]">
                                      {formatVideoTimestamp(watchedSec)}
                                    </strong>
                                  </span>
                                  {totalSec > 0 && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>{progressPct}%</span>
                                    </>
                                  )}
                                </div>
                                {totalSec > 0 && (
                                  <div className="h-1.5 max-w-sm rounded-full bg-[var(--pastel-soft)] overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-[var(--pastel-accent)] transition-all"
                                      style={{ width: `${progressPct}%` }}
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                {isYouTube && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveVideoIdx((prev) => (prev === idx ? null : idx))
                                    }
                                    className={`px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1 cursor-pointer ${
                                      isPlayingThis
                                        ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                                        : 'border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)]'
                                    }`}
                                  >
                                    <Play className="w-3 h-3" />
                                    <span>
                                      {isPlayingThis
                                        ? 'Hide Player'
                                        : watchedSec > 0
                                          ? `Resume ${formatVideoTimestamp(watchedSec)}`
                                          : 'Watch'}
                                    </span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isEditingTime) {
                                      setEditingVideoIdx(null);
                                    } else {
                                      setEditingVideoIdx(idx);
                                      setEditWatchedInput(formatVideoTimestamp(watchedSec));
                                      setEditTotalInput(
                                        totalSec > 0 ? formatVideoTimestamp(totalSec) : '',
                                      );
                                    }
                                  }}
                                  className="px-3 py-1.5 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-semibold cursor-pointer"
                                >
                                  {isEditingTime ? 'Cancel' : 'Update Time'}
                                </button>

                                <a
                                  href={vid.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]"
                                  aria-label="Open lecture link"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveVideo(idx)}
                                  aria-label="Remove video lecture"
                                  className="p-1.5 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {isEditingTime && (
                              <div className="p-3 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] flex flex-wrap items-end gap-2.5">
                                <div className="space-y-1">
                                  <label className="block text-[11px] text-[var(--pastel-muted)]">
                                    Watched till (mm:ss, hh:mm:ss, or mins)
                                  </label>
                                  <input
                                    type="text"
                                    value={editWatchedInput}
                                    onChange={(e) => setEditWatchedInput(e.target.value)}
                                    placeholder="e.g. 25:35 or 55"
                                    className="px-3 py-1.5 text-xs font-mono-tabular rounded-xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none w-40"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-[11px] text-[var(--pastel-muted)]">
                                    Total length
                                  </label>
                                  <input
                                    type="text"
                                    value={editTotalInput}
                                    onChange={(e) => setEditTotalInput(e.target.value)}
                                    placeholder="e.g. 1:00:00"
                                    className="px-3 py-1.5 text-xs font-mono-tabular rounded-xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none w-32"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveVideoTimestamp(idx)}
                                  className="px-4 py-1.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer"
                                >
                                  Save Progress
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {activeVideo && activeVideoIdx !== null && (
                    <YouTubeLecturePlayer
                      title={activeVideo.title}
                      url={activeVideo.url}
                      initialWatchedSeconds={activeVideo.watchedSeconds || 0}
                      initialTotalSeconds={activeVideo.totalSeconds || 0}
                      onProgressChange={(watched, total) =>
                        void handleVideoPlayerProgress(activeVideoIdx, watched, total)
                      }
                    />
                  )}
                </section>

                {/* Compact Chapter Flashcards */}
                <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[var(--pastel-muted)]" />
                      <div>
                        <h3 className="text-base font-extrabold tracking-tight">
                          Chapter Flashcards ({chapterFlashcards.length})
                        </h3>
                        <p className="text-xs text-[var(--pastel-muted)]">
                          Compact quick-add deck. Rate priority &amp; hardness or inspect saved cards in one place.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowCardsModal(true)}
                      className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Previous Cards ({chapterFlashcards.length})</span>
                    </button>
                  </div>

                  <form onSubmit={handleAddManualCard} className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        required
                        value={manualFront}
                        onChange={(e) => setManualFront(e.target.value)}
                        placeholder="Front (Question / Concept)"
                        maxLength={1000}
                        className="px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                      />
                      <input
                        type="text"
                        required
                        value={manualBack}
                        onChange={(e) => setManualBack(e.target.value)}
                        placeholder="Back (Answer / Definition)"
                        maxLength={2000}
                        className="px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <PastelSelect
                          value={manualPriority}
                          onChange={(val) => setManualPriority(val as PriorityLevel)}
                          ariaLabel="Flashcard priority"
                          variant="pill"
                          className="min-w-[116px]"
                          options={[
                            { value: 'high', label: 'High Priority' },
                            { value: 'medium', label: 'Mid Priority' },
                            { value: 'low', label: 'Low Priority' },
                          ]}
                        />
                        <PastelSelect
                          value={manualHardness}
                          onChange={(val) => setManualHardness(val as DifficultyLevel)}
                          ariaLabel="Flashcard hardness"
                          variant="pill"
                          className="min-w-[96px]"
                          options={[
                            { value: 'hard', label: 'Hard' },
                            { value: 'medium', label: 'Mid' },
                            { value: 'easy', label: 'Easy' },
                          ]}
                        />
                        {cardSavedFlash && (
                          <span className="text-xs font-semibold text-[var(--pastel-muted)]">
                            {cardSavedFlash}
                          </span>
                        )}
                      </div>

                      <button
                        type="submit"
                        className="py-2 px-5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer whitespace-nowrap"
                      >
                        Add Card
                      </button>
                    </div>
                  </form>
                </section>
              </>
            )}
          </main>
        </div>
      )}

      {/* Compact View Previous Cards Modal */}
      {showCardsModal && activeChapter && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[85vh] bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl shadow-xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-[var(--pastel-border)] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold tracking-tight">
                  {activeChapter.title} · Cards ({chapterFlashcards.length})
                </h3>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Inspect, edit priority/hardness, or adjust interval days.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCardsModal(false);
                  setEditingCardId(null);
                }}
                className="p-2 rounded-full hover:bg-[var(--pastel-soft)] text-[var(--pastel-muted)] cursor-pointer"
                aria-label="Close cards modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 pt-4">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[var(--pastel-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={cardModalSearch}
                  onChange={(e) => setCardModalSearch(e.target.value)}
                  placeholder="Search question or answer..."
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                />
              </div>
            </div>

            <div className="p-5 overflow-y-auto divide-y divide-[var(--pastel-border)]">
              {filteredModalFlashcards.length === 0 ? (
                <p className="py-8 text-center text-xs text-[var(--pastel-muted)]">
                  No saved flashcards in this chapter yet.
                </p>
              ) : (
                filteredModalFlashcards.map((card) => {
                  const isEditing = editingCardId === card.id;
                  const cPrio: PriorityLevel = card.priority || 'medium';
                  const cHard: DifficultyLevel = card.hardness || 'medium';

                  if (isEditing) {
                    return (
                      <div key={card.id} className="py-3.5 space-y-2.5">
                        <input
                          type="text"
                          value={editCardFront}
                          onChange={(e) => setEditCardFront(e.target.value)}
                          placeholder="Front"
                          className="w-full px-3.5 py-2 text-xs rounded-xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                        />
                        <textarea
                          rows={2}
                          value={editCardBack}
                          onChange={(e) => setEditCardBack(e.target.value)}
                          placeholder="Back"
                          className="w-full px-3.5 py-2 text-xs rounded-xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <PastelSelect
                              value={editCardPriority}
                              onChange={(val) => setEditCardPriority(val as PriorityLevel)}
                              ariaLabel="Edit priority"
                              variant="pill"
                              className="min-w-[100px]"
                              options={[
                                { value: 'high', label: 'High Prio' },
                                { value: 'medium', label: 'Mid Prio' },
                                { value: 'low', label: 'Low Prio' },
                              ]}
                            />
                            <PastelSelect
                              value={editCardHardness}
                              onChange={(val) => setEditCardHardness(val as DifficultyLevel)}
                              ariaLabel="Edit hardness"
                              variant="pill"
                              className="min-w-[82px]"
                              options={[
                                { value: 'hard', label: 'Hard' },
                                { value: 'medium', label: 'Mid' },
                                { value: 'easy', label: 'Easy' },
                              ]}
                            />
                            <label className="flex items-center gap-1 text-[11px] text-[var(--pastel-muted)]">
                              <span>Next in</span>
                              <input
                                type="number"
                                min={1}
                                max={365}
                                value={editCardDays}
                                onChange={(e) => setEditCardDays(e.target.value)}
                                className="w-14 px-2 py-1 text-xs font-mono-tabular rounded-xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] text-center"
                              />
                              <span>d</span>
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingCardId(null)}
                              className="px-3 py-1.5 text-xs font-semibold text-[var(--pastel-muted)] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveEditCard(card.id)}
                              className="px-4 py-1.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={card.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-bold">{card.front}</div>
                        <div className="text-xs text-[var(--pastel-muted)] leading-relaxed">
                          {card.back}
                        </div>
                        <div className="text-[11px] text-[var(--pastel-muted)] font-mono-tabular">
                          {PRIORITY_LABELS[cPrio]} priority · {HARDNESS_LABELS[cHard]} · Next:{' '}
                          {card.intervalDays}d
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditCard(card)}
                          aria-label="Edit flashcard"
                          className="p-1.5 text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteFlashcard(uid, card.id)}
                          aria-label="Delete flashcard"
                          className="p-1.5 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Subject Settings Modal */}
      {editingSubjectId && (
        <div
          className="fixed inset-0 z-50 bg-black/35 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingSubjectId(null)}
        >
          <form
            onSubmit={handleSaveSubjectEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl shadow-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold tracking-tight">Edit Subject Settings</h3>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Update subject name, syllabus goal, color code, priority, or hardness.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSubjectId(null)}
                className="p-2 rounded-full hover:bg-[var(--pastel-soft)] text-[var(--pastel-muted)] cursor-pointer"
                aria-label="Close edit subject modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-bold text-[var(--pastel-muted)]">Subject Name</span>
                <input
                  type="text"
                  required
                  value={editSubjName}
                  onChange={(e) => setEditSubjName(e.target.value)}
                  placeholder="Subject name"
                  maxLength={BLUEPRINT_LIMITS.SUBJECT_NAME_MAX}
                  className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold text-[var(--pastel-muted)]">
                  Short Syllabus Goal / Course Code
                </span>
                <input
                  type="text"
                  value={editSubjDesc}
                  onChange={(e) => setEditSubjDesc(e.target.value)}
                  placeholder="Optional goal or course code"
                  maxLength={BLUEPRINT_LIMITS.SUBJECT_DESC_MAX}
                  className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-bold text-[var(--pastel-muted)]">Priority</span>
                  <PastelSelect
                    value={editSubjPriority}
                    onChange={(val) => setEditSubjPriority(val as PriorityLevel)}
                    ariaLabel="Edit subject priority"
                    variant="field"
                    className="w-full"
                    options={[
                      { value: 'high', label: 'High Priority' },
                      { value: 'medium', label: 'Mid Priority' },
                      { value: 'low', label: 'Low Priority' },
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-bold text-[var(--pastel-muted)]">Hardness</span>
                  <PastelSelect
                    value={editSubjHardness}
                    onChange={(val) => setEditSubjHardness(val as DifficultyLevel)}
                    ariaLabel="Edit subject hardness"
                    variant="field"
                    className="w-full"
                    options={[
                      { value: 'hard', label: 'Hard' },
                      { value: 'medium', label: 'Mid Hardness' },
                      { value: 'easy', label: 'Easy' },
                    ]}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-bold text-[var(--pastel-muted)]">Color Code</span>
                <div className="flex flex-wrap items-center gap-2">
                  {SUBJECT_COLOR_PALETTE.map((swatch) => (
                    <button
                      key={swatch.hex}
                      type="button"
                      onClick={() => setEditSubjColor(swatch.hex)}
                      aria-label={swatch.name}
                      className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                        editSubjColor === swatch.hex
                          ? 'ring-2 ring-offset-2 ring-[var(--pastel-ink)] scale-110'
                          : ''
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  ))}
                  <input
                    type="color"
                    value={editSubjColor}
                    onChange={(e) => setEditSubjColor(e.target.value)}
                    aria-label="Custom edit subject color"
                    className="w-7 h-7 rounded-full cursor-pointer border-0 bg-transparent"
                  />
                </div>
              </div>
            </div>

            {subjectEditError && (
              <p className="text-xs font-bold text-red-700">{subjectEditError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingSubjectId(null)}
                className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingSubjectEdit || !editSubjName.trim()}
                className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                {savingSubjectEdit ? 'Saving...' : 'Save Subject Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Chapter Settings Modal */}
      {editingChapterId && (
        <div
          className="fixed inset-0 z-50 bg-black/35 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingChapterId(null)}
        >
          <form
            onSubmit={handleSaveChapterEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl shadow-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold tracking-tight">Edit Chapter Settings</h3>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Adjust chapter title, sequence order, priority, and hardness.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingChapterId(null)}
                className="p-2 rounded-full hover:bg-[var(--pastel-soft)] text-[var(--pastel-muted)] cursor-pointer"
                aria-label="Close edit chapter modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-bold text-[var(--pastel-muted)]">Chapter Title</span>
                <input
                  type="text"
                  required
                  value={editChapTitle}
                  onChange={(e) => setEditChapTitle(e.target.value)}
                  placeholder="Chapter title"
                  maxLength={BLUEPRINT_LIMITS.CHAPTER_TITLE_MAX}
                  className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-3 gap-2.5">
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-[var(--pastel-muted)]">Order #</span>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={editChapOrder}
                    onChange={(e) => setEditChapOrder(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                  />
                </label>
                <div className="space-y-1">
                  <span className="text-xs font-bold text-[var(--pastel-muted)]">Priority</span>
                  <PastelSelect
                    value={editChapPriority}
                    onChange={(val) => setEditChapPriority(val as PriorityLevel)}
                    ariaLabel="Edit chapter priority"
                    variant="field"
                    className="w-full"
                    options={[
                      { value: 'high', label: 'High' },
                      { value: 'medium', label: 'Mid' },
                      { value: 'low', label: 'Low' },
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-bold text-[var(--pastel-muted)]">Hardness</span>
                  <PastelSelect
                    value={editChapHardness}
                    onChange={(val) => setEditChapHardness(val as DifficultyLevel)}
                    ariaLabel="Edit chapter hardness"
                    variant="field"
                    className="w-full"
                    options={[
                      { value: 'hard', label: 'Hard' },
                      { value: 'medium', label: 'Mid' },
                      { value: 'easy', label: 'Easy' },
                    ]}
                  />
                </div>
              </div>
            </div>

            {chapterEditError && (
              <p className="text-xs font-bold text-red-700">{chapterEditError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingChapterId(null)}
                className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingChapterEdit || !editChapTitle.trim()}
                className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                {savingChapterEdit ? 'Saving...' : 'Save Chapter Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="max-w-3xl max-h-[90vh] bg-[var(--pastel-surface)] rounded-3xl overflow-hidden border border-[var(--pastel-border)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-[var(--pastel-border)] flex items-center justify-between gap-3">
              <span className="text-sm font-bold truncate">{lightboxPhoto.title}</span>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="p-1.5 rounded-full hover:bg-[var(--pastel-soft)] cursor-pointer"
                aria-label="Close photo preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={lightboxPhoto.dataUrl}
              alt={lightboxPhoto.title}
              className="max-h-[75vh] w-auto mx-auto object-contain bg-black"
            />
          </div>
        </div>
      )}
    </div>
  );
};
